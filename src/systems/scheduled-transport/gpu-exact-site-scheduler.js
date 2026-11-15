import {
  E8_ROOT_STEPS,
  e8Dot,
  e8RootReflection,
} from './noether/icosian-e8.mjs';
import {GPUExclusiveScan} from './gpu-prefix-scan.js';
import {GPUWideRadixSort} from './gpu-radix-sort.js';
import {GPURunRanges} from './gpu-run-ranges.js';

const U=()=>GPUBufferUsage;
const S=()=>GPUShaderStage.COMPUTE;

function pow2AtLeast(x){
  let n=1;
  while(n<x)n*=2;
  return n;
}
function makeBuffer(device,size,usage,label){
  return device.createBuffer({
    size:Math.max(16,Math.ceil(size/4)*4),
    usage,label
  });
}
function sparseLayout(device,entries){
  return device.createBindGroupLayout({
    entries:entries.map(({binding,type})=>({
      binding,visibility:S(),buffer:{type}
    }))
  });
}
function sparseGroup(device,layout,entries){
  return device.createBindGroup({
    layout,
    entries:entries.map(({binding,buffer})=>({
      binding,resource:{buffer}
    }))
  });
}
function dispatch(encoder,pipeline,group,count){
  const pass=encoder.beginComputePass();
  pass.setPipeline(pipeline);
  pass.setBindGroup(0,group);
  pass.dispatchWorkgroups(count);
  pass.end();
}
async function compile(device,url,fetchImpl){
  const response=await fetchImpl(url,{cache:'no-store'});
  if(!response.ok)throw Error(
    'Exact-site scheduler WGSL HTTP '+response.status
  );
  const module=device.createShaderModule({
    label:'Scan-Curve-Spectrum exact-site scheduler',
    code:await response.text()
  });
  const info=await module.getCompilationInfo();
  const errors=info.messages.filter(x=>x.type==='error');
  if(errors.length)throw Error(errors.map(
    x=>x.lineNum+':'+x.linePos+' '+x.message
  ).join('; '));
  return module;
}

let cachedTables=null;
export function buildE8CollisionTables(){
  if(cachedTables)return cachedTables;
  const reflect=new Uint32Array(240*240);
  const dots=new Int32Array(240*240);
  for(let channel=0;channel<240;channel++){
    for(let control=0;control<240;control++){
      const index=channel*240+control;
      reflect[index]=e8RootReflection(channel,control);
      dots[index]=e8Dot(
        E8_ROOT_STEPS[channel],
        E8_ROOT_STEPS[control]
      );
    }
  }
  cachedTables=Object.freeze({reflect,dots});
  return cachedTables;
}

export class GPUExactSiteScheduler{
  constructor(device,{
    scan,radix,ranges,
    ownsScan,ownsRadix,ownsRanges
  }){
    this.device=device;
    this.scan=scan;
    this.radix=radix;
    this.ranges=ranges;
    this.ownsScan=ownsScan;
    this.ownsRadix=ownsRadix;
    this.ownsRanges=ownsRanges;
    this.ready=false;
    this.capacity=0;
    this.buffers=[];
    this.bound=null;
  }

  static async create(device,{
    scan=null,
    radix=null,
    ranges=null,
    shaderUrl=new URL(
      './gpu-exact-site-scheduler.wgsl',
      import.meta.url
    ),
    fetchImpl=globalThis.fetch
  }={}){
    if(!device)throw Error(
      'GPUExactSiteScheduler requires GPUDevice'
    );
    const ownsScan=!scan;
    const ownsRadix=!radix;
    scan??=await GPUExclusiveScan.create(device,{fetchImpl});
    radix??=await GPUWideRadixSort.create(device,{fetchImpl});
    const ownsRanges=!ranges;
    ranges??=await GPURunRanges.create(
      device,{scan,fetchImpl}
    );
    const engine=new GPUExactSiteScheduler(device,{
      scan,radix,ranges,
      ownsScan,ownsRadix,ownsRanges
    });
    await engine.initialize(shaderUrl,fetchImpl);
    return engine;
  }

