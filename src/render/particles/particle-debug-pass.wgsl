struct DebugGlobals {
  resolutionNearFar: vec4<f32>,
  projectionStyle: vec4<f32>,
  cameraPosition: vec4<f32>,
  cameraForward: vec4<f32>,
  cameraRight: vec4<f32>,
  cameraUp: vec4<f32>,
  trailState: vec4<f32>,
  overlayStyle: vec4<f32>,
};

@group(0) @binding(0) var<uniform> globals: DebugGlobals;
@group(0) @binding(1) var<storage, read> records: array<vec4<u32>>;
@group(0) @binding(2) var<storage, read> spatialOrder: array<u32>;
@group(0) @binding(3) var<storage, read> history: array<vec4<u32>>;
@group(0) @binding(4) var implicitDepth: texture_2d<f32>;

const PHI_Q16_I: i32 = 106039i;
const ONE_Q16_I: i32 = 65536i;

fn extract8(r: vec4<u32>) -> array<u32, 8> {
  let lo = r.x;
  let mid = r.y;
  let hi = r.z;
  var c: array<u32, 8>;
  c[0] = lo & 4095u;
  c[1] = (lo >> 12u) & 4095u;
  c[2] = ((lo >> 24u) | (mid << 8u)) & 4095u;
  c[3] = (mid >> 4u) & 4095u;
  c[4] = (mid >> 16u) & 4095u;
  c[5] = ((mid >> 28u) | (hi << 4u)) & 4095u;
  c[6] = (hi >> 8u) & 4095u;
  c[7] = (hi >> 20u) & 4095u;
  return c;
}

fn signed12(value: u32) -> i32 {
  let v = i32(value & 4095u);
  return select(v, v - 4096i, v >= 2048i);
}

fn physicalFixed(c: array<u32, 8>) -> vec4<i32> {
  var k: array<i32, 8>;
  for (var i = 0u; i < 8u; i = i + 1u) {
    k[i] = signed12(c[i]);
  }

  var z: array<i32, 8>;
  z[0] = k[0];
  z[1] = k[1];
  z[2] = k[2];
  z[3] = k[3];
  z[4] = k[0] + k[1] + k[3] + 2i * k[4];
  z[5] = k[0] + k[2] + k[3] + 2i * k[5];
  z[6] = k[1] + k[2] + k[3] + 2i * k[6];
  z[7] = k[0] + k[1] + k[2] + 2i * k[7];

  return vec4<i32>(
    (z[0] * ONE_Q16_I + z[1] * PHI_Q16_I) / 2i,
    (z[2] * ONE_Q16_I + z[3] * PHI_Q16_I) / 2i,
    (z[4] * ONE_Q16_I + z[5] * PHI_Q16_I) / 2i,
    (z[6] * ONE_Q16_I + z[7] * PHI_Q16_I) / 2i
  );
}

fn worldPosition(record: vec4<u32>) -> vec3<f32> {
  let p = physicalFixed(extract8(record));
  return vec3<f32>(p.xyz) *
    (globals.projectionStyle.y / f32(ONE_Q16_I));
}

fn nearPlane() -> f32 {
  return max(globals.resolutionNearFar.z, 1e-6);
}

fn farPlane() -> f32 {
  return max(
    globals.resolutionNearFar.w,
    nearPlane() + 1e-6
  );
}

fn depth01(viewDepth: f32) -> f32 {
  return clamp(
    (viewDepth - nearPlane()) /
      (farPlane() - nearPlane()),
    0.0,
    1.0
  );
}

fn viewDepth(position: vec3<f32>) -> f32 {
  return dot(
    position - globals.cameraPosition.xyz,
    globals.cameraForward.xyz
  );
}

fn projectWorld(position: vec3<f32>) -> vec4<f32> {
  let delta = position - globals.cameraPosition.xyz;
  let depth = dot(delta, globals.cameraForward.xyz);
  if (depth <= nearPlane()) {
    return vec4<f32>(2.0, 2.0, 1.0, 1.0);
  }

  let viewX = dot(delta, globals.cameraRight.xyz);
  let viewY = dot(delta, globals.cameraUp.xyz);
  let tanY = max(
    tan(globals.projectionStyle.x * 0.5),
    1e-6
  );
  let aspect = max(
    globals.resolutionNearFar.x /
      max(globals.resolutionNearFar.y, 1.0),
    1e-6
  );

  return vec4<f32>(
    viewX / (depth * tanY * aspect),
    viewY / (depth * tanY),
    depth01(depth),
    1.0
  );
}

