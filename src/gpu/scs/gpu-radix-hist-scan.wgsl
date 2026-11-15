struct HistScanConfig {
  groups:u32,
  blocksPerBin:u32,
  reserved0:u32,
  reserved1:u32,
};
@group(0) @binding(0) var<storage,read_write> a:array<u32>;
@group(0) @binding(1) var<storage,read_write> b:array<u32>;
@group(0) @binding(2) var<storage,read_write> c:array<u32>;
@group(0) @binding(3) var<uniform> cfg:HistScanConfig;

var<workgroup> scratch512:array<u32,512>;
var<workgroup> scratch256:array<u32,256>;

fn upsweep512(lane:u32){
  var offset=1u;
  var d=256u;
  loop{
    if(d==0u){break;}
    if(lane<d){
      let ai=offset*(2u*lane+1u)-1u;
      let bi=offset*(2u*lane+2u)-1u;
      scratch512[bi]=scratch512[bi]+scratch512[ai];
    }
    offset=offset<<1u;
    d=d>>1u;
    workgroupBarrier();
  }
}
fn downsweep512(lane:u32){
  var d=1u;
  var offset=256u;
  loop{
    if(d>256u){break;}
    if(lane<d){
      let ai=offset*(2u*lane+1u)-1u;
      let bi=offset*(2u*lane+2u)-1u;
      let t=scratch512[ai];
      scratch512[ai]=scratch512[bi];
      scratch512[bi]=scratch512[bi]+t;
    }
    offset=offset>>1u;
    d=d<<1u;
    workgroupBarrier();
  }
}

@compute @workgroup_size(256)
fn scanHistogramBlocks(
  @builtin(local_invocation_id) lid:vec3<u32>,
  @builtin(workgroup_id) wid:vec3<u32>
){
  let lane=lid.x;
  let bin=wid.y;
  let block=wid.x;
  let base=block*512u;
  let g0=base+lane;
  let g1=base+lane+256u;

  var v0=0u;
  var v1=0u;
  if(g0<cfg.groups){v0=a[bin*cfg.groups+g0];}
  if(g1<cfg.groups){v1=a[bin*cfg.groups+g1];}
  scratch512[lane]=v0;
  scratch512[lane+256u]=v1;
  workgroupBarrier();

  upsweep512(lane);
  if(lane==0u){
    c[bin*cfg.blocksPerBin+block]=scratch512[511u];
    scratch512[511u]=0u;
  }
  workgroupBarrier();
  downsweep512(lane);

  if(g0<cfg.groups){b[bin*cfg.groups+g0]=scratch512[lane];}
  if(g1<cfg.groups){b[bin*cfg.groups+g1]=scratch512[lane+256u];}
}

@compute @workgroup_size(256)
fn scanHistogramBlockSums(
  @builtin(local_invocation_id) lid:vec3<u32>,
  @builtin(workgroup_id) wid:vec3<u32>
){
  let lane=lid.x;
  let bin=wid.y;
  let i0=lane;
  let i1=lane+256u;
  var v0=0u;
  var v1=0u;
  if(i0<cfg.blocksPerBin){v0=a[bin*cfg.blocksPerBin+i0];}
  if(i1<cfg.blocksPerBin){v1=a[bin*cfg.blocksPerBin+i1];}
  scratch512[lane]=v0;
  scratch512[lane+256u]=v1;
  workgroupBarrier();

  upsweep512(lane);
  if(lane==0u){
    c[bin]=scratch512[511u];
    scratch512[511u]=0u;
  }
  workgroupBarrier();
  downsweep512(lane);

  if(i0<cfg.blocksPerBin){
    b[bin*cfg.blocksPerBin+i0]=scratch512[lane];
  }
  if(i1<cfg.blocksPerBin){
    b[bin*cfg.blocksPerBin+i1]=scratch512[lane+256u];
  }
}

@compute @workgroup_size(256)
fn addHistogramBlockOffsets(
  @builtin(global_invocation_id) gid:vec3<u32>
){
  let group=gid.x;
  let bin=gid.y;
  if(group>=cfg.groups||bin>=256u){return;}
  let block=group/512u;
  let index=bin*cfg.groups+group;
  a[index]=a[index]+b[bin*cfg.blocksPerBin+block];
}

@compute @workgroup_size(256)
fn scanBinTotals(@builtin(local_invocation_id) lid:vec3<u32>){
  let lane=lid.x;
  scratch256[lane]=a[lane];
  workgroupBarrier();

  var offset=1u;
  for(var d=128u;d>0u;d=d>>1u){
    if(lane<d){
      let ai=offset*(2u*lane+1u)-1u;
      let bi=offset*(2u*lane+2u)-1u;
      scratch256[bi]=scratch256[bi]+scratch256[ai];
    }
    offset=offset<<1u;
    workgroupBarrier();
  }
  if(lane==0u){scratch256[255u]=0u;}
  workgroupBarrier();

  var d=1u;
  offset=128u;
  loop{
    if(d>128u){break;}
    if(lane<d){
      let ai=offset*(2u*lane+1u)-1u;
      let bi=offset*(2u*lane+2u)-1u;
      let t=scratch256[ai];
      scratch256[ai]=scratch256[bi];
      scratch256[bi]=scratch256[bi]+t;
    }
    offset=offset>>1u;
    d=d<<1u;
    workgroupBarrier();
  }
  b[lane]=scratch256[lane];
}
