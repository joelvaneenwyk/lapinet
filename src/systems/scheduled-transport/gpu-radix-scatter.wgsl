struct RadixConfig {
  count:u32,
  groups:u32,
  histogramBlocks:u32,
  digit:u32,
};
@group(0) @binding(0) var<storage,read> keysIn:array<vec4<u32>>;
@group(0) @binding(1) var<storage,read> valuesIn:array<u32>;
@group(0) @binding(2) var<storage,read> localRanks:array<u32>;
@group(0) @binding(3) var<storage,read> groupOffsets:array<u32>;
@group(0) @binding(4) var<storage,read> binBases:array<u32>;
@group(0) @binding(5) var<storage,read_write> keysOut:array<vec4<u32>>;
@group(0) @binding(6) var<storage,read_write> valuesOut:array<u32>;
@group(0) @binding(7) var<uniform> cfg:RadixConfig;

fn keyDigit(key:vec4<u32>,digit:u32)->u32{
  let word=digit>>2u;
  let shift=(digit&3u)*8u;
  if(word==0u){return (key.x>>shift)&255u;}
  if(word==1u){return (key.y>>shift)&255u;}
  if(word==2u){return (key.z>>shift)&255u;}
  return (key.w>>shift)&255u;
}

@compute @workgroup_size(256)
fn scatterDigit(@builtin(global_invocation_id) gid:vec3<u32>){
  let i=gid.x;
  if(i>=cfg.count){return;}
  let digit=keyDigit(keysIn[i],cfg.digit);
  let group=i/256u;
  let position=
    binBases[digit]+
    groupOffsets[digit*cfg.groups+group]+
    localRanks[i];
  keysOut[position]=keysIn[i];
  valuesOut[position]=valuesIn[i];
}
