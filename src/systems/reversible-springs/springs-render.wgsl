// GPU-resident visualization of the same integer spring state consumed by
// the reversible compute solver. No CPU readback during animation.
struct Particle {x:vec4<i32>, p:vec4<i32>};
struct ViewParams {
 resolution:vec2<f32>,
 scale:f32,
 sizePx:f32,
 yaw:f32,
 pitch:f32,
 edgeOpacity:f32,
 dynamicCutoffSquared:f32,
 dynamicGate:vec4<i32>,
 center:vec4<f32>,
 boxExtent:vec4<f32>,
};
@group(0) @binding(0) var<storage,read> particles:array<Particle>;
@group(0) @binding(1) var<uniform> view:ViewParams;
@group(0) @binding(2) var<storage,read> springEdges:array<vec2<u32>>;
struct Out {
 @builtin(position) position:vec4<f32>,
 @location(0) local:vec2<f32>,
 @location(1) tint:vec3<f32>,
};
@vertex
fn vertexMain(@builtin(vertex_index) vertex:u32,@builtin(instance_index) particleId:u32)->Out{
 let p=vec3<f32>(particles[particleId].x.xyz)-view.center.xyz;
 let cy=cos(view.yaw);
 let sy=sin(view.yaw);
 let cp=cos(view.pitch);
 let sp=sin(view.pitch);
 let x=cy*p.x+sy*p.z;
 let z=cy*p.z-sy*p.x;
 let y=cp*p.y-sp*z;
 let aspect=view.resolution.x/max(view.resolution.y,1.0);
 let base=vec2<f32>(x/max(aspect,1e-4),y)*view.scale;
 var corners=array<vec2<f32>,4>(
  vec2<f32>(-1.0,-1.0),
  vec2<f32>( 1.0,-1.0),
  vec2<f32>(-1.0, 1.0),
  vec2<f32>( 1.0, 1.0)
 );
 let corner=corners[vertex];
 let px=vec2<f32>(
  corner.x*view.sizePx*2.0/max(view.resolution.x,1.0),
  corner.y*view.sizePx*2.0/max(view.resolution.y,1.0)
 );
 var output:Out;
 output.position=vec4<f32>(base+px,0.5,1.0);
 output.local=corner;
 let normalizedZ=clamp(0.5+z*view.scale*0.5,0.0,1.0);
 output.tint=mix(vec3<f32>(0.24,0.64,0.95),vec3<f32>(0.92,0.78,0.45),normalizedZ);
 return output;
}
@fragment
fn fragmentMain(f:Out)->@location(0) vec4<f32>{
 let r=dot(f.local,f.local);
 if(r>1.0){discard;}
 let light=0.42+0.58*sqrt(max(0.0,1.0-r));
 return vec4<f32>(f.tint*light,1.0);
}

