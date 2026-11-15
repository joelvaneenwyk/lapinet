struct CursorUniforms {
  pointer: vec4<f32>, // xy = normalized screen position, z = active, w = enabled
  style: vec4<f32>,   // x = scale, y = opacity, zw = viewport pixels
  color: vec4<f32>,
};

@group(0) @binding(0) var<uniform> cursor: CursorUniforms;

struct VertexOut {
  @builtin(position) position: vec4<f32>,
};

@vertex
fn vertexMain(@builtin(vertex_index) index: u32) -> VertexOut {
  var positions = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 3.0, -1.0),
    vec2<f32>(-1.0,  3.0)
  );

  var out: VertexOut;
  out.position = vec4<f32>(positions[index], 0.0, 1.0);
  return out;
}

fn pointerCross(pixel: vec2<f32>) -> f32 {
  let pointerPixel = cursor.pointer.xy * cursor.style.zw;
  let d = abs(pixel - pointerPixel);
  let scale = clamp(cursor.style.x, 0.25, 4.0);
  let outer = 8.0 * scale;
  let gap = 2.25 * scale;
  let thickness = 0.75;

  let vertical =
    (1.0 - smoothstep(thickness, thickness + 0.9, d.x)) *
    step(gap, d.y) *
    step(d.y, outer);
  let horizontal =
    (1.0 - smoothstep(thickness, thickness + 0.9, d.y)) *
    step(gap, d.x) *
    step(d.x, outer);

  return max(vertical, horizontal);
}

@fragment
fn fragmentMain(in: VertexOut) -> @location(0) vec4<f32> {
  if (cursor.pointer.z < 0.5 || cursor.pointer.w < 0.5) {
    return vec4<f32>(0.0);
  }

  let cross = pointerCross(in.position.xy);
  let alpha =
    cross *
    clamp(cursor.style.y * cursor.color.a, 0.0, 1.0);

  return vec4<f32>(cursor.color.rgb * alpha, alpha);
}
