import {GPUExclusiveScan} from './gpu-prefix-scan.js';
import {GPUWideRadixSort} from './gpu-radix-sort.js';
import {GPURunRanges} from './gpu-run-ranges.js';

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
  if(!response.ok)throw Error('R4 key WGSL HTTP '+response.status);
  const code=await response.text();
  const module=device.createShaderModule({
    label:'physical R4 fixed-point SFC keys',
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

export class GPUR4SFCIndex {
  constructor(device,{scan,sorter,ranges}){
    this.device=device;
    this.scan=scan;
    this.sorter=sorter;
    this.ranges=ranges;
    this.capacity=0;
    this.buffers=[];
    this.ready=false;
  }

  static async create(device,{
    fetchImpl=globalThis.fetch,
    shaderUrl=new URL('./gpu-r4-keys.wgsl',import.meta.url),
  }={}){
    if(!device)throw Error('GPUR4SFCIndex requires GPUDevice');
    const scan=await GPUExclusiveScan.create(device,{
      fetchImpl,
      jobSlots:8,
    });
    const [sorter,ranges,module]=await Promise.all([
      GPUWideRadixSort.create(device,{fetchImpl}),
      GPURunRanges.create(device,{scan,fetchImpl}),
      compile(device,shaderUrl,fetchImpl),
    ]);
    const engine=new GPUR4SFCIndex(device,{scan,sorter,ranges});
    engine.layout=device.createBindGroupLayout({
      entries:[
        {binding:0,visibility:S(),buffer:{type:'read-only-storage'}},
        {binding:1,visibility:S(),buffer:{type:'read-only-storage'}},
        {binding:2,visibility:S(),buffer:{type:'storage'}},
        {binding:3,visibility:S(),buffer:{type:'storage'}},
        {binding:4,visibility:S(),buffer:{type:'uniform'}},
        {binding:5,visibility:S(),buffer:{type:'storage'}},
      ]
    });
    engine.pipeline=await device.createComputePipelineAsync({
      label:'physical R4 fixed-point Morton keys',
      layout:device.createPipelineLayout({
        bindGroupLayouts:[engine.layout]
      }),
      compute:{module,entryPoint:'buildPhysicalR4Keys'}
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
    this.ranges.destroy();
    this.sorter.destroy();
    this.scan.destroy();
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
    this.keys=this.track(
      capacity*16,
      U0.STORAGE|U0.COPY_SRC|U0.COPY_DST,
      'R4 SFC composite keys'
    );
    this.cells=this.track(
      capacity*16,
      U0.STORAGE|U0.COPY_SRC,
      'R4 quantized cells'
    );
    this.values=this.track(
      capacity*4,
      U0.STORAGE|U0.COPY_SRC|U0.COPY_DST,
      'R4 SFC record IDs'
    );
    this.config=this.track(
      16,
      U0.UNIFORM|U0.COPY_DST,
      'R4 SFC key config'
    );
    this.capacity=capacity;
    return true;
  }

  encode(encoder,{
    records,
    stableIDs,
    count,
    cellShift=16,
    topologyDispatch=null,
  }){
    if(!this.ready)throw Error('GPUR4SFCIndex not initialized');
    if(!records||!stableIDs)throw Error('missing state/stable IDs');
    if(!Number.isInteger(count)||count<1)throw Error('invalid count');
    if(!Number.isInteger(cellShift)||cellShift<11||cellShift>30)
      throw Error('cellShift must be 11..30');

    this.ensureCapacity(count);
    this.device.queue.writeBuffer(
      this.config,0,new Uint32Array([count,cellShift,0,0])
    );
    const group=this.device.createBindGroup({
      layout:this.layout,
      entries:[
        {binding:0,resource:{buffer:records}},
        {binding:1,resource:{buffer:stableIDs}},
        {binding:2,resource:{buffer:this.keys}},
        {binding:3,resource:{buffer:this.values}},
        {binding:4,resource:{buffer:this.config}},
        {binding:5,resource:{buffer:this.cells}},
      ]
    });
    const pass=encoder.beginComputePass();
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0,group);
    if(topologyDispatch){
      pass.dispatchWorkgroupsIndirect(topologyDispatch,0);
    }else{
      pass.dispatchWorkgroups(Math.ceil(count/256));
    }
    pass.end();

    const sorted=this.sorter.encode(encoder,{
      keys:this.keys,
      values:this.values,
      count,
      keyWords:3,
      digitCount:10,
      indirect:topologyDispatch,
    });
    const ranges=this.ranges.encode(encoder,{
      sortedKeys:sorted.keys,
      count,
      keyWords:3,
      keyOffset:0,
      consumerWorkgroupSize:64,
      indirect:topologyDispatch,
    });

    return {
      count,
      cellShift,
      records,
      stableIDs,
      sortedKeys:sorted.keys,
      sortedValues:sorted.values,
      cells:this.cells,
      ranges,
      gpuResident:true,
      metric:'fixed-r4',
      sfc:'morton4d-80',
    };
  }
}