fn implicitDepthAt(pixel: vec2<f32>) -> f32 {
  let outputSize = max(
    globals.resolutionNearFar.xy,
    vec2<f32>(1.0)
  );
  let uv = clamp(
    pixel / outputSize,
    vec2<f32>(0.0),
    vec2<f32>(0.999999)
  );
  let sourceSize = textureDimensions(implicitDepth);
  let coord = min(
    vec2<i32>(uv * vec2<f32>(sourceSize)),
    vec2<i32>(sourceSize) - vec2<i32>(1)
  );
  return textureLoad(implicitDepth, coord, 0).x;
}

fn hiddenByImplicit(
  viewZ: f32,
  pixel: vec2<f32>
) -> bool {
  if (globals.cameraPosition.w < 0.5) {
    return false;
  }
  let sceneZ = implicitDepthAt(pixel);
  return
    sceneZ < farPlane() * 0.999 &&
    viewZ > sceneZ + 0.0008;
}

fn particleColor(channel: u32) -> vec3<f32> {
  let h = f32(channel % 240u) / 240.0;
  let tau = 6.28318530718;
  return 0.62 + 0.38 * cos(
    tau * (
      vec3<f32>(h) +
      vec3<f32>(0.0, 0.67, 0.33)
    )
  );
}

struct LineOut {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec4<f32>,
  @location(1) viewZ: f32,
};

@vertex
fn trailVertex(
  @builtin(vertex_index) vertexIndex: u32,
  @builtin(instance_index) instanceIndex: u32
) -> LineOut {
  let count = u32(globals.trailState.w);
  let stride = max(
    1u,
    u32(globals.overlayStyle.y)
  );
  let sampled = (count + stride - 1u) / stride;
  let segmentAge = instanceIndex / sampled;
  let sampleIndex = instanceIndex % sampled;
  let particle = sampleIndex * stride;

  let historyLength =
    max(2u, u32(globals.trailState.z));
  let head = u32(max(globals.trailState.x, 0.0));
  let age = segmentAge + vertexIndex;
  let slot =
    (head + historyLength - (age % historyLength)) %
    historyLength;
  let record =
    history[slot * count + particle];

  let world = worldPosition(record);
  let valid = u32(globals.trailState.y);
  let visible =
    particle < count &&
    segmentAge + 1u < valid;

  var out: LineOut;
  out.position = select(
    vec4<f32>(2.0, 2.0, 1.0, 1.0),
    projectWorld(world),
    visible
  );
  let fade =
    1.0 -
    f32(segmentAge) /
    max(1.0, f32(valid - 1u));
  out.color = vec4<f32>(
    particleColor(record.w),
    globals.projectionStyle.z * fade
  );
  out.viewZ = viewDepth(world);
  return out;
}

@vertex
fn edgeVertex(
  @builtin(vertex_index) vertexIndex: u32,
  @builtin(instance_index) instanceIndex: u32
) -> LineOut {
  let count = u32(globals.trailState.w);
  let fan = max(
    1u,
    u32(globals.overlayStyle.z)
  );
  let stride = max(
    1u,
    u32(globals.overlayStyle.w)
  );

  let sampledIndex = instanceIndex / fan;
  let neighborOffset = instanceIndex % fan + 1u;
  let sortedIndex = sampledIndex * stride;
  let otherIndex = sortedIndex + neighborOffset;
  let visible =
    sortedIndex < count &&
    otherIndex < count;

  let safeA = min(sortedIndex, count - 1u);
  let safeB = min(otherIndex, count - 1u);
  let recordA = spatialOrder[safeA];
  let recordB = spatialOrder[safeB];
  let recordId = select(
    recordA,
    recordB,
    vertexIndex != 0u
  );
  let record = records[recordId];
  let world = worldPosition(record);

  var out: LineOut;
  out.position = select(
    vec4<f32>(2.0, 2.0, 1.0, 1.0),
    projectWorld(world),
    visible
  );
  out.color = vec4<f32>(
    vec3<f32>(0.72, 0.82, 1.0),
    globals.projectionStyle.w
  );
  out.viewZ = viewDepth(world);
  return out;
}

@fragment
fn lineFragment(in: LineOut) -> @location(0) vec4<f32> {
  if (
    in.color.a <= 1.0 / 255.0 ||
    in.viewZ <= nearPlane() ||
    hiddenByImplicit(in.viewZ, in.position.xy)
  ) {
    discard;
  }
  return in.color;
}