struct SpringEdgeOut {
 @builtin(position) position:vec4<f32>,
 @location(0) color:vec4<f32>,
};
@vertex
fn edgeVertex(@builtin(vertex_index) vertex:u32,
              @builtin(instance_index) edge:u32)->SpringEdgeOut{
 let pair=springEdges[edge];
 let p0=particles[pair.x].x.xyz;
 let p1=particles[pair.y].x.xyz;
 let delta=p1-p0;
 let d2=dot(vec3<f32>(delta),vec3<f32>(delta));
 let dWorld=delta/max(1i,view.dynamicGate.x);
 let visible=(view.dynamicGate.z==0i||
              dot(dWorld,dWorld)<=view.dynamicGate.y);
 let source=select(p0,p1,vertex==1u);
 let p=vec3<f32>(source)-view.center.xyz;
 let cy=cos(view.yaw);
 let sy=sin(view.yaw);
 let cp=cos(view.pitch);
 let sp=sin(view.pitch);
 let x=cy*p.x+sy*p.z;
 let z=cy*p.z-sy*p.x;
 let y=cp*p.y-sp*z;
 let aspect=view.resolution.x/max(view.resolution.y,1.0);
 var result:SpringEdgeOut;
 if(visible){
  result.position=vec4<f32>(
   vec2<f32>(x/max(aspect,1e-4),y)*view.scale,0.6,1.0);
 }else{
  result.position=vec4<f32>(3.0,3.0,0.6,1.0);
 }
 let intensity=clamp(sqrt(max(d2,0.0))*view.scale*4.0,0.0,1.0);
 result.color=vec4<f32>(mix(
  vec3<f32>(0.35,0.78,0.97),
  vec3<f32>(0.92,0.62,0.40),intensity),
  view.edgeOpacity);
 return result;
}
// Direction arrows, sampled every third particle. These expose velocity
// alignment without changing the simulation, particle positions, or trails.
@vertex
fn velocityVertex(@builtin(vertex_index) vertex:u32,
                  @builtin(instance_index) glyph:u32)->SpringEdgeOut{
 let id=glyph*3u;
 let position=vec3<f32>(particles[id].x.xyz)-view.center.xyz;
 let momentum=vec3<f32>(particles[id].p.xyz);
 let cy=cos(view.yaw);
 let sy=sin(view.yaw);
 let cp=cos(view.pitch);
 let sp=sin(view.pitch);
 let x=cy*position.x+sy*position.z;
 let z=cy*position.z-sy*position.x;
 let y=cp*position.y-sp*z;
 let aspect=view.resolution.x/max(view.resolution.y,1.0);
 let base=vec2<f32>(x/max(aspect,1e-4),y)*view.scale;
 let vx=cy*momentum.x+sy*momentum.z;
 let vz=cy*momentum.z-sy*momentum.x;
 let vy=cp*momentum.y-sp*vz;
 let direction=vec2<f32>(vx,vy);
 let speed=length(direction);
 let unit=select(vec2<f32>(0.0),direction/max(speed,0.0001),speed>0.0001);
 let pixels=vec2<f32>(2.0*21.0/max(view.resolution.x,1.0),
                        2.0*21.0/max(view.resolution.y,1.0));
 let arrow=unit*pixels;
 let wing=vec2<f32>(-unit.y,unit.x)*pixels*0.20;
 let tip=base+arrow;
 var endpoint=base;
 switch(vertex){
  case 0u:{endpoint=base;}
  case 1u:{endpoint=tip;}
  case 2u,4u:{endpoint=tip;}
  case 3u:{endpoint=tip-arrow*0.32+wing;}
  default:{endpoint=tip-arrow*0.32-wing;}
 }
 var out:SpringEdgeOut;
 out.position=vec4<f32>(endpoint,0.56,1.0);
 out.color=select(vec4<f32>(1.0,0.65,0.32,0.82),
                  vec4<f32>(0.28,0.94,0.94,0.82),momentum.x>=0.0);
 return out;
}
// Twelve wireframe edges of a centered axis-aligned reflecting enclosure.
@vertex
fn boxVertex(@builtin(vertex_index) vertex:u32)->SpringEdgeOut{
 let pairs=array<vec2<u32>,12>(
  vec2<u32>(0u,1u),vec2<u32>(2u,3u),
  vec2<u32>(4u,5u),vec2<u32>(6u,7u),
  vec2<u32>(0u,2u),vec2<u32>(1u,3u),
  vec2<u32>(4u,6u),vec2<u32>(5u,7u),
  vec2<u32>(0u,4u),vec2<u32>(1u,5u),
  vec2<u32>(2u,6u),vec2<u32>(3u,7u)
 );
 let pair=pairs[vertex/2u];
 let corner=select(pair.x,pair.y,(vertex%2u)==1u);
 let extent=view.boxExtent.x;
 let point=vec3<f32>(
  select(-extent,extent,(corner&1u)!=0u),
  select(-extent,extent,(corner&2u)!=0u),
  select(-extent,extent,(corner&4u)!=0u)
 )-view.center.xyz;
 let cy=cos(view.yaw);
 let sy=sin(view.yaw);
 let cp=cos(view.pitch);
 let sp=sin(view.pitch);
 let x=cy*point.x+sy*point.z;
 let z=cy*point.z-sy*point.x;
 let y=cp*point.y-sp*z;
 let aspect=view.resolution.x/max(view.resolution.y,1.0);
 var result:SpringEdgeOut;
 result.position=vec4<f32>(vec2<f32>(x/max(aspect,1e-4),y)*view.scale,0.65,1.0);
 result.color=vec4<f32>(0.48,0.77,0.95,0.38);
 return result;
}
// Static 3D reference lattice, independent of moving particle connections.
@group(0) @binding(3) var<storage,read> latticeSites:array<vec4<f32>>;
@vertex
fn latticeVertex(@builtin(vertex_index) vertex:u32)->SpringEdgeOut{
 let p=latticeSites[vertex].xyz-view.center.xyz;
 let cy=cos(view.yaw);
 let sy=sin(view.yaw);
 let cp=cos(view.pitch);
 let sp=sin(view.pitch);
 let x=cy*p.x+sy*p.z;
 let z=cy*p.z-sy*p.x;
 let y=cp*p.y-sp*z;
 let aspect=view.resolution.x/max(view.resolution.y,1.0);
 var result:SpringEdgeOut;
 result.position=vec4<f32>(vec2<f32>(x/max(aspect,1e-4),y)*view.scale,0.67,1.0);
 result.color=vec4<f32>(0.45,0.72,0.82,0.28);
 return result;
}
@vertex
fn h4Vertex(@builtin(vertex_index) vertex:u32)->SpringEdgeOut{
 let p=latticeSites[vertex].xyz-view.center.xyz;
 let cy=cos(view.yaw);
 let sy=sin(view.yaw);
 let cp=cos(view.pitch);
 let sp=sin(view.pitch);
 let x=cy*p.x+sy*p.z;
 let z=cy*p.z-sy*p.x;
 let y=cp*p.y-sp*z;
 let aspect=view.resolution.x/max(view.resolution.y,1.0);
 var result:SpringEdgeOut;
 result.position=vec4<f32>(vec2<f32>(x/max(aspect,1e-4),y)*view.scale,0.67,1.0);
 result.color=vec4<f32>(0.96,0.66,0.31,0.44);
 return result;
}
@fragment
fn edgeFragment(v:SpringEdgeOut)->@location(0) vec4<f32>{
 return v.color;
}
