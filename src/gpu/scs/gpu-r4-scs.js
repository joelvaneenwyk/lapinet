import {GPUR4SFCIndex} from './gpu-r4-sfc-index.js';
import {GPUR4NeighborLookup} from './gpu-r4-neighbor-lookup.js';
import {GPUR4PrefixHierarchy} from './gpu-r4-hierarchy.js';

export class GPUR4ScanCurveSpectrum {
  constructor(device,{index,neighbors,hierarchy}){
    this.device=device;
    this.index=index;
    this.neighbors=neighbors;
    this.hierarchy=hierarchy;
    this.ready=true;
  }

  static async create(device,{
    fetchImpl=globalThis.fetch,
    maxHierarchyLevels=6,
  }={}){
    if(!device)throw Error('GPUR4ScanCurveSpectrum requires GPUDevice');
    const index=await GPUR4SFCIndex.create(device,{fetchImpl});
    const [neighbors,hierarchy]=await Promise.all([
      GPUR4NeighborLookup.create(device,{fetchImpl}),
      GPUR4PrefixHierarchy.create(device,{
        scan:index.scan,
        maxLevels:maxHierarchyLevels,
        fetchImpl,
      }),
    ]);
    return new GPUR4ScanCurveSpectrum(device,{
      index,neighbors,hierarchy
    });
  }

  prepare(count,{
    prefixBits=[20,40,60,80],
  }={}){
    if(!Number.isInteger(count)||count<1)
      throw Error('invalid SCS capacity');

    this.index.ensureCapacity(count);
    this.index.sorter.ensureCapacity(count);
    this.index.ranges.ensureCapacity(count);
    this.neighbors.ensureCapacity(count);
    this.hierarchy.ensureCapacity(count,prefixBits.length);

    // R4 uses the 80 meaningful Morton bits / 10 radix digits. An even
    // number of ping-pong passes finishes in the B buffers.
    const frequencyLevels=prefixBits.map((bits,index)=>({
      prefixBits:bits,
      starts:this.hierarchy.levels[index].starts,
      particleNodeIDs:this.hierarchy.levels[index].prefixes,
      moments:this.hierarchy.levels[index].moments,
      metadata:this.hierarchy.levels[index].metadata,
    }));

    return Object.freeze({
      count,
      spatialKeys:this.index.sorter.keysB,
      spatialOrder:this.index.sorter.valuesB,
      quantizedCells:this.index.cells,
      occupiedCellStarts:this.index.ranges.starts,
      occupiedCellMetadata:this.index.ranges.metadata,
      localMoments:this.neighbors.neighborMoments,
      coarseLookup:this.neighbors.coarseLookup,
      neighborConfig:this.neighbors.neighborConfig,
      frequencyLevels:Object.freeze(frequencyLevels),
    });
  }

  encode(encoder,{
    records,
    stableIDs,
    count,
    cellShift=16,
    neighborRadius=1,
    prefixBits=[20,40,60,80],
    topologyDispatch=null,
  }){
    if(!this.ready)throw Error('GPUR4ScanCurveSpectrum not initialized');

    const index=this.index.encode(encoder,{
      records,
      stableIDs,
      count,
      cellShift,
      topologyDispatch,
    });
    const local=this.neighbors.encode(encoder,index,{
      radius:neighborRadius,
    });
    const hierarchy=this.hierarchy.encode(encoder,index,{
      prefixBits,
    });

    return {
      count,
      cellShift,
      neighborRadius,
      prefixBits:[...prefixBits],
      index,
      local,
      hierarchy,
      gpuResident:true,
      products:Object.freeze({
        spatialOrder:index.sortedValues,
        occupiedCellStarts:index.ranges.starts,
        localMoments:local.neighborMoments,
        frequencyLevels:hierarchy.levels,
      }),
    };
  }

  destroy(){
    this.hierarchy.destroy();
    this.neighbors.destroy();
    this.index.destroy();
    this.ready=false;
  }
}
