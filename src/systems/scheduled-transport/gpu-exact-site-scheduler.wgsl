// GPU exact-site autonomous E8 collision consumer.
// Sorting and sparse run construction are external reusable GPU primitives.
struct SchedulerConfig {
  count:u32,
  frame:u32,
  reserved0:u32,
  reserved1:u32,
};
struct PairRecord {
  records:vec4<u32>,
  info:vec4<u32>,
};

@group(0) @binding(0) var<storage,read_write> records:array<vec4<u32>>;
@group(0) @binding(1) var<storage,read> stableIDs:array<u32>;
@group(0) @binding(2) var<storage,read_write> sortedKeys:array<vec4<u32>>;
@group(0) @binding(3) var<storage,read_write> sortedValues:array<u32>;
@group(0) @binding(4) var<storage,read> starts:array<u32>;
@group(0) @binding(5) var<storage,read_write> metadata:array<u32>;
@group(0) @binding(6) var<storage,read_write> pairCounts:array<u32>;
@group(0) @binding(7) var<storage,read> pairOffsets:array<u32>;
@group(0) @binding(8) var<storage,read_write> pairs:array<PairRecord>;
@group(0) @binding(9) var<storage,read> reflectionTable:array<u32>;
@group(0) @binding(10) var<storage,read> rootDotTable:array<i32>;
@group(0) @binding(11) var<uniform> cfg:SchedulerConfig;

fn extractCoords8(record:vec4<u32>)->array<u32,8>{
  let lo=record.x;
  let mid=record.y;
  let hi=record.z;
  var c:array<u32,8>;
  c[0]=lo&4095u;
  c[1]=(lo>>12u)&4095u;
  c[2]=((lo>>24u)|(mid<<8u))&4095u;
  c[3]=(mid>>4u)&4095u;
  c[4]=(mid>>16u)&4095u;
  c[5]=((mid>>28u)|(hi<<4u))&4095u;
  c[6]=(hi>>8u)&4095u;
  c[7]=(hi>>20u)&4095u;
  return c;
}

fn morton96(c:array<u32,8>)->vec3<u32>{
  var lo=0u;
  var mid=0u;
  var hi=0u;
  for(var bit=11i;bit>=0i;bit=bit-1i){
    var octet=0u;
    for(var axis=0u;axis<8u;axis++){
      octet=(octet<<1u)|((c[axis]>>u32(bit))&1u);
    }
    hi=(hi<<8u)|(mid>>24u);
    mid=(mid<<8u)|(lo>>24u);
    lo=(lo<<8u)|octet;
  }
  return vec3<u32>(lo,mid,hi);
}

fn mix32(x:u32)->u32{
  var y=x;
  y=y^(y>>16u);
  y=y*0x7feb352du;
  y=y^(y>>15u);
  y=y*0x846ca68bu;
  y=y^(y>>16u);
  return y;
}

fn interactionControl(site:vec3<u32>,idA:u32,idB:u32,frame:u32)->u32{
  let lo=min(idA,idB);
  let hi=max(idA,idB);
  var h=mix32(frame^0x9e3779b9u);
  h=mix32(h^lo);
  h=mix32(h^(hi*0x85ebca6bu));
  h=mix32(h^(site.x*0x27d4eb2du));
  h=mix32(h^(site.y*0x165667b1u));
  h=mix32(h^(site.z*0x85ebca77u));
  return h%240u;
}

@compute @workgroup_size(128)
fn buildExactSiteKeys(@builtin(global_invocation_id) gid:vec3<u32>){
  let i=gid.x;
  if(i>=cfg.count){return;}
  let key=morton96(extractCoords8(records[i]));
  sortedKeys[i]=vec4<u32>(stableIDs[i],key.x,key.y,key.z);
  sortedValues[i]=i;
}

@compute @workgroup_size(128)
fn countPairsByCell(@builtin(global_invocation_id) gid:vec3<u32>){
  let cell=gid.x;
  if(cell>=cfg.count){return;}
  if(cell<metadata[0]){
    pairCounts[cell]=(starts[cell+1u]-starts[cell])/2u;
  }else{
    pairCounts[cell]=0u;
  }
}

@compute @workgroup_size(1)
fn writePairTotal(){
  if(cfg.count==0u){
    metadata[2]=0u;
    return;
  }
  let last=cfg.count-1u;
  metadata[2]=pairOffsets[last]+pairCounts[last];
}

@compute @workgroup_size(64)
fn emitCanonicalPairs(@builtin(global_invocation_id) gid:vec3<u32>){
  let cell=gid.x;
  if(cell>=metadata[0]){return;}
  let start=starts[cell];
  let end=starts[cell+1u];
  let count=(end-start)/2u;
  let outputBase=pairOffsets[cell];
  for(var j=0u;j<count;j++){
    let sortedA=start+2u*j;
    let sortedB=sortedA+1u;
    let keyA=sortedKeys[sortedA];
    let keyB=sortedKeys[sortedB];
    let recordA=sortedValues[sortedA];
    let recordB=sortedValues[sortedB];
    let control=interactionControl(
      records[recordA].xyz,
      keyA.x,
      keyB.x,
      cfg.frame
    );
    pairs[outputBase+j]=PairRecord(
      vec4<u32>(recordA,recordB,keyA.x,keyB.x),
      vec4<u32>(control,cell,j,0u)
    );
  }
}

@compute @workgroup_size(128)
fn applyE8Collisions(@builtin(global_invocation_id) gid:vec3<u32>){
  let pairIndex=gid.x;
  if(pairIndex>=metadata[2]){return;}
  var pair=pairs[pairIndex];
  let recordA=pair.records.x;
  let recordB=pair.records.y;
  let control=pair.info.x;
  let channelA=records[recordA].w;
  let channelB=records[recordB].w;
  let dotA=rootDotTable[channelA*240u+control];
  let dotB=rootDotTable[channelB*240u+control];
  if(dotA+dotB!=0){
    pair.info.w=0u;
    pairs[pairIndex]=pair;
    return;
  }
  let nextA=reflectionTable[channelA*240u+control];
  let nextB=reflectionTable[channelB*240u+control];
  records[recordA].w=nextA;
  records[recordB].w=nextB;
  let changed=select(0u,2u,nextA!=channelA||nextB!=channelB);
  pair.info.w=1u|changed;
  pairs[pairIndex]=pair;
}
