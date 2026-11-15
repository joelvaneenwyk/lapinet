struct HierarchyConfig {
  count:u32,
  prefixBits:u32,
  levelIndex:u32,
  reserved:u32,
};
struct NodeMoment {
  count:u32,
  start:u32,
  end:u32,
  prefixBits:u32,
  xLo:u32,
  xHi:u32,
  yLo:u32,
  yHi:u32,
  zLo:u32,
  zHi:u32,
  wLo:u32,
  wHi:u32,
};
@group(0) @binding(0) var<storage,read> sortedKeys:array<vec4<u32>>;
@group(0) @binding(1) var<storage,read> sortedValues:array<u32>;
@group(0) @binding(2) var<storage,read> records:array<vec4<u32>>;
@group(0) @binding(3) var<storage,read_write> flags:array<u32>;
@group(0) @binding(4) var<storage,read> prefixes:array<u32>;
@group(0) @binding(5) var<storage,read_write> starts:array<u32>;
@group(0) @binding(6) var<storage,read_write> metadata:array<u32>;
@group(0) @binding(7) var<storage,read_write> indirectArgs:array<u32>;
@group(0) @binding(8) var<storage,read_write> moments:array<NodeMoment>;
@group(0) @binding(9) var<uniform> cfg:HierarchyConfig;

fn spatialWord(key:vec4<u32>,word:u32)->u32{
  if(word==0u){return key.x;}
  if(word==1u){return key.y;}
  return key.z&0xffffu;
}

fn samePrefix80(a:vec4<u32>,b:vec4<u32>)->bool{
  let bits=cfg.prefixBits;
  if(bits==0u){return true;}

  let ah=spatialWord(a,2u);
  let bh=spatialWord(b,2u);
  if(bits<=16u){
    if(bits==16u){return ah==bh;}
    let shift=16u-bits;
    return (ah>>shift)==(bh>>shift);
  }
  if(ah!=bh){return false;}

  let am=spatialWord(a,1u);
  let bm=spatialWord(b,1u);
  if(bits<=48u){
    let rem=bits-16u;
    if(rem==32u){return am==bm;}
    let shift=32u-rem;
    return (am>>shift)==(bm>>shift);
  }
  if(am!=bm){return false;}

  let al=spatialWord(a,0u);
  let bl=spatialWord(b,0u);
  let rem=bits-48u;
  if(rem==32u){return al==bl;}
  let shift=32u-rem;
  return (al>>shift)==(bl>>shift);
}

