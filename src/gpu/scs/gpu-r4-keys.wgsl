struct R4KeyConfig {
  count:u32,
  cellShift:u32,
  reserved0:u32,
  reserved1:u32,
};
@group(0) @binding(0) var<storage,read> records:array<vec4<u32>>;
@group(0) @binding(1) var<storage,read> stableIDs:array<u32>;
@group(0) @binding(2) var<storage,read_write> keys:array<vec4<u32>>;
@group(0) @binding(3) var<storage,read_write> values:array<u32>;
@group(0) @binding(4) var<uniform> cfg:R4KeyConfig;
@group(0) @binding(5) var<storage,read_write> cells:array<vec4<u32>>;

const PHI_Q16:i32=106039;
const ONE_Q16:i32=65536;
const CELL_BITS:u32=20u;
const CELL_BIAS:i32=524288;

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

fn physicalFixed(c:array<u32,8>)->array<i32,4>{
  let z=icosianNumerator(c);
  let phi=106039i;
  let one=65536i;
  var p:array<i32,4>;
  p[0]=(z[0]*one+z[1]*phi)/2i;
  p[1]=(z[2]*one+z[3]*phi)/2i;
  p[2]=(z[4]*one+z[5]*phi)/2i;
  p[3]=(z[6]*one+z[7]*phi)/2i;
  return p;
}

fn quantizedCell(p:array<i32,4>)->array<u32,4>{
  var c:array<u32,4>;
  for(var axis=0u;axis<4u;axis++){
    let q=p[axis]>>cfg.cellShift;
    c[axis]=u32(q+CELL_BIAS);
  }
  return c;
}

fn morton80(c:array<u32,4>)->vec3<u32>{
  var lo=0u;
  var mid=0u;
  var hi=0u;
  for(var bit=19i;bit>=0i;bit=bit-1i){
    var nibble=0u;
    for(var axis=0u;axis<4u;axis++){
      nibble=(nibble<<1u)|((c[axis]>>u32(bit))&1u);
    }
    hi=(hi<<4u)|(mid>>28u);
    mid=(mid<<4u)|(lo>>28u);
    lo=(lo<<4u)|nibble;
  }
  return vec3<u32>(lo,mid,hi);
}

@compute @workgroup_size(256)
fn buildPhysicalR4Keys(@builtin(global_invocation_id) gid:vec3<u32>){
  let i=gid.x;
  if(i>=cfg.count){return;}
  let cell=quantizedCell(physicalFixed(extract8(records[i])));
  cells[i]=vec4<u32>(cell[0],cell[1],cell[2],cell[3]);
  let key=morton80(cell);
  // Physical locality uses only the 80-bit Morton key globally.
  // Stable IDs remain a sidecar for consumers that need canonical local order.
  keys[i]=vec4<u32>(key.x,key.y,key.z,0u);
  values[i]=i;
}
