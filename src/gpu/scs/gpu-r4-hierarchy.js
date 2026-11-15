const U=()=>GPUBufferUsage;
const S=()=>GPUShaderStage.COMPUTE;

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

function layoutEntry(binding,type){
  return {
    binding,
    visibility:S(),
    buffer:{type},
  };
}

async function compile(device,url,fetchImpl){
  const response=await fetchImpl(url,{cache:'no-store'});
  if(!response.ok)throw Error('R4 hierarchy WGSL HTTP '+response.status);
  const code=await response.text();
  const module=device.createShaderModule({
    label:'R4 sparse prefix hierarchy',
    code
  });
  const info=await module.getCompilationInfo();
  const errors=info.messages.filter(x=>x.type==='error');
  if(errors.length){
    throw Error(errors.map(
      x=>x.lineNum+':'+x.linePos+' '+x.message
    ).join('; '));
  }
  return module;
}

export class GPUR4PrefixHierarchy {
  constructor(device,scan,{maxLevels=6}={}){
    this.device=device;
    this.scan=scan;
    this.maxLevels=maxLevels;
    this.ready=false;
    this.capacity=0;
    this.levels=[];
  }

  static async create(device,{
    scan,
    maxLevels=6,
    fetchImpl=globalThis.fetch,
    shaderUrl=new URL('./gpu-r4-hierarchy.wgsl',import.meta.url),
  }={}){
    if(!device||!scan)throw Error('hierarchy requires device + shared scan');
    const engine=new GPUR4PrefixHierarchy(device,scan,{maxLevels});
    const module=await compile(device,shaderUrl,fetchImpl);

    engine.markLayout=device.createBindGroupLayout({
      entries:[
        layoutEntry(0,'read-only-storage'),
        layoutEntry(3,'storage'),
        layoutEntry(9,'uniform'),
      ]
    });
    engine.writeLayout=device.createBindGroupLayout({
      entries:[
        layoutEntry(3,'storage'),
        layoutEntry(4,'read-only-storage'),
        layoutEntry(5,'storage'),
        layoutEntry(6,'storage'),
        layoutEntry(7,'storage'),
        layoutEntry(9,'uniform'),
      ]
    });
    engine.momentLayout=device.createBindGroupLayout({
      entries:[
        layoutEntry(1,'read-only-storage'),
        layoutEntry(2,'read-only-storage'),
        layoutEntry(5,'storage'),
        layoutEntry(6,'storage'),
        layoutEntry(8,'storage'),
        layoutEntry(9,'uniform'),
      ]
    });

    engine.markPipeline=await device.createComputePipelineAsync({
      label:'R4 hierarchy mark prefix starts',
      layout:device.createPipelineLayout({
        bindGroupLayouts:[engine.markLayout]
      }),
      compute:{module,entryPoint:'markPrefixStarts'}
    });
    engine.writePipeline=await device.createComputePipelineAsync({
      label:'R4 hierarchy write prefix ranges',
      layout:device.createPipelineLayout({
        bindGroupLayouts:[engine.writeLayout]
      }),
      compute:{module,entryPoint:'writePrefixRanges'}
    });
    engine.momentPipeline=await device.createComputePipelineAsync({
      label:'R4 hierarchy node moments',
      layout:device.createPipelineLayout({
        bindGroupLayouts:[engine.momentLayout]
      }),
      compute:{module,entryPoint:'computeNodeMoments'}
    });

    engine.ready=true;
    return engine;
  }

  destroyLevels(){
    for(const level of this.levels){
      for(const buffer of Object.values(level)){
        try{buffer?.destroy?.();}catch{}
      }
    }
    this.levels=[];
    this.capacity=0;
  }

  destroy(){
    this.destroyLevels();
    this.ready=false;
  }