fn extract8(r:vec4<u32>)->array<u32,8>{
  let lo=r.x;
  let mid=r.y;
  let hi=r.z;
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

fn signed12(value:u32)->i32{
  let v=i32(value&4095u);
  return select(v,v-4096i,v>=2048i);
}

fn icosianNumerator(c:array<u32,8>)->array<i32,8>{
  var k:array<i32,8>;
  for(var i=0u;i<8u;i=i+1u){
    k[i]=signed12(c[i]);
  }
  var z:array<i32,8>;
  z[0]=k[0];
  z[1]=k[1];
  z[2]=k[2];
  z[3]=k[3];
  z[4]=k[0]+k[1]+k[3]+2i*k[4];
  z[5]=k[0]+k[2]+k[3]+2i*k[5];
  z[6]=k[1]+k[2]+k[3]+2i*k[6];
  z[7]=k[0]+k[1]+k[2]+2i*k[7];
  return z;
}

fn physicalFixed(c:array<u32,8>)->vec4<i32>{
  let z=icosianNumerator(c);
  let phi=106039i;
  let one=65536i;
  return vec4<i32>(
    (z[0]*one+z[1]*phi)/2i,
    (z[2]*one+z[3]*phi)/2i,
    (z[4]*one+z[5]*phi)/2i,
    (z[6]*one+z[7]*phi)/2i
  );
}

fn add64(a:vec2<u32>,b:vec2<u32>)->vec2<u32>{
  let lo=a.x+b.x;
  let carry=select(0u,1u,lo<a.x);
  return vec2<u32>(lo,a.y+b.y+carry);
}

fn fromI32(x:i32)->vec2<u32>{
  return vec2<u32>(bitcast<u32>(x),select(0u,0xffffffffu,x<0i));
}

var<workgroup> sxLo:array<u32,256>;
var<workgroup> sxHi:array<u32,256>;
var<workgroup> syLo:array<u32,256>;
var<workgroup> syHi:array<u32,256>;
var<workgroup> szLo:array<u32,256>;
var<workgroup> szHi:array<u32,256>;
var<workgroup> swLo:array<u32,256>;
var<workgroup> swHi:array<u32,256>;

fn reduceMomentLane(lane:u32,stride:u32){
  if(lane<stride){
    var a=add64(
      vec2<u32>(sxLo[lane],sxHi[lane]),
      vec2<u32>(sxLo[lane+stride],sxHi[lane+stride])
    );
    sxLo[lane]=a.x; sxHi[lane]=a.y;
    a=add64(
      vec2<u32>(syLo[lane],syHi[lane]),
      vec2<u32>(syLo[lane+stride],syHi[lane+stride])
    );
    syLo[lane]=a.x; syHi[lane]=a.y;
    a=add64(
      vec2<u32>(szLo[lane],szHi[lane]),
      vec2<u32>(szLo[lane+stride],szHi[lane+stride])
    );
    szLo[lane]=a.x; szHi[lane]=a.y;
    a=add64(
      vec2<u32>(swLo[lane],swHi[lane]),
      vec2<u32>(swLo[lane+stride],swHi[lane+stride])
    );
    swLo[lane]=a.x; swHi[lane]=a.y;
  }
}

@compute @workgroup_size(256)
fn markPrefixStarts(@builtin(global_invocation_id) gid:vec3<u32>){
  let i=gid.x;
  if(i>=cfg.count){return;}
  if(i==0u){
    flags[i]=1u;
  }else{
    flags[i]=select(
      1u,
      0u,
      samePrefix80(sortedKeys[i],sortedKeys[i-1u])
    );
  }
}

@compute @workgroup_size(256)
fn writePrefixRanges(@builtin(global_invocation_id) gid:vec3<u32>){
  let i=gid.x;
  if(i>=cfg.count){return;}
  if(flags[i]!=0u){
    starts[prefixes[i]]=i;
  }
  if(i==cfg.count-1u){
    let nodes=prefixes[i]+flags[i];
    starts[nodes]=cfg.count;
    metadata[0]=nodes;
    metadata[1]=cfg.count;
    metadata[2]=cfg.prefixBits;
    metadata[3]=cfg.levelIndex;
    indirectArgs[0]=nodes;
    indirectArgs[1]=1u;
    indirectArgs[2]=1u;
    indirectArgs[3]=nodes;
  }
}

@compute @workgroup_size(256)
fn computeNodeMoments(
  @builtin(local_invocation_id) lid:vec3<u32>,
  @builtin(workgroup_id) wid:vec3<u32>
){
  let lane=lid.x;
  let node=wid.x;

  let start=starts[node];
  let end=starts[node+1u];
  var x=vec2<u32>(0u,0u);
  var y=vec2<u32>(0u,0u);
  var z=vec2<u32>(0u,0u);
  var w=vec2<u32>(0u,0u);

  var i=start+lane;
  loop{
    if(i>=end){break;}
    let record=sortedValues[i];
    let p=physicalFixed(extract8(records[record]));
    x=add64(x,fromI32(p.x));
    y=add64(y,fromI32(p.y));
    z=add64(z,fromI32(p.z));
    w=add64(w,fromI32(p.w));
    i=i+256u;
  }

  sxLo[lane]=x.x; sxHi[lane]=x.y;
  syLo[lane]=y.x; syHi[lane]=y.y;
  szLo[lane]=z.x; szHi[lane]=z.y;
  swLo[lane]=w.x; swHi[lane]=w.y;
  workgroupBarrier();

  reduceMomentLane(lane,128u);
  workgroupBarrier();
  reduceMomentLane(lane,64u);
  workgroupBarrier();
  reduceMomentLane(lane,32u);
  workgroupBarrier();
  reduceMomentLane(lane,16u);
  workgroupBarrier();
  reduceMomentLane(lane,8u);
  workgroupBarrier();
  reduceMomentLane(lane,4u);
  workgroupBarrier();
  reduceMomentLane(lane,2u);
  workgroupBarrier();
  reduceMomentLane(lane,1u);
  workgroupBarrier();

  if(lane==0u){
    moments[node]=NodeMoment(
      end-start,
      start,
      end,
      cfg.prefixBits,
      sxLo[0],sxHi[0],
      syLo[0],syHi[0],
      szLo[0],szHi[0],
      swLo[0],swHi[0]
    );
  }
}
