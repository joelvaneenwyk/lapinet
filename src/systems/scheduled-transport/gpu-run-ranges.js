import {GPUExclusiveScan} from './gpu-prefix-scan.js';

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
async function compile(device,url,fetchImpl){
  const response=await fetchImpl(url,{cache:'no-store'});
  if(!response.ok)throw Error('GPU range WGSL HTTP '+response.status);
  const code=await response.text();
  const module=device.createShaderModule({
    label:'Scan-Curve-Spectrum run ranges',
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
function encodePass(encoder,pipeline,group,workgroups){
  const pass=encoder.beginComputePass();
  pass.setPipeline(pipeline);
  pass.setBindGroup(0,group);
  pass.dispatchWorkgroups(workgroups);
  pass.end();
}

export class GPURunRanges {
  constructor(device,scan){
    this.device=device;
    this.scan=scan;
    this.ready=false;
    this.capacity=0;
    this.buffers=[];
  }

  static async create(device,{
    scan=null,
    shaderUrl=new URL('./gpu-run-ranges.wgsl',import.meta.url),
    fetchImpl=globalThis.fetch,
  }={}){
    if(!device)throw Error('GPURunRanges requires GPUDevice');
    const ownedScan=!scan;
    const prefixScan=scan??await GPUExclusiveScan.create(device,{fetchImpl});
    const engine=new GPURunRanges(device,prefixScan);
    engine.ownsScan=ownedScan;

    const module=await compile(device,shaderUrl,fetchImpl);
    engine.layout=device.createBindGroupLayout({
      entries:[
        {binding:0,visibility:S(),buffer:{type:'read-only-storage'}},
        {binding:1,visibility:S(),buffer:{type:'storage'}},
        {binding:2,visibility:S(),buffer:{type:'read-only-storage'}},
        {binding:3,visibility:S(),buffer:{type:'storage'}},
        {binding:4,visibility:S(),buffer:{type:'storage'}},
        {binding:5,visibility:S(),buffer:{type:'storage'}},
        {binding:6,visibility:S(),buffer:{type:'uniform'}},
      ]
    });
    const pipelineLayout=device.createPipelineLayout({
      bindGroupLayouts:[engine.layout]
    });
    engine.markPipeline=await device.createComputePipelineAsync({
      label:'mark sorted run starts',
      layout:pipelineLayout,
      compute:{module,entryPoint:'markRunStarts'}
    });
    engine.writePipeline=await device.createComputePipelineAsync({
      label:'compact sorted run ranges',
      layout:pipelineLayout,
      compute:{module,entryPoint:'writeRunRanges'}
    });
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
    if(this.ownsScan)this.scan.destroy();
    this.ready=false;
  }

  track(size,usage,label){
    const buffer=makeBuffer(this.device,size,usage,label);
    this.buffers.push(buffer);
    return buffer;
  }

  ensureCapacity(count){
    if(count<=this.capacity)return false;
    const capacity=nextPow2(Math.max(1,count));
    this.destroyBuffers();
    const U0=U();
    this.flags=this.track(
      capacity*4,
      U0.STORAGE|U0.COPY_SRC,
      'run start flags'
    );
    this.prefixes=this.track(
      capacity*4,
      U0.STORAGE|U0.COPY_SRC,
      'run start prefix IDs'
    );
    this.starts=this.track(
      (capacity+1)*4,
      U0.STORAGE|U0.COPY_SRC,
      'compacted run starts'
    );
    this.metadata=this.track(
      16,
      U0.STORAGE|U0.COPY_SRC,
      'run range metadata'
    );
    this.indirect=this.track(
      16,
      U0.STORAGE|U0.INDIRECT|U0.COPY_SRC,
      'run range indirect dispatch'
    );
    this.config=this.track(
      16,
      U0.UNIFORM|U0.COPY_DST,
      'run range config'
    );
    this.capacity=capacity;
    return true;
  }

  encode(encoder,{
    sortedKeys,
    count,
    keyWords=4,
    keyOffset=0,
    consumerWorkgroupSize=64,
  }){
    if(!this.ready)throw Error('GPURunRanges not initialized');
    if(!sortedKeys)throw Error('run ranges require sortedKeys');
    if(!Number.isInteger(count)||count<0)throw Error('invalid count');
    if(!Number.isInteger(keyWords)||keyWords<1||keyWords>4){
      throw Error('keyWords must be 1..4');
    }
    if(
      !Number.isInteger(keyOffset)||
      keyOffset<0||
      keyOffset+keyWords>4
    ){
      throw Error('invalid keyOffset/keyWords');
    }
    if(
      !Number.isInteger(consumerWorkgroupSize)||
      consumerWorkgroupSize<1
    )throw Error('invalid consumer workgroup size');

    if(count===0){
      return {
        starts:null,
        metadata:null,
        indirect:null,
        count:0,
        keyWords,
        keyOffset,
        capacity:this.capacity,
      };
    }

    this.ensureCapacity(count);
    this.device.queue.writeBuffer(
      this.config,
      0,
      new Uint32Array([
        count,
        keyWords,
        keyOffset,
        consumerWorkgroupSize,
      ])
    );

    const group=this.device.createBindGroup({
      layout:this.layout,
      entries:[
        {binding:0,resource:{buffer:sortedKeys}},
        {binding:1,resource:{buffer:this.flags}},
        {binding:2,resource:{buffer:this.prefixes}},
        {binding:3,resource:{buffer:this.starts}},
        {binding:4,resource:{buffer:this.metadata}},
        {binding:5,resource:{buffer:this.indirect}},
        {binding:6,resource:{buffer:this.config}},
      ]
    });

    const workgroups=Math.ceil(count/256);
    encodePass(encoder,this.markPipeline,group,workgroups);
    const scanInfo=this.scan.encode(encoder,{
      input:this.flags,
      output:this.prefixes,
      count,
    });
    encodePass(encoder,this.writePipeline,group,workgroups);

    return {
      starts:this.starts,
      metadata:this.metadata,
      indirect:this.indirect,
      flags:this.flags,
      prefixes:this.prefixes,
      count,
      keyWords,
      keyOffset,
      capacity:this.capacity,
      scanInfo,
    };
  }
}
