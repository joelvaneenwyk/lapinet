struct RangeConfig {
  count:u32,
  keyWords:u32,
  keyOffset:u32,
  consumerWorkgroupSize:u32,
};
@group(0) @binding(0) var<storage,read> keys:array<vec4<u32>>;
@group(0) @binding(1) var<storage,read_write> flags:array<u32>;
@group(0) @binding(2) var<storage,read> prefixes:array<u32>;
@group(0) @binding(3) var<storage,read_write> starts:array<u32>;
@group(0) @binding(4) var<storage,read_write> metadata:array<u32>;
@group(0) @binding(5) var<storage,read_write> indirectArgs:array<u32>;
@group(0) @binding(6) var<uniform> cfg:RangeConfig;

fn keyWord(v:vec4<u32>,word:u32)->u32{
  if(word==0u){return v.x;}
  if(word==1u){return v.y;}
  if(word==2u){return v.z;}
  return v.w;
}

fn sameKey(a:vec4<u32>,b:vec4<u32>)->bool{
  for(var i=0u;i<cfg.keyWords;i++){
    let word=cfg.keyOffset+i;
    if(keyWord(a,word)!=keyWord(b,word)){return false;}
  }
  return true;
}

@compute @workgroup_size(256)
fn markRunStarts(@builtin(global_invocation_id) gid:vec3<u32>){
  let i=gid.x;
  if(i>=cfg.count){return;}
  if(i==0u){
    flags[i]=1u;
  }else{
    flags[i]=select(1u,0u,sameKey(keys[i],keys[i-1u]));
  }
}

@compute @workgroup_size(256)
fn writeRunRanges(@builtin(global_invocation_id) gid:vec3<u32>){
  let i=gid.x;
  if(i>=cfg.count){return;}
  if(flags[i]!=0u){
    starts[prefixes[i]]=i;
  }
  if(i==cfg.count-1u){
    let occupied=prefixes[i]+flags[i];
    starts[occupied]=cfg.count;
    metadata[0]=occupied;
    metadata[1]=cfg.count;
    metadata[2]=cfg.keyWords;
    metadata[3]=cfg.keyOffset;
    let lanes=max(cfg.consumerWorkgroupSize,1u);
    indirectArgs[0]=(occupied+lanes-1u)/lanes;
    indirectArgs[1]=1u;
    indirectArgs[2]=1u;
    indirectArgs[3]=occupied;
  }
}
