struct NeighborConfig {
  count:u32,
  generation:u32,
  radius:u32,
  reserved:u32,
};
struct NeighborMoment {
  count:u32,
  reserved0:u32,
  reserved1:u32,
  reserved2:u32,
  xLo:u32,
  xHi:u32,
  yLo:u32,
  yHi:u32,
  zLo:u32,
  zHi:u32,
  wLo:u32,
  wHi:u32,
};
struct CoarseEntry {
  start:atomic<u32>,
  end:atomic<u32>,
  stamp:atomic<u32>,
  reserved:atomic<u32>,
};
@group(0) @binding(0) var<storage,read> sortedKeys:array<vec4<u32>>;
@group(0) @binding(1) var<storage,read> sortedValues:array<u32>;
@group(0) @binding(2) var<storage,read> cellsByRecord:array<vec4<u32>>;
@group(0) @binding(3) var<storage,read> records:array<vec4<u32>>;
@group(0) @binding(4) var<storage,read> starts:array<u32>;
@group(0) @binding(5) var<storage,read> metadata:array<u32>;
@group(0) @binding(6) var<storage,read_write> coarse:array<CoarseEntry>;
@group(0) @binding(7) var<storage,read_write> neighborMoments:array<NeighborMoment>;
@group(0) @binding(8) var<uniform> cfg:NeighborConfig;

fn morton80(c:vec4<u32>)->vec3<u32>{
  var lo=0u;
  var mid=0u;
  var hi=0u;
  for(var bit=19i;bit>=0i;bit=bit-1i){
    let b=u32(bit);
    let nibble=
      (((c.x>>b)&1u)<<3u)|
      (((c.y>>b)&1u)<<2u)|
      (((c.z>>b)&1u)<<1u)|
      ((c.w>>b)&1u);
    hi=(hi<<4u)|(mid>>28u);
    mid=(mid<<4u)|(lo>>28u);
    lo=(lo<<4u)|nibble;
  }
  return vec3<u32>(lo,mid,hi);
}

fn compareSpatial(a:vec3<u32>,b:vec3<u32>)->i32{
  if(a.z!=b.z){return select(1,-1,a.z<b.z);}
  if(a.y!=b.y){return select(1,-1,a.y<b.y);}
  if(a.x!=b.x){return select(1,-1,a.x<b.x);}
  return 0;
}

fn keyAtCell(cell:u32)->vec3<u32>{
  let key=sortedKeys[starts[cell]];
  return vec3<u32>(key.x,key.y,key.z);
}

fn coarseIndex(key:vec3<u32>)->u32{
  return (((key.z&0xffffu)<<4u)|(key.y>>28u))&0xfffffu;
}

fn findOccupiedCell(queryKey:vec3<u32>)->u32{
  let coarseId=coarseIndex(queryKey);
  if(atomicLoad(&coarse[coarseId].stamp)!=cfg.generation){
    return 0xffffffffu;
  }
  var lo=atomicLoad(&coarse[coarseId].start);
  var hi=atomicLoad(&coarse[coarseId].end);
  loop{
    if(lo>=hi){break;}
    let mid=lo+(hi-lo)/2u;
    let cmp=compareSpatial(keyAtCell(mid),queryKey);
    if(cmp<0){
      lo=mid+1u;
    }else{
      hi=mid;
    }
  }
  let occupied=metadata[0];
  if(lo<occupied&&compareSpatial(keyAtCell(lo),queryKey)==0){
    return lo;
  }
  return 0xffffffffu;
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

@compute @workgroup_size(256)
fn aggregateR4StencilNeighbors(@builtin(global_invocation_id) gid:vec3<u32>){
  let sortedIndex=gid.x;
  if(sortedIndex>=cfg.count){return;}
  let record=sortedValues[sortedIndex];
  let cell=cellsByRecord[record];
  let radius=i32(cfg.radius);
  var total=0u;
  var sx=vec2<u32>(0u,0u);
  var sy=vec2<u32>(0u,0u);
  var sz=vec2<u32>(0u,0u);
  var sw=vec2<u32>(0u,0u);

  for(var d0=-radius;d0<=radius;d0=d0+1){
    for(var d1=-radius;d1<=radius;d1=d1+1){
      for(var d2=-radius;d2<=radius;d2=d2+1){
        for(var d3=-radius;d3<=radius;d3=d3+1){
          let t0=i32(cell.x)+d0;
          let t1=i32(cell.y)+d1;
          let t2=i32(cell.z)+d2;
          let t3=i32(cell.w)+d3;
          if(
            t0<0||t1<0||t2<0||t3<0||
            t0>=1048576||t1>=1048576||
            t2>=1048576||t3>=1048576
          ){continue;}

          let queryCell=vec4<u32>(
            u32(t0),u32(t1),u32(t2),u32(t3)
          );
          let found=findOccupiedCell(morton80(queryCell));
          if(found==0xffffffffu){continue;}

          let start=starts[found];
          let end=starts[found+1u];
          for(var j=start;j<end;j=j+1u){
            let neighborRecord=sortedValues[j];
            if(neighborRecord==record){continue;}
            let p=physicalFixed(extract8(records[neighborRecord]));
            sx=add64(sx,fromI32(p.x));
            sy=add64(sy,fromI32(p.y));
            sz=add64(sz,fromI32(p.z));
            sw=add64(sw,fromI32(p.w));
            total=total+1u;
          }
        }
      }
    }
  }

  neighborMoments[record]=NeighborMoment(
    total,0u,0u,0u,
    sx.x,sx.y,sy.x,sy.y,
    sz.x,sz.y,sw.x,sw.y
  );
}
