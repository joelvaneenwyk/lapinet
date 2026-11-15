const U=()=>GPUBufferUsage;
const S=()=>GPUShaderStage.COMPUTE;
const COARSE_BUCKETS=1<<20;

function nextPow2(x){
  let n=1;
  while(n<x)n*=2;
  return n;
}

function makeBuffer(device,size,usage,label){
  return device.createBuffer({
    size:Math.max(16,Math.ceil(size/4)*4),
    usage,
    label
  });
}

async function compile(device,url,fetchImpl,label){
  const response=await fetchImpl(url,{cache:'no-store'});
  if(!response.ok)throw Error(label+' WGSL HTTP '+response.status);
  const code=await response.text();
  const module=device.createShaderModule({label,code});
  const info=await module.getCompilationInfo();
  const errors=info.messages.filter(x=>x.type==='error');
  if(errors.length){
    throw Error(label+': '+errors.map(
      x=>x.lineNum+':'+x.linePos+' '+x.message
    ).join('; '));
  }
  return module;
}

export class GPUR4NeighborLookup {
  constructor(device){
    this.device=device;
    this.ready=false;
    this.capacity=0;
    this.generation=0;
    this.buffers=[];
  }

  static async create(device,{
    fetchImpl=globalThis.fetch,
    coarseUrl=new URL('./gpu-r4-coarse.wgsl',import.meta.url),
    neighborUrl=new URL('./gpu-r4-neighbors.wgsl',import.meta.url),
  }={}){
    if(!device)throw Error('GPUR4NeighborLookup requires GPUDevice');
    const engine=new GPUR4NeighborLookup(device);
    const [coarseModule,neighborModule]=await Promise.all([
      compile(device,coarseUrl,fetchImpl,'R4 coarse lookup'),
      compile(device,neighborUrl,fetchImpl,'R4 neighbor consumer'),
    ]);

    engine.coarseLayout=device.createBindGroupLayout({
      entries:[
        {binding:0,visibility:S(),buffer:{type:'read-only-storage'}},
        {binding:1,visibility:S(),buffer:{type:'read-only-storage'}},
        {binding:2,visibility:S(),buffer:{type:'read-only-storage'}},
        {binding:3,visibility:S(),buffer:{type:'storage'}},
        {binding:4,visibility:S(),buffer:{type:'uniform'}},
      ]
    });
    engine.coarsePipeline=await device.createComputePipelineAsync({
      label:'R4 20-bit coarse prefix lookup',
      layout:device.createPipelineLayout({
        bindGroupLayouts:[engine.coarseLayout]
      }),
      compute:{module:coarseModule,entryPoint:'buildR4CoarseLookup'}
    });

    engine.neighborLayout=device.createBindGroupLayout({
      entries:[
        {binding:0,visibility:S(),buffer:{type:'read-only-storage'}},
        {binding:1,visibility:S(),buffer:{type:'read-only-storage'}},
        {binding:2,visibility:S(),buffer:{type:'read-only-storage'}},
        {binding:3,visibility:S(),buffer:{type:'read-only-storage'}},
        {binding:4,visibility:S(),buffer:{type:'read-only-storage'}},
        {binding:5,visibility:S(),buffer:{type:'read-only-storage'}},
        {binding:6,visibility:S(),buffer:{type:'storage'}},
        {binding:7,visibility:S(),buffer:{type:'storage'}},
        {binding:8,visibility:S(),buffer:{type:'uniform'}},
      ]
    });
    engine.neighborPipeline=await device.createComputePipelineAsync({
      label:'R4 bounded stencil neighbor moments',
      layout:device.createPipelineLayout({
        bindGroupLayouts:[engine.neighborLayout]
      }),
      compute:{module:neighborModule,entryPoint:'aggregateR4StencilNeighbors'}
    });

    const U0=U();
    engine.coarseLookup=makeBuffer(
      device,
      COARSE_BUCKETS*16,
      U0.STORAGE,
      'R4 coarse lookup entries'
    );
    engine.coarseConfig=makeBuffer(
      device,16,U0.UNIFORM|U0.COPY_DST,'R4 coarse config'
    );
    engine.neighborConfig=makeBuffer(
      device,16,U0.UNIFORM|U0.COPY_DST|U0.COPY_SRC,'R4 neighbor config'
    );
    engine.ready=true;
    return engine;
  }