  async initialize(shaderUrl,fetchImpl){
    const dev=this.device,U0=U();
    const module=await compile(dev,shaderUrl,fetchImpl);
    this.layouts={
      build:sparseLayout(dev,[
        {binding:0,type:'storage'},
        {binding:1,type:'read-only-storage'},
        {binding:2,type:'storage'},
        {binding:3,type:'storage'},
        {binding:11,type:'uniform'},
      ]),
      count:sparseLayout(dev,[
        {binding:4,type:'read-only-storage'},
        {binding:5,type:'storage'},
        {binding:6,type:'storage'},
        {binding:11,type:'uniform'},
      ]),
      total:sparseLayout(dev,[
        {binding:5,type:'storage'},
        {binding:6,type:'storage'},
        {binding:7,type:'read-only-storage'},
        {binding:11,type:'uniform'},
      ]),
      emit:sparseLayout(dev,[
        {binding:0,type:'storage'},
        {binding:2,type:'storage'},
        {binding:3,type:'storage'},
        {binding:4,type:'read-only-storage'},
        {binding:5,type:'storage'},
        {binding:7,type:'read-only-storage'},
        {binding:8,type:'storage'},
        {binding:11,type:'uniform'},
      ]),
      apply:sparseLayout(dev,[
        {binding:0,type:'storage'},
        {binding:5,type:'storage'},
        {binding:8,type:'storage'},
        {binding:9,type:'read-only-storage'},
        {binding:10,type:'read-only-storage'},
      ]),
    };

    const pipeline=async(entry,key)=>
      dev.createComputePipelineAsync({
        label:'exact-site '+entry,
        layout:dev.createPipelineLayout({
          bindGroupLayouts:[this.layouts[key]]
        }),
        compute:{module,entryPoint:entry}
      });
    this.pipelines={
      build:await pipeline('buildExactSiteKeys','build'),
      count:await pipeline('countPairsByCell','count'),
      total:await pipeline('writePairTotal','total'),
      emit:await pipeline('emitCanonicalPairs','emit'),
      apply:await pipeline('applyE8Collisions','apply'),
    };

    this.config=makeBuffer(
      dev,16,U0.UNIFORM|U0.COPY_DST,
      'exact-site scheduler config'
    );
    const tables=buildE8CollisionTables();
    this.reflections=makeBuffer(
      dev,tables.reflect.byteLength,
      U0.STORAGE|U0.COPY_DST,
      'E8 reflection channel LUT'
    );
    this.dots=makeBuffer(
      dev,tables.dots.byteLength,
      U0.STORAGE|U0.COPY_DST,
      'E8 root dot LUT'
    );
    dev.queue.writeBuffer(this.reflections,0,tables.reflect);
    dev.queue.writeBuffer(this.dots,0,tables.dots);
    this.ready=true;
  }

  track(size,usage,label){
    const b=makeBuffer(this.device,size,usage,label);
    this.buffers.push(b);
    return b;
  }

  destroyCapacity(){
    for(const b of this.buffers)try{b.destroy();}catch{}
    this.buffers=[];
    this.capacity=0;
    this.bound=null;
  }

  destroy(){
    this.destroyCapacity();
    try{this.config.destroy();}catch{}
    try{this.reflections.destroy();}catch{}
    try{this.dots.destroy();}catch{}
    if(this.ownsRanges)this.ranges.destroy();
    if(this.ownsRadix)this.radix.destroy();
    if(this.ownsScan)this.scan.destroy();
    this.ready=false;
  }

  ensureCapacity(count){
    if(count<=this.capacity)return false;
    const U0=U();
    const capacity=pow2AtLeast(Math.max(count,256));
    this.destroyCapacity();
    this.exactKeys=this.track(
      capacity*16,U0.STORAGE|U0.COPY_SRC,
      'exact-site unsorted keys'
    );
    this.exactValues=this.track(
      capacity*4,U0.STORAGE|U0.COPY_SRC,
      'exact-site unsorted values'
    );
    this.pairCounts=this.track(
      capacity*4,U0.STORAGE|U0.COPY_SRC,
      'exact-site pair counts'
    );
    this.pairOffsets=this.track(
      capacity*4,U0.STORAGE|U0.COPY_SRC,
      'exact-site pair offsets'
    );
    this.pairs=this.track(
      Math.ceil(capacity/2)*32,
      U0.STORAGE|U0.COPY_SRC,
      'exact-site canonical pairs'
    );
    this.capacity=capacity;
    this.bound=null;
    return true;
  }

