struct RadixConfig {
  count:u32,
  groups:u32,
  histogramBlocks:u32,
  digit:u32,
};
@group(0) @binding(0) var<storage,read> keys:array<vec4<u32>>;
@group(0) @binding(1) var<storage,read_write> localRanks:array<u32>;
@group(0) @binding(2) var<storage,read_write> histograms:array<u32>;
@group(0) @binding(3) var<uniform> cfg:RadixConfig;

var<workgroup> localHistogram:array<atomic<u32>,256>;
var<workgroup> localOrder:array<u32,256>;
var<workgroup> localRankByLane:array<u32,256>;
var<workgroup> localBinStart:array<u32,256>;

fn keyDigit(key:vec4<u32>,digit:u32)->u32{
  let word=digit>>2u;
  let shift=(digit&3u)*8u;
  if(word==0u){return (key.x>>shift)&255u;}
  if(word==1u){return (key.y>>shift)&255u;}
  if(word==2u){return (key.z>>shift)&255u;}
  return (key.w>>shift)&255u;
}

@compute @workgroup_size(256)
fn histogramAndLocalRank(
  @builtin(global_invocation_id) gid:vec3<u32>,
  @builtin(local_invocation_id) lid:vec3<u32>,
  @builtin(workgroup_id) wid:vec3<u32>
){
  let lane=lid.x;
  let i=gid.x;
  atomicStore(&localHistogram[lane],0u);
  localBinStart[lane]=0xffffffffu;
  // All histogram bins must be zero before any lane increments one.
  workgroupBarrier();

  var sortDigit=256u;
  if(i<cfg.count){
    sortDigit=keyDigit(keys[i],cfg.digit);
    atomicAdd(&localHistogram[sortDigit],1u);
  }
  localOrder[lane]=(sortDigit<<8u)|lane;
  workgroupBarrier();

  for(var k=2u;k<=256u;k=k<<1u){
    for(var j=k>>1u;j>0u;j=j>>1u){
      let partner=lane^j;
      let a=localOrder[lane];
      let b=localOrder[partner];
      let ascending=(lane&k)==0u;
      let lower=(lane&j)==0u;
      let takeMin=(lower==ascending);
      let lo=min(a,b);
      let hi=max(a,b);
      let next=select(hi,lo,takeMin);
      workgroupBarrier();
      localOrder[lane]=next;
      workgroupBarrier();
    }
  }

  let packed=localOrder[lane];
  let sortedDigit=packed>>8u;
  let originalLane=packed&255u;
  if(sortedDigit<256u){
    var isStart=lane==0u;
    if(lane>0u){
      isStart=isStart||((localOrder[lane-1u]>>8u)!=sortedDigit);
    }
    if(isStart){localBinStart[sortedDigit]=lane;}
  }
  workgroupBarrier();

  if(sortedDigit<256u){
    localRankByLane[originalLane]=lane-localBinStart[sortedDigit];
  }
  workgroupBarrier();

  if(i<cfg.count){
    localRanks[i]=localRankByLane[lane];
  }
  if(wid.x<cfg.groups){
    histograms[lane*cfg.groups+wid.x]=
      atomicLoad(&localHistogram[lane]);
  }
}
