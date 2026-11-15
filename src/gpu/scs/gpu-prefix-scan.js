const U=()=>GPUBufferUsage;
const S=()=>GPUShaderStage.COMPUTE;
const BLOCK_SIZE=512;
const DEFAULT_JOB_SLOTS=8;

function makeBuffer(device,size,usage,label){
  return device.createBuffer({
    size:Math.max(16,Math.ceil(size/4)*4),
    usage,
    label
  });
}
function makeLayout(device,entries){
  return device.createBindGroupLayout({
    entries:entries.map((item,index)=>({
      binding:item.binding??index,
      visibility:S(),
      buffer:item.buffer??item
    }))
  });
}
function bind(device,layout,entries){
  return device.createBindGroup({
    layout,
    entries:entries.map((item,index)=>({
      binding:item.binding??index,
      resource:{buffer:item.resource??item}
    }))
  });
}
function encode(encoder,pipeline,group,count){
  const pass=encoder.beginComputePass();
  pass.setPipeline(pipeline);
  pass.setBindGroup(0,group);
  pass.dispatchWorkgroups(count);
  pass.end();
}
function nextPow2(value){
  let x=1;
  while(x<value)x*=2;
  return x;
}

export class GPUExclusiveScan {
  constructor(device,{jobSlots=DEFAULT_JOB_SLOTS}={}){
    this.device=device;
    this.ready=false;
    this.capacity=0;
    this.scratch=[];
    this.jobSlots=jobSlots;
  }

  static async create(device,{
    shaderUrl=new URL('./gpu-prefix-scan.wgsl',import.meta.url),
    fetchImpl=globalThis.fetch,
    jobSlots=DEFAULT_JOB_SLOTS,
  }={}){
    if(!device)throw Error('GPUExclusiveScan requires GPUDevice');
    if(!Number.isInteger(jobSlots)||jobSlots<1)
      throw Error('jobSlots must be positive integer');
    const scan=new GPUExclusiveScan(device,{jobSlots});
    const response=await fetchImpl(shaderUrl,{cache:'no-store'});
    if(!response.ok)throw Error('GPU scan WGSL HTTP '+response.status);
    const code=await response.text();
    const module=device.createShaderModule({
      label:'Scan-Curve-Spectrum generic prefix scan',
      code
    });
    const info=await module.getCompilationInfo();
    const errors=info.messages.filter(x=>x.type==='error');
    if(errors.length){
      throw Error(errors.map(
        x=>x.lineNum+':'+x.linePos+' '+x.message
      ).join('; '));
    }

    scan.scanLayout=makeLayout(device,[
      {type:'read-only-storage'},
      {type:'storage'},
      {type:'storage'},
      {type:'uniform'},
    ]);
    scan.offsetLayout=makeLayout(device,[
      {binding:4,buffer:{type:'storage'}},
      {binding:5,buffer:{type:'read-only-storage'}},
      {binding:6,buffer:{type:'uniform'}},
    ]);
    scan.scanPipeline=await device.createComputePipelineAsync({
      label:'generic exclusive scan blocks',
      layout:device.createPipelineLayout({
        bindGroupLayouts:[scan.scanLayout]
      }),
      compute:{module,entryPoint:'scanBlocks'}
    });
    scan.offsetPipeline=await device.createComputePipelineAsync({
      label:'generic exclusive scan add offsets',
      layout:device.createPipelineLayout({
        bindGroupLayouts:[scan.offsetLayout]
      }),
      compute:{module,entryPoint:'addBlockOffsets'}
    });
    scan.ready=true;
    return scan;
  }

  destroyScratch(){
    for(const level of this.scratch){
      for(const key of ['sums','output']){
        try{level[key]?.destroy();}catch{}
      }
      for(const array of [
        level.scanUniforms,
        level.offsetUniforms,
      ]){
        for(const buffer of array??[]){
          try{buffer.destroy();}catch{}
        }
      }
    }
    this.scratch=[];
    this.capacity=0;
  }

  destroy(){
    this.destroyScratch();
    this.ready=false;
  }