  bindExternal(
    records,stableIDs,sortedKeys,sortedValues,starts,metadata
  ){
    const dev=this.device,L=this.layouts;
    return {
      build:sparseGroup(dev,L.build,[
        {binding:0,buffer:records},
        {binding:1,buffer:stableIDs},
        {binding:2,buffer:this.exactKeys},
        {binding:3,buffer:this.exactValues},
        {binding:11,buffer:this.config},
      ]),
      count:sparseGroup(dev,L.count,[
        {binding:4,buffer:starts},
        {binding:5,buffer:metadata},
        {binding:6,buffer:this.pairCounts},
        {binding:11,buffer:this.config},
      ]),
      total:sparseGroup(dev,L.total,[
        {binding:5,buffer:metadata},
        {binding:6,buffer:this.pairCounts},
        {binding:7,buffer:this.pairOffsets},
        {binding:11,buffer:this.config},
      ]),
      emit:sparseGroup(dev,L.emit,[
        {binding:0,buffer:records},
        {binding:2,buffer:sortedKeys},
        {binding:3,buffer:sortedValues},
        {binding:4,buffer:starts},
        {binding:5,buffer:metadata},
        {binding:7,buffer:this.pairOffsets},
        {binding:8,buffer:this.pairs},
        {binding:11,buffer:this.config},
      ]),
      apply:sparseGroup(dev,L.apply,[
        {binding:0,buffer:records},
        {binding:5,buffer:metadata},
        {binding:8,buffer:this.pairs},
        {binding:9,buffer:this.reflections},
        {binding:10,buffer:this.dots},
      ]),
    };
  }

  encode(encoder,{
    records,
    stableIDs,
    count,
    frame,
    applyCollisions=true
  }){
    if(!this.ready)throw Error(
      'GPUExactSiteScheduler not initialized'
    );
    if(!records||!stableIDs)throw Error(
      'Missing records or stable-ID GPU buffer'
    );
    if(!Number.isInteger(count)||count<1)throw Error(
      'Exact-site scheduler count must be positive'
    );
    if(!Number.isInteger(frame)||frame<0)throw Error(
      'Frame must be nonnegative integer'
    );

    this.ensureCapacity(count);
    this.ranges.ensureCapacity(count);
    this.scan.ensureCapacity(count);
    this.device.queue.writeBuffer(
      this.config,0,new Uint32Array([count,frame>>>0,0,0])
    );

    const buildGroup=sparseGroup(
      this.device,this.layouts.build,[
        {binding:0,buffer:records},
        {binding:1,buffer:stableIDs},
        {binding:2,buffer:this.exactKeys},
        {binding:3,buffer:this.exactValues},
        {binding:11,buffer:this.config},
      ]
    );
    dispatch(
      encoder,this.pipelines.build,buildGroup,
      Math.ceil(count/128)
    );

    const sorted=this.radix.encode(encoder,{
      keys:this.exactKeys,
      values:this.exactValues,
      count,
      keyWords:4,
      slot:0,
    });
    const rangeResult=this.ranges.encode(encoder,{
      sortedKeys:sorted.keys,
      count,
      keyWords:3,
      keyOffset:1,
      consumerWorkgroupSize:64,
    });
    const g=this.bindExternal(
      records,
      stableIDs,
      sorted.keys,
      sorted.values,
      rangeResult.starts,
      rangeResult.metadata
    );

    dispatch(
      encoder,this.pipelines.count,g.count,
      Math.ceil(count/128)
    );
    this.scan.encode(encoder,{
      input:this.pairCounts,
      output:this.pairOffsets,
      count
    });
    dispatch(encoder,this.pipelines.total,g.total,1);
    dispatch(
      encoder,this.pipelines.emit,g.emit,
      Math.ceil(count/64)
    );
    if(applyCollisions){
      dispatch(
        encoder,this.pipelines.apply,g.apply,
        Math.ceil(Math.ceil(count/2)/128)
      );
    }

    return Object.freeze({
      count,
      frame,
      gpuResident:true,
      collisionsApplied:!!applyCollisions,
      sortedKeys:sorted.keys,
      sortedValues:sorted.values,
      cellIDs:rangeResult.prefixes,
      starts:rangeResult.starts,
      pairCounts:this.pairCounts,
      pairOffsets:this.pairOffsets,
      pairs:this.pairs,
      metadata:rangeResult.metadata,
    });
  }
}
