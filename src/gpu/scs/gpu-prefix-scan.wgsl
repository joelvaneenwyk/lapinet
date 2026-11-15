// Generic arbitrary-size exclusive u32 prefix scan.
// Unique module-wide binding namespace.
struct ScanConfig {
  count:u32,
  reserved0:u32,
  reserved1:u32,
  reserved2:u32,
};
@group(0) @binding(0) var<storage,read> inputValues:array<u32>;
@group(0) @binding(1) var<storage,read_write> outputValues:array<u32>;
@group(0) @binding(2) var<storage,read_write> blockSums:array<u32>;
@group(0) @binding(3) var<uniform> cfg:ScanConfig;

var<workgroup> scratch:array<u32,512>;

@compute @workgroup_size(256)
fn scanBlocks(
  @builtin(local_invocation_id) lid:vec3<u32>,
  @builtin(workgroup_id) wid:vec3<u32>
){
  let lane=lid.x;
  let base=wid.x*512u;
  let i0=base+lane;
  let i1=base+lane+256u;

  scratch[lane]=0u;
  scratch[lane+256u]=0u;
  if(i0<cfg.count){scratch[lane]=inputValues[i0];}
  if(i1<cfg.count){scratch[lane+256u]=inputValues[i1];}
  workgroupBarrier();

  var offset=1u;
  var d=256u;
  loop {
    if(d==0u){break;}
    if(lane<d){
      let ai=offset*(2u*lane+1u)-1u;
      let bi=offset*(2u*lane+2u)-1u;
      scratch[bi]=scratch[bi]+scratch[ai];
    }
    offset=offset<<1u;
    d=d>>1u;
    workgroupBarrier();
  }

  if(lane==0u){
    blockSums[wid.x]=scratch[511u];
    scratch[511u]=0u;
  }
  workgroupBarrier();

  d=1u;
  offset=256u;
  loop {
    if(d>256u){break;}
    if(lane<d){
      let ai=offset*(2u*lane+1u)-1u;
      let bi=offset*(2u*lane+2u)-1u;
      let t=scratch[ai];
      scratch[ai]=scratch[bi];
      scratch[bi]=scratch[bi]+t;
    }
    offset=offset>>1u;
    d=d<<1u;
    workgroupBarrier();
  }

  if(i0<cfg.count){outputValues[i0]=scratch[lane];}
  if(i1<cfg.count){outputValues[i1]=scratch[lane+256u];}
}

struct OffsetConfig {
  count:u32,
  blockSize:u32,
  reserved0:u32,
  reserved1:u32,
};
@group(0) @binding(4) var<storage,read_write> offsetValues:array<u32>;
@group(0) @binding(5) var<storage,read> scannedBlockOffsets:array<u32>;
@group(0) @binding(6) var<uniform> offsetCfg:OffsetConfig;

@compute @workgroup_size(256)
fn addBlockOffsets(@builtin(global_invocation_id) gid:vec3<u32>){
  let i=gid.x;
  if(i>=offsetCfg.count){return;}
  let block=i/offsetCfg.blockSize;
  offsetValues[i]=offsetValues[i]+scannedBlockOffsets[block];
}