  ensureCapacity(count){
    if(count<=this.capacity)return false;
    const dev=this.device,U0=U();
    const capacity=nextPow2(Math.max(count,1));
    this.destroyScratch();

    let n=capacity;
    let level=0;
    while(n>0){
      const blocks=Math.ceil(n/BLOCK_SIZE);
      const scanUniforms=[];
      const offsetUniforms=[];
      for(let slot=0;slot<this.jobSlots;slot++){
        scanUniforms.push(makeBuffer(
          dev,16,U0.UNIFORM|U0.COPY_DST,
          'scan config L'+level+' slot '+slot
        ));
        offsetUniforms.push(makeBuffer(
          dev,16,U0.UNIFORM|U0.COPY_DST,
          'scan add-offset config L'+level+' slot '+slot
        ));
      }
      this.scratch.push({
        capacity:n,
        blocks,
        sums:makeBuffer(
          dev,
          blocks*4,
          U0.STORAGE|U0.COPY_SRC|U0.COPY_DST,
          'scan block sums L'+level
        ),
        output:level===0?null:makeBuffer(
          dev,
          n*4,
          U0.STORAGE|U0.COPY_SRC|U0.COPY_DST,
          'scan block offsets L'+level
        ),
        scanUniforms,
        offsetUniforms,
      });
      if(blocks<=1)break;
      n=blocks;
      level++;
    }

    this.capacity=capacity;
    return true;
  }

  /**
   * Encode an exclusive scan of count u32 values.
   * Use a distinct slot for scans encoded into the same command buffer.
   * Scratch data is shared safely because compute passes execute in order;
   * per-job uniforms are not shared.
   */
  encode(encoder,{input,output,count,slot=0}){
    if(!this.ready)throw Error('GPUExclusiveScan not initialized');
    if(!input||!output)throw Error('Scan requires input/output buffers');
    if(input===output)throw Error('Scan input and output must be distinct');
    if(!Number.isInteger(count)||count<0)throw Error('Invalid scan count');
    if(!Number.isInteger(slot)||slot<0||slot>=this.jobSlots)
      throw Error('scan slot out of range');
    if(count===0)return {
      count,
      levels:0,
      blockSize:BLOCK_SIZE,
      capacity:this.capacity,
      slot,
    };

    this.ensureCapacity(count);
    const dev=this.device;
    const active=[];
    let levelInput=input;
    let levelOutput=output;
    let levelCount=count;
    let level=0;

    while(true){
      const scratch=this.scratch[level];
      const blocks=Math.ceil(levelCount/BLOCK_SIZE);
      const scanUniform=scratch.scanUniforms[slot];
      dev.queue.writeBuffer(
        scanUniform,
        0,
        new Uint32Array([levelCount,0,0,0])
      );
      const group=bind(
        dev,
        this.scanLayout,
        [
          levelInput,
          levelOutput,
          scratch.sums,
          scanUniform,
        ]
      );
      encode(encoder,this.scanPipeline,group,blocks);
      active.push({
        count:levelCount,
        blocks,
        output:levelOutput,
        scratch,
      });

      if(blocks<=1)break;

      const next=this.scratch[level+1];
      levelInput=scratch.sums;
      levelOutput=next.output;
      levelCount=blocks;
      level++;
    }

    for(let i=active.length-2;i>=0;i--){
      const lower=active[i];
      const upper=active[i+1];
      const offsetUniform=lower.scratch.offsetUniforms[slot];
      dev.queue.writeBuffer(
        offsetUniform,
        0,
        new Uint32Array([
          lower.count,
          BLOCK_SIZE,
          0,
          0,
        ])
      );
      const group=bind(
        dev,
        this.offsetLayout,
        [
          {binding:4,resource:lower.output},
          {binding:5,resource:upper.output},
          {binding:6,resource:offsetUniform},
        ]
      );
      encode(
        encoder,
        this.offsetPipeline,
        group,
        Math.ceil(lower.count/256)
      );
    }

    return {
      count,
      levels:active.length,
      blockSize:BLOCK_SIZE,
      capacity:this.capacity,
      topBlocks:active.at(-1).blocks,
      slot,
    };
  }
}

export {BLOCK_SIZE,DEFAULT_JOB_SLOTS};