  destroyBuffers(){
    for(const buffer of this.buffers){
      try{buffer.destroy();}catch{}
    }
    this.buffers=[];
    this.capacity=0;
  }

  destroy(){
    this.destroyBuffers();
    for(const buffer of [
      this.coarseLookup,
      this.coarseConfig,
      this.neighborConfig,
    ]){
      try{buffer?.destroy?.();}catch{}
    }
    this.ready=false;
  }

  ensureCapacity(count){
    if(count<=this.capacity)return false;
    this.destroyBuffers();
    this.capacity=nextPow2(Math.max(1,count));
    this.neighborMoments=makeBuffer(
      this.device,
      this.capacity*48,
      U().STORAGE|U().COPY_SRC,
      'R4 stencil neighbor moments'
    );
    this.buffers.push(this.neighborMoments);
    return true;
  }

  encode(encoder,index,{radius=1}={}){
    if(!this.ready)throw Error('GPUR4NeighborLookup not initialized');
    if(!index?.sortedKeys||!index?.sortedValues||
       !index?.cells||!index?.records)
      throw Error('neighbor lookup requires R4 SFC index result');
    if(!Number.isInteger(radius)||radius<0||radius>2)
      throw Error('radius must be 0..2');

    const count=index.count;
    this.ensureCapacity(count);
    this.generation=(this.generation+1)>>>0;
    if(this.generation===0)this.generation=1;
    this.device.queue.writeBuffer(
      this.coarseConfig,0,
      new Uint32Array([this.generation,0,0,0])
    );
    this.device.queue.writeBuffer(
      this.neighborConfig,0,
      new Uint32Array([count,this.generation,radius,0])
    );

    const coarseGroup=this.device.createBindGroup({
      layout:this.coarseLayout,
      entries:[
        {binding:0,resource:{buffer:index.sortedKeys}},
        {binding:1,resource:{buffer:index.ranges.starts}},
        {binding:2,resource:{buffer:index.ranges.metadata}},
        {binding:3,resource:{buffer:this.coarseLookup}},
        {binding:4,resource:{buffer:this.coarseConfig}},
      ]
    });
    let pass=encoder.beginComputePass();
    pass.setPipeline(this.coarsePipeline);
    pass.setBindGroup(0,coarseGroup);
    pass.dispatchWorkgroups(Math.ceil(count/256));
    pass.end();

    const neighborGroup=this.device.createBindGroup({
      layout:this.neighborLayout,
      entries:[
        {binding:0,resource:{buffer:index.sortedKeys}},
        {binding:1,resource:{buffer:index.sortedValues}},
        {binding:2,resource:{buffer:index.cells}},
        {binding:3,resource:{buffer:index.records}},
        {binding:4,resource:{buffer:index.ranges.starts}},
        {binding:5,resource:{buffer:index.ranges.metadata}},
        {binding:6,resource:{buffer:this.coarseLookup}},
        {binding:7,resource:{buffer:this.neighborMoments}},
        {binding:8,resource:{buffer:this.neighborConfig}},
      ]
    });
    pass=encoder.beginComputePass();
    pass.setPipeline(this.neighborPipeline);
    pass.setBindGroup(0,neighborGroup);
    pass.dispatchWorkgroups(Math.ceil(count/256));
    pass.end();

    return {
      count,
      radius,
      generation:this.generation,
      neighborMoments:this.neighborMoments,
      coarseLookup:this.coarseLookup,
      gpuResident:true,
      stencilCells:(2*radius+1)**4,
      momentFormat:'count + 4xi64-q16',
    };
  }
}

export {COARSE_BUCKETS};