  ensureCapacity(count,levelCount){
    if(count<=this.capacity&&this.levels.length>=levelCount)return false;
    const capacity=nextPow2(Math.max(1,count));
    this.destroyLevels();
    const U0=U();

    for(let level=0;level<this.maxLevels;level++){
      this.levels.push({
        flags:makeBuffer(
          this.device,capacity*4,U0.STORAGE,
          'R4 hierarchy flags L'+level
        ),
        prefixes:makeBuffer(
          this.device,capacity*4,U0.STORAGE,
          'R4 hierarchy prefix IDs L'+level
        ),
        starts:makeBuffer(
          this.device,(capacity+1)*4,U0.STORAGE|U0.COPY_SRC,
          'R4 hierarchy starts L'+level
        ),
        metadata:makeBuffer(
          this.device,16,U0.STORAGE|U0.COPY_SRC,
          'R4 hierarchy metadata L'+level
        ),
        indirect:makeBuffer(
          this.device,16,U0.STORAGE|U0.INDIRECT|U0.COPY_SRC,
          'R4 hierarchy indirect L'+level
        ),
        moments:makeBuffer(
          this.device,capacity*48,U0.STORAGE|U0.COPY_SRC,
          'R4 hierarchy moments L'+level
        ),
        config:makeBuffer(
          this.device,16,U0.UNIFORM|U0.COPY_DST,
          'R4 hierarchy config L'+level
        ),
      });
    }

    this.capacity=capacity;
    return true;
  }

  encode(encoder,index,{
    prefixBits=[20,40,60,80],
  }={}){
    if(!this.ready)throw Error('GPUR4PrefixHierarchy not initialized');
    if(!index?.sortedKeys||!index?.sortedValues)
      throw Error('hierarchy requires R4 index result');
    if(!Array.isArray(prefixBits)||prefixBits.length<1||
       prefixBits.length>this.maxLevels)
      throw Error('invalid prefixBits levels');

    for(let i=0;i<prefixBits.length;i++){
      const bits=prefixBits[i];
      if(!Number.isInteger(bits)||bits<1||bits>80)
        throw Error('prefixBits must be 1..80');
      if(i>0&&bits<=prefixBits[i-1])
        throw Error('prefixBits must be strictly increasing');
    }

    const count=index.count;
    this.ensureCapacity(count,prefixBits.length);
    const outputs=[];

    for(let levelIndex=0;levelIndex<prefixBits.length;levelIndex++){
      const level=this.levels[levelIndex];
      const bits=prefixBits[levelIndex];
      this.device.queue.writeBuffer(
        level.config,0,
        new Uint32Array([count,bits,levelIndex,0])
      );

      const markGroup=this.device.createBindGroup({
        layout:this.markLayout,
        entries:[
          {binding:0,resource:{buffer:index.sortedKeys}},
          {binding:3,resource:{buffer:level.flags}},
          {binding:9,resource:{buffer:level.config}},
        ]
      });
      let pass=encoder.beginComputePass();
      pass.setPipeline(this.markPipeline);
      pass.setBindGroup(0,markGroup);
      pass.dispatchWorkgroups(Math.ceil(count/256));
      pass.end();

      const scanInfo=this.scan.encode(encoder,{
        input:level.flags,
        output:level.prefixes,
        count,
        slot:levelIndex+1,
      });

      const writeGroup=this.device.createBindGroup({
        layout:this.writeLayout,
        entries:[
          {binding:3,resource:{buffer:level.flags}},
          {binding:4,resource:{buffer:level.prefixes}},
          {binding:5,resource:{buffer:level.starts}},
          {binding:6,resource:{buffer:level.metadata}},
          {binding:7,resource:{buffer:level.indirect}},
          {binding:9,resource:{buffer:level.config}},
        ]
      });
      pass=encoder.beginComputePass();
      pass.setPipeline(this.writePipeline);
      pass.setBindGroup(0,writeGroup);
      pass.dispatchWorkgroups(Math.ceil(count/256));
      pass.end();

      const momentGroup=this.device.createBindGroup({
        layout:this.momentLayout,
        entries:[
          {binding:1,resource:{buffer:index.sortedValues}},
          {binding:2,resource:{buffer:index.records}},
          {binding:5,resource:{buffer:level.starts}},
          {binding:6,resource:{buffer:level.metadata}},
          {binding:8,resource:{buffer:level.moments}},
          {binding:9,resource:{buffer:level.config}},
        ]
      });
      pass=encoder.beginComputePass();
      pass.setPipeline(this.momentPipeline);
      pass.setBindGroup(0,momentGroup);
      pass.dispatchWorkgroupsIndirect(level.indirect,0);
      pass.end();

      outputs.push({
        prefixBits:bits,
        starts:level.starts,
        metadata:level.metadata,
        indirect:level.indirect,
        moments:level.moments,
        particleNodeIDs:level.prefixes,
        scanInfo,
      });
    }

    return {
      count,
      prefixBits:[...prefixBits],
      levels:outputs,
      gpuResident:true,
      momentFormat:'count/start/end/prefix + 4xi64-q16',
    };
  }
}
