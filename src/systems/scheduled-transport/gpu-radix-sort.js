const U=()=>GPUBufferUsage;
const S=()=>GPUShaderStage.COMPUTE;
const ITEMS_PER_GROUP=256;
const HISTOGRAM_BINS=256;
const HISTOGRAM_SCAN_BLOCK=512;
const DEFAULT_SORT_SLOTS=4;

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
function makeLayout(device,types){
  return device.createBindGroupLayout({
    entries:types.map((type,binding)=>({
      binding,
      visibility:S(),
      buffer:{type}
    }))
  });
}
function bind(device,layout,buffers){
  return device.createBindGroup({
    layout,
    entries:buffers.map((buffer,binding)=>({
      binding,
      resource:{buffer}
    }))
  });
}
function encodePass(encoder,pipeline,group,x,y=1){
  const pass=encoder.beginComputePass();
  pass.setPipeline(pipeline);
  pass.setBindGroup(0,group);
  pass.dispatchWorkgroups(x,y,1);
  pass.end();
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

export class GPUWideRadixSort {
  constructor(device,{jobSlots=DEFAULT_SORT_SLOTS}={}){
    this.device=device;
    this.jobSlots=jobSlots;
    this.ready=false;
    this.capacity=0;
    this.buffers=[];
    this.configs=[];
    this.histConfigs=[];
  }

  static async create(device,{
    rankUrl=new URL('./gpu-radix-rank.wgsl',import.meta.url),
    histScanUrl=new URL('./gpu-radix-hist-scan.wgsl',import.meta.url),
    scatterUrl=new URL('./gpu-radix-scatter.wgsl',import.meta.url),
    fetchImpl=globalThis.fetch,
    jobSlots=DEFAULT_SORT_SLOTS,
  }={}){
    if(!device)throw Error('GPUWideRadixSort requires GPUDevice');
    if(!Number.isInteger(jobSlots)||jobSlots<1)
      throw Error('jobSlots must be positive integer');

    const sorter=new GPUWideRadixSort(device,{jobSlots});
    const [rankModule,histModule,scatterModule]=await Promise.all([
      compile(device,rankUrl,fetchImpl,'radix rank'),
      compile(device,histScanUrl,fetchImpl,'radix histogram scan'),
      compile(device,scatterUrl,fetchImpl,'radix scatter'),
    ]);

    sorter.rankLayout=makeLayout(device,[
      'read-only-storage','storage','storage','uniform'
    ]);
    sorter.histLayout=makeLayout(device,[
      'storage','storage','storage','uniform'
    ]);
    sorter.scatterLayout=makeLayout(device,[
      'read-only-storage','read-only-storage','read-only-storage',
      'read-only-storage','read-only-storage','storage','storage','uniform'
    ]);

    const rankPipelineLayout=device.createPipelineLayout({
      bindGroupLayouts:[sorter.rankLayout]
    });
    const histPipelineLayout=device.createPipelineLayout({
      bindGroupLayouts:[sorter.histLayout]
    });
    const scatterPipelineLayout=device.createPipelineLayout({
      bindGroupLayouts:[sorter.scatterLayout]
    });

    sorter.rankPipeline=await device.createComputePipelineAsync({
      label:'radix histogram + stable local rank',
      layout:rankPipelineLayout,
      compute:{module:rankModule,entryPoint:'histogramAndLocalRank'}
    });
    sorter.histPipelines={};
    for(const entry of [
      'scanHistogramBlocks',
      'scanHistogramBlockSums',
      'addHistogramBlockOffsets',
      'scanBinTotals'
    ]){
      sorter.histPipelines[entry]=await device.createComputePipelineAsync({
        label:'radix '+entry,
        layout:histPipelineLayout,
        compute:{module:histModule,entryPoint:entry}
      });
    }
    sorter.scatterPipeline=await device.createComputePipelineAsync({
      label:'radix stable scatter',
      layout:scatterPipelineLayout,
      compute:{module:scatterModule,entryPoint:'scatterDigit'}
    });

    sorter.ready=true;
    return sorter;
  }

  destroyBuffers(){
    for(const buffer of this.buffers){
      try{buffer.destroy();}catch{}
    }
    this.buffers=[];
    this.configs=[];
    this.histConfigs=[];
    this.capacity=0;
  }

  destroy(){
    this.destroyBuffers();
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
    const groups=Math.ceil(capacity/ITEMS_PER_GROUP);
    const histogramBlocks=Math.ceil(groups/HISTOGRAM_SCAN_BLOCK);
    if(histogramBlocks>512){
      throw Error(
        'radix histogram hierarchy exceeds two-level capacity'
      );
    }

    this.destroyBuffers();
    const U0=U();

    this.keysA=this.track(
      capacity*16,
      U0.STORAGE|U0.COPY_SRC|U0.COPY_DST,
      'radix keys A'
    );
    this.keysB=this.track(
      capacity*16,
      U0.STORAGE|U0.COPY_SRC|U0.COPY_DST,
      'radix keys B'
    );
    this.valuesA=this.track(
      capacity*4,
      U0.STORAGE|U0.COPY_SRC|U0.COPY_DST,
      'radix values A'
    );
    this.valuesB=this.track(
      capacity*4,
      U0.STORAGE|U0.COPY_SRC|U0.COPY_DST,
      'radix values B'
    );
    this.localRanks=this.track(
      capacity*4,
      U0.STORAGE,
      'radix local ranks'
    );
    this.histograms=this.track(
      HISTOGRAM_BINS*groups*4,
      U0.STORAGE,
      'radix per-group histograms'
    );
    this.groupOffsets=this.track(
      HISTOGRAM_BINS*groups*4,
      U0.STORAGE,
      'radix per-bin group offsets'
    );
    this.blockSums=this.track(
      HISTOGRAM_BINS*histogramBlocks*4,
      U0.STORAGE,
      'radix histogram block sums'
    );
    this.blockOffsets=this.track(
      HISTOGRAM_BINS*histogramBlocks*4,
      U0.STORAGE,
      'radix histogram block offsets'
    );
    this.binTotals=this.track(
      HISTOGRAM_BINS*4,
      U0.STORAGE,
      'radix bin totals'
    );
    this.binBases=this.track(
      HISTOGRAM_BINS*4,
      U0.STORAGE,
      'radix bin bases'
    );
    this.dummy=this.track(
      16,
      U0.STORAGE,
      'radix dummy storage'
    );

    for(let slot=0;slot<this.jobSlots;slot++){
      const digitConfigs=[];
      for(let digit=0;digit<16;digit++){
        digitConfigs.push(this.track(
          16,
          U0.UNIFORM|U0.COPY_DST,
          'radix config slot '+slot+' digit '+digit
        ));
      }
      this.configs.push(digitConfigs);
      this.histConfigs.push(this.track(
        16,
        U0.UNIFORM|U0.COPY_DST,
        'radix histogram config slot '+slot
      ));
    }

    this.capacity=capacity;
    this.capacityGroups=groups;
    this.capacityHistogramBlocks=histogramBlocks;
    return true;
  }

  /**
   * Stable LSD sort of vec4<u32> keys and u32 values.
   * keyWords=1..4 sorts only the low keyWords limbs.
   * Use distinct slots for multiple sorts encoded before one queue submit.
   */
  encode(encoder,{
    keys,
    values,
    count,
    keyWords=4,
    slot=0,
  }){
    if(!this.ready)throw Error('GPUWideRadixSort not initialized');
    if(!keys||!values)throw Error('radix sort requires key/value buffers');
    if(!Number.isInteger(count)||count<0)throw Error('invalid radix count');
    if(!Number.isInteger(keyWords)||keyWords<1||keyWords>4){
      throw Error('keyWords must be 1..4');
    }
    if(!Number.isInteger(slot)||slot<0||slot>=this.jobSlots){
      throw Error('radix slot out of range');
    }
    if(count===0){
      return {
        keys,
        values,
        count,
        keyWords,
        digits:0,
        capacity:this.capacity,
        slot,
      };
    }

    this.ensureCapacity(count);

    const groups=Math.ceil(count/ITEMS_PER_GROUP);
    const histogramBlocks=Math.ceil(groups/HISTOGRAM_SCAN_BLOCK);
    const digits=keyWords*4;
    const dev=this.device;
    const histConfig=this.histConfigs[slot];

    dev.queue.writeBuffer(
      histConfig,
      0,
      new Uint32Array([
        groups,
        histogramBlocks,
        0,
        0,
      ])
    );

    let srcKeys=keys;
    let srcValues=values;
    let dstKeys=this.keysA;
    let dstValues=this.valuesA;

    for(let digit=0;digit<digits;digit++){
      const config=this.configs[slot][digit];
      dev.queue.writeBuffer(
        config,
        0,
        new Uint32Array([
          count,
          groups,
          histogramBlocks,
          digit,
        ])
      );

      encodePass(
        encoder,
        this.rankPipeline,
        bind(dev,this.rankLayout,[
          srcKeys,
          this.localRanks,
          this.histograms,
          config,
        ]),
        groups
      );

      encodePass(
        encoder,
        this.histPipelines.scanHistogramBlocks,
        bind(dev,this.histLayout,[
          this.histograms,
          this.groupOffsets,
          this.blockSums,
          histConfig,
        ]),
        histogramBlocks,
        HISTOGRAM_BINS
      );

      encodePass(
        encoder,
        this.histPipelines.scanHistogramBlockSums,
        bind(dev,this.histLayout,[
          this.blockSums,
          this.blockOffsets,
          this.binTotals,
          histConfig,
        ]),
        1,
        HISTOGRAM_BINS
      );

      encodePass(
        encoder,
        this.histPipelines.addHistogramBlockOffsets,
        bind(dev,this.histLayout,[
          this.groupOffsets,
          this.blockOffsets,
          this.dummy,
          histConfig,
        ]),
        Math.ceil(groups/ITEMS_PER_GROUP),
        HISTOGRAM_BINS
      );

      encodePass(
        encoder,
        this.histPipelines.scanBinTotals,
        bind(dev,this.histLayout,[
          this.binTotals,
          this.binBases,
          this.dummy,
          histConfig,
        ]),
        1
      );

      encodePass(
        encoder,
        this.scatterPipeline,
        bind(dev,this.scatterLayout,[
          srcKeys,
          srcValues,
          this.localRanks,
          this.groupOffsets,
          this.binBases,
          dstKeys,
          dstValues,
          config,
        ]),
        groups
      );

      srcKeys=dstKeys;
      srcValues=dstValues;
      if(dstKeys===this.keysA){
        dstKeys=this.keysB;
        dstValues=this.valuesB;
      }else{
        dstKeys=this.keysA;
        dstValues=this.valuesA;
      }
    }

    return {
      keys:srcKeys,
      values:srcValues,
      count,
      keyWords,
      digits,
      groups,
      histogramBlocks,
      capacity:this.capacity,
      passes:digits*6,
      slot,
    };
  }
}

export {
  ITEMS_PER_GROUP,
  HISTOGRAM_BINS,
  HISTOGRAM_SCAN_BLOCK,
  DEFAULT_SORT_SLOTS,
};
