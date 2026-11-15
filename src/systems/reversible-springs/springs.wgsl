// Lapinet integer, pair-central, reversible GPU spring prototype.
struct Particle { x:vec4<i32>, p:vec4<i32>, };
struct Params {
 count:u32, operation:u32, mode:u32, unitScale:i32,
 cutoff2:i32, rest2:i32, stiffness:i32, restScale256:i32,
};
@group(0) @binding(0) var<storage,read> current:array<Particle>;
@group(0) @binding(1) var<storage,read_write> next:array<Particle>;
@group(0) @binding(2) var<storage,read> rowStart:array<u32>;
@group(0) @binding(3) var<storage,read> neighborIDs:array<u32>;
@group(0) @binding(4) var<storage,read> edgeRest:array<vec4<i32>>;
@group(0) @binding(5) var<uniform> options:Params;
fn scaledRest2(base:i32)->i32{
 let scaled=(base*options.restScale256)/256i;
 return (scaled*options.restScale256)/256i;
}
fn scalarFor(delta:vec3<i32>,rest2:i32,stiffness:i32)->i32{
 let v=delta/options.unitScale;
 return clamp((dot(v,v)-rest2)*stiffness/max(1i,4i*rest2),-3i,3i);
}
@compute @workgroup_size(128)
fn springStage(@builtin(global_invocation_id) gid:vec3<u32>){
 let id=gid.x;
 if(id>=options.count){return;}
 var particle=current[id];
 if(options.operation==0u||options.operation==3u){
  var f=vec3<i32>(0);
  if(options.mode==1u){
   for(var j=0u;j<options.count;j++){
    if(j==id){continue;}
    let d=current[j].x.xyz-particle.x.xyz;
    let v=d/options.unitScale;
    if(dot(v,v)>options.cutoff2){continue;}
    f+=scalarFor(d,scaledRest2(options.rest2),options.stiffness)*d;
   }
  }else{
   for(var edge=rowStart[id];edge<rowStart[id+1u];edge++){
    let rest=edgeRest[edge];
    let d=current[neighborIDs[edge]].x.xyz-particle.x.xyz;
    let r=rest.xyz/options.unitScale;
    f+=scalarFor(d,scaledRest2(dot(r,r)),options.stiffness)*d;
   }
  }
  let sign=select(1i,-1i,options.operation==3u);
  particle.p=vec4<i32>(particle.p.xyz+sign*f,0);
 }else{
  let sign=select(1i,-1i,options.operation==2u);
  particle.x=vec4<i32>(particle.x.xyz+sign*(particle.p.xyz/256i),0);
 }
 next[id]=particle;
}