// Lapinet integer, pair-central, reversible GPU spring prototype.
struct Particle { x:vec4<i32>, p:vec4<i32>, };
struct Params {
 count:u32, operation:u32, mode:u32, unitScale:i32,
 cutoff2:i32, rest2:i32, stiffness:i32, restScale256:i32,
 alignment:i32, coupling:i32, pad0:i32, pad1:i32,
 cohesion:i32, separation:i32, steering:i32, pad2:i32,
};
@group(0) @binding(0) var<storage,read> current:array<Particle>;
@group(0) @binding(1) var<storage,read_write> next:array<Particle>;
@group(0) @binding(2) var<storage,read> rowStart:array<u32>;
@group(0) @binding(3) var<storage,read> neighborIDs:array<u32>;
@group(0) @binding(4) var<storage,read> edgeRest:array<vec4<i32>>;
@group(0) @binding(5) var<uniform> options:Params;
@group(0) @binding(6) var<storage,read> hiddenCurrent:array<vec4<i32>>;
@group(0) @binding(7) var<storage,read_write> hiddenNext:array<vec4<i32>>;
fn scaledRest2(base:i32)->i32{
 let scaled=(base*options.restScale256)/256i;
 return (scaled*options.restScale256)/256i;
}
fn scalarFor(delta:vec3<i32>,rest2:i32,stiffness:i32)->i32{
 let v=delta/options.unitScale;
 return clamp((dot(v,v)-rest2)*stiffness/max(1i,4i*rest2),-3i,3i);
}
// Six reflecting planes sit between valid integer coordinates.
// The same integer fold works for forward and backward drifts.
fn reflectAxis(position:i32,momentum:i32,direction:i32)->vec2<i32>{
 let bound=options.pad0;
 var x=position+direction*(momentum/256i);
 var p=momentum;
 loop{
  if(x<=bound&&x>=-bound){break;}
  if(x>bound){x=2i*bound+1i-x;}
  else{x=-2i*bound-1i-x;}
  p=-p;
 }
 return vec2<i32>(x,p);
}
@compute @workgroup_size(128)
fn springStage(@builtin(global_invocation_id) gid:vec3<u32>){
 let id=gid.x;
 if(id>=options.count){return;}
 var particle=current[id];
 var hidden=hiddenCurrent[id];
 // Ballistic mode skips every kick and auxiliary shear.
 if(options.mode==2u && options.operation!=1u && options.operation!=2u){
  next[id]=particle;hiddenNext[id]=hidden;return;
 }
 if(options.operation==8u||options.operation==9u){
  // Exact, position-dependent boid force: cohesion toward the local
  // neighborhood, short-range pair repulsion, and steering to a +X guide
  // point. The kick does not move positions, so operation 9 undoes 8
  // exactly at the same coordinates.
  var force=vec3<i32>(0);
  let radius=max(1i,options.pad2);
  let radius2=radius*radius;
  for(var j=0u;j<options.count;j++){
   if(j==id){continue;}
   let d=current[j].x.xyz-particle.x.xyz;
   let u=d/options.unitScale;
   let ds=dot(u,u);
   if(ds>options.cutoff2){continue;}
   force+=(d*options.cohesion)/256i;
   if(ds<=radius2){force-=(d*options.separation)/256i;}
  }
  let toGuide=vec3<i32>(options.pad1,0i,0i)-particle.x.xyz;
  force+=(toGuide*options.steering)/256i;
  let sign=select(1i,-1i,options.operation==9u);
  particle.p=vec4<i32>(particle.p.xyz+sign*force,0);
 }else if(options.operation>=4u){
  var force=vec3<i32>(0);
  let hiddenStage=options.operation==4u||options.operation==7u;
  for(var neighbor=0u;neighbor<options.count;neighbor++){
   if(neighbor==id){continue;}
   let dx=current[neighbor].x.xyz-particle.x.xyz;
   let u=dx/options.unitScale;
   if(dot(u,u)>options.cutoff2){continue;}
   if(hiddenStage){
    let dp=current[neighbor].p.xyz-particle.p.xyz;
    force+=(dp*options.alignment)/256i;
   }else{
    let dh=hiddenCurrent[neighbor].xyz-hidden.xyz;
    force-=(dh*options.coupling)/256i;
   }
  }
  let sign=select(1i,-1i,options.operation==6u||options.operation==7u);
  if(hiddenStage){
   hidden=vec4<i32>(hidden.xyz+sign*force,0);
  }else{
   particle.p=vec4<i32>(particle.p.xyz+sign*force,0);
  }
 }else if(options.operation==0u||options.operation==3u){
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
  if(options.pad0>0i){
   let bx=reflectAxis(particle.x.x,particle.p.x,sign);
   let by=reflectAxis(particle.x.y,particle.p.y,sign);
   let bz=reflectAxis(particle.x.z,particle.p.z,sign);
   particle.x=vec4<i32>(bx.x,by.x,bz.x,0);
   particle.p=vec4<i32>(bx.y,by.y,bz.y,0);
  }else{
   particle.x=vec4<i32>(particle.x.xyz+sign*(particle.p.xyz/256i),0);
  }
 }
 next[id]=particle;
 hiddenNext[id]=hidden;
}