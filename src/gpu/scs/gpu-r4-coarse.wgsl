struct CoarseConfig {
  generation:u32,
  reserved0:u32,
  reserved1:u32,
  reserved2:u32,
};
struct CoarseEntry {
  start:atomic<u32>,
  end:atomic<u32>,
  stamp:atomic<u32>,
  reserved:atomic<u32>,
};
@group(0) @binding(0) var<storage,read> sortedKeys:array<vec4<u32>>;
@group(0) @binding(1) var<storage,read> starts:array<u32>;
@group(0) @binding(2) var<storage,read> metadata:array<u32>;
@group(0) @binding(3) var<storage,read_write> coarse:array<CoarseEntry>;
@group(0) @binding(4) var<uniform> cfg:CoarseConfig;

fn coarseIndex(key:vec4<u32>)->u32{
  return (((key.z&0xffffu)<<4u)|(key.y>>28u))&0xfffffu;
}

@compute @workgroup_size(256)
fn buildR4CoarseLookup(@builtin(global_invocation_id) gid:vec3<u32>){
  let cell=gid.x;
  let occupied=metadata[0];
  if(cell>=occupied){return;}

  let current=coarseIndex(sortedKeys[starts[cell]]);
  var first=cell==0u;
  var last=cell+1u==occupied;
  if(cell>0u){
    first=first||coarseIndex(sortedKeys[starts[cell-1u]])!=current;
  }
  if(cell+1u<occupied){
    last=last||coarseIndex(sortedKeys[starts[cell+1u]])!=current;
  }

  if(first){
    atomicStore(&coarse[current].start,cell);
    atomicStore(&coarse[current].stamp,cfg.generation);
  }
  if(last){
    atomicStore(&coarse[current].end,cell+1u);
  }
}
