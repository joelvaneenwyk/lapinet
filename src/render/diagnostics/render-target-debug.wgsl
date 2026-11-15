struct DebugGlobals {
  output: vec4<f32>, // xy output size, z target code, w far plane
  cameraPosition: vec4<f32>,
  cameraForward: vec4<f32>,
  cameraRight: vec4<f32>,
  cameraUp: vec4<f32>,
  projection: vec4<f32>, // x fovY, y near, z far
};

@group(0) @binding(0) var gAlbedo: texture_2d<f32>;
@group(0) @binding(1) var gNormal: texture_2d<f32>;
@group(0) @binding(2) var gMaterial: texture_2d<f32>;
@group(0) @binding(3) var gDepth: texture_2d<f32>;
@group(0) @binding(4) var<uniform> debug: DebugGlobals;

struct VertexOut {
  @builtin(position) position: vec4<f32>,
};

@vertex
fn vertexMain(@builtin(vertex_index) index: u32) -> VertexOut {
  var positions = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>(3.0, -1.0),
    vec2<f32>(-1.0, 3.0)
  );

  var out: VertexOut;
  out.position = vec4<f32>(positions[index], 0.0, 1.0);
  return out;
}

fn sourceCoord(uv: vec2<f32>) -> vec2<i32> {
  let sourceSize = vec2<i32>(textureDimensions(gDepth));
  return min(
    vec2<i32>(
      clamp(
        uv,
        vec2<f32>(0.0),
        vec2<f32>(0.999999)
      ) *
      vec2<f32>(sourceSize)
    ),
    sourceSize - vec2<i32>(1)
  );
}

fn cameraRay(uv: vec2<f32>) -> vec3<f32> {
  let size = max(
    debug.output.xy,
    vec2<f32>(1.0)
  );
  let aspect = size.x / size.y;
  let tanHalfFov = tan(
    max(debug.projection.x, 0.01) * 0.5
  );
  let screen = vec2<f32>(
    uv.x * 2.0 - 1.0,
    1.0 - uv.y * 2.0
  );
  return normalize(
    debug.cameraForward.xyz +
    debug.cameraRight.xyz *
      (screen.x * aspect * tanHalfFov) +
    debug.cameraUp.xyz *
      (screen.y * tanHalfFov)
  );
}

fn effortGradient(value0: f32) -> vec3<f32> {
  let value = clamp(value0, 0.0, 1.0);
  return vec3<f32>(
    value,
    4.0 * value * (1.0 - value),
    1.0 - value
  );
}

fn sampleTarget(code: u32, uv: vec2<f32>) -> vec3<f32> {
  let coord = sourceCoord(uv);
  let albedo = textureLoad(gAlbedo, coord, 0);
  let normalData = textureLoad(gNormal, coord, 0);
  let material = textureLoad(gMaterial, coord, 0);
  let depth = textureLoad(gDepth, coord, 0).x;
  let valid =
    albedo.a > 0.5 &&
    depth < debug.output.w * 0.999;

  if (code == 1u) {
    return select(
      vec3<f32>(0.0),
      albedo.rgb,
      valid
    );
  }

  if (code == 2u) {
    if (
      !valid ||
      dot(normalData.xyz, normalData.xyz) < 1e-8
    ) {
      return vec3<f32>(0.0);
    }
    return normalize(normalData.xyz) *
      0.5 + vec3<f32>(0.5);
  }

  if (code == 3u) {
    if (!valid) {
      return vec3<f32>(0.0);
    }
    return vec3<f32>(
      clamp(material.x, 0.0, 1.0),
      clamp(material.y, 0.0, 1.0),
      clamp(material.z, 0.0, 1.0)
    );
  }

  if (code == 4u) {
    if (!valid) {
      return vec3<f32>(0.0);
    }
    let normalizedDepth = clamp(
      depth / max(debug.output.w, 1e-5),
      0.0,
      1.0
    );
    return vec3<f32>(1.0 - normalizedDepth);
  }

  if (code == 6u) {
    if (!valid) {
      return vec3<f32>(0.0);
    }
    let worldPosition =
      debug.cameraPosition.xyz +
      cameraRay(uv) * depth;
    return clamp(
      worldPosition + vec3<f32>(0.5),
      vec3<f32>(0.0),
      vec3<f32>(1.0)
    );
  }

  if (code == 7u) {
    if (!valid) {
      return vec3<f32>(0.0);
    }
    return effortGradient(normalData.w);
  }

  if (code == 8u) {
    if (!valid) {
      return vec3<f32>(0.0);
    }
    return vec3<f32>(
      clamp(material.x, 0.0, 1.0)
    );
  }

  if (code == 9u) {
    if (!valid) {
      return vec3<f32>(0.0);
    }
    return vec3<f32>(
      clamp((material.w - 1.0) / 2.0, 0.0, 1.0)
    );
  }

  return vec3<f32>(0.0);
}

@fragment
fn fragmentMain(in: VertexOut) -> @location(0) vec4<f32> {
  let outputSize = max(
    debug.output.xy,
    vec2<f32>(1.0)
  );
  let uv = clamp(
    in.position.xy / outputSize,
    vec2<f32>(0.0),
    vec2<f32>(0.999999)
  );
  var code = u32(round(debug.output.z));
  var sampleUv = uv;

  if (code == 5u) {
    let quadrant = vec2<u32>(
      select(0u, 1u, uv.x >= 0.5),
      select(0u, 1u, uv.y >= 0.5)
    );
    code =
      1u +
      quadrant.x +
      quadrant.y * 2u;
    sampleUv = fract(uv * 2.0);
  }

  return vec4<f32>(
    sampleTarget(code, sampleUv),
    1.0
  );
}
