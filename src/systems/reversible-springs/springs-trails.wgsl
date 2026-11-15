// Persistent screen-space afterimages. This is display-only; it never changes simulation state.
struct TrailVertex {
 @builtin(position) position: vec4<f32>,
 @location(0) uv: vec2<f32>,
};
@group(0) @binding(0) var history: texture_2d<f32>;
@group(0) @binding(1) var historySampler: sampler;
@group(0) @binding(2) var<uniform> fade: vec4<f32>;
@vertex fn trailVertex(@builtin(vertex_index) vertex: u32)->TrailVertex {
 let tri=array<vec2<f32>,3>(
  vec2<f32>(-1.0,-1.0),vec2<f32>(3.0,-1.0),vec2<f32>(-1.0,3.0));
 let xy=tri[vertex];
 var v:TrailVertex;
 v.position=vec4<f32>(xy,0.0,1.0);
 v.uv=vec2<f32>((xy.x+1.0)*0.5,(1.0-xy.y)*0.5);
 return v;
}
@fragment fn trailFade(v:TrailVertex)->@location(0) vec4<f32> {
 let previous=textureSample(history,historySampler,v.uv).rgb;
 return vec4<f32>(previous*fade.x,1.0);
}
@fragment fn trailCompose(v:TrailVertex)->@location(0) vec4<f32> {
 let previous=textureSample(history,historySampler,v.uv).rgb;
 return vec4<f32>(previous,1.0);
}
