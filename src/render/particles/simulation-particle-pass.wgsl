struct ParticleGlobals {
  resolutionNearFar: vec4<f32>,
  projectionStyle: vec4<f32>,
  cameraPosition: vec4<f32>,
  cameraForward: vec4<f32>,
  cameraRight: vec4<f32>,
  cameraUp: vec4<f32>,
  flockStyle: vec4<f32>,
};

struct FlockState {
  steer: vec4<i32>,
  hidden: vec4<i32>,
};

@group(0) @binding(0) var<uniform> globals: ParticleGlobals;
@group(0) @binding(1) var<storage, read> records: array<vec4<u32>>;
@group(0) @binding(2) var<storage, read> stableIds: array<u32>;
@group(0) @binding(3) var implicitDepth: texture_2d<f32>;
@group(0) @binding(4) var<storage, read> flockState: array<FlockState>;
@group(0) @binding(5) var<storage, read> directions: array<vec4<i32>>;
@group(0) @binding(6) var<storage, read> exactCandidates: array<u32>;

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

fn icosianNumerator(c: array<u32, 8>) -> array<i32, 8> {
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
  return z;
}

fn physicalFixed(c: array<u32, 8>) -> vec4<i32> {
  let z = icosianNumerator(c);
  return vec4<i32>(
    (z[0] * ONE_Q16_I + z[1] * PHI_Q16_I) / 2i,
    (z[2] * ONE_Q16_I + z[3] * PHI_Q16_I) / 2i,
    (z[4] * ONE_Q16_I + z[5] * PHI_Q16_I) / 2i,
    (z[6] * ONE_Q16_I + z[7] * PHI_Q16_I) / 2i
  );
}

fn worldPosition(record: vec4<u32>) -> vec3<f32> {
  let p = physicalFixed(extract8(record));
  let scale = globals.projectionStyle.w;
  return vec3<f32>(p.xyz) *
    (scale / f32(ONE_Q16_I));
}

fn effectiveDirection(
  recordId: u32,
  channel: u32
) -> u32 {
  let base = channel % 120u;
  if (globals.flockStyle.x < 0.5) {
    return base;
  }

  let desired =
    directions[base] * i32(globals.flockStyle.y) +
    flockState[recordId].steer;

  var mask = 0u;
  if (desired.x >= 0i) { mask = mask | 1u; }
  if (desired.y >= 0i) { mask = mask | 2u; }
  if (desired.z >= 0i) { mask = mask | 4u; }
  if (desired.w >= 0i) { mask = mask | 8u; }

  let candidateBase = mask * 17u;
  var best = exactCandidates[candidateBase];
  var bestDot = -2147483647i;

  for (var i = 0u; i < 17u; i = i + 1u) {
    let candidate = exactCandidates[candidateBase + i];
    let d = directions[candidate];
    let score =
      d.x * desired.x +
      d.y * desired.y +
      d.z * desired.z +
      d.w * desired.w;
    if (score > bestDot) {
      bestDot = score;
      best = candidate;
    }
  }
  return best;
}

fn nearPlane() -> f32 {
  return max(globals.resolutionNearFar.z, 1e-6);
}

fn farPlane() -> f32 {
  return max(globals.resolutionNearFar.w, nearPlane() + 1e-6);
}

fn depth01(viewDepth: f32) -> f32 {
  return clamp(
    (viewDepth - nearPlane()) / (farPlane() - nearPlane()),
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
  let tanY = max(tan(globals.projectionStyle.x * 0.5), 1e-6);
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

fn hiddenByImplicit(viewZ: f32, pixel: vec2<f32>) -> bool {
  if (globals.cameraPosition.w < 0.5) {
    return false;
  }
  let sceneZ = implicitDepthAt(pixel);
  return
    sceneZ < farPlane() * 0.999 &&
    viewZ > sceneZ + 0.0008;
}

fn billboardCorner(index: u32) -> vec2<f32> {
  var corners = array<vec2<f32>, 4>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 1.0, -1.0),
    vec2<f32>(-1.0,  1.0),
    vec2<f32>( 1.0,  1.0)
  );
  return corners[index];
}

fn particleColor(channel: u32, stable: u32) -> vec3<f32> {
  let h = f32((channel + (stable & 31u)) % 240u) / 240.0;
  let tau = 6.28318530718;
  return 0.62 + 0.38 * cos(
    tau * (vec3<f32>(h) + vec3<f32>(0.0, 0.67, 0.33))
  );
}

struct ParticleOut {
  @builtin(position) position: vec4<f32>,
  @location(0) local: vec2<f32>,
  @location(1) centerDepth: f32,
  @location(2) color: vec3<f32>,
};

@vertex
fn particleVertex(
  @builtin(vertex_index) vertexIndex: u32,
  @builtin(instance_index) instanceIndex: u32
) -> ParticleOut {
  let record = records[instanceIndex];
  let center = worldPosition(record);
  let depth = viewDepth(center);
  let corner = billboardCorner(vertexIndex);
  var clip = projectWorld(center);

  if (depth > nearPlane()) {
    let tanY = max(tan(globals.projectionStyle.x * 0.5), 1e-6);
    let aspect = max(
      globals.resolutionNearFar.x /
        max(globals.resolutionNearFar.y, 1.0),
      1e-6
    );
    let radius = max(globals.projectionStyle.y, 1e-5);

    if (
      globals.flockStyle.x > 0.5 &&
      globals.flockStyle.z > 0.5
    ) {
      let directionId =
        effectiveDirection(instanceIndex, record.w);
      let h = vec3<f32>(directions[directionId].xyz);
      let viewHeading = vec2<f32>(
        dot(h, globals.cameraRight.xyz),
        dot(h, globals.cameraUp.xyz)
      );
      let headingLength = length(viewHeading);

      if (headingLength > 1e-5) {
        let tangent = viewHeading / headingLength;
        let normal = vec2<f32>(-tangent.y, tangent.x);
        let offset =
          tangent *
            (corner.x * radius * globals.flockStyle.w) +
          normal *
            (corner.y * radius * 0.5);
        clip.x += offset.x / (depth * tanY * aspect);
        clip.y += offset.y / (depth * tanY);
      } else {
        let radiusY = radius / (depth * tanY);
        let radiusX = radiusY / aspect;
        clip.x += corner.x * radiusX;
        clip.y += corner.y * radiusY;
      }
    } else {
      let radiusY = radius / (depth * tanY);
      let radiusX = radiusY / aspect;
      clip.x += corner.x * radiusX;
      clip.y += corner.y * radiusY;
    }
  }

  var out: ParticleOut;
  out.position = clip;
  out.local = corner;
  out.centerDepth = depth;
  out.color = particleColor(
    record.w,
    stableIds[instanceIndex]
  );
  return out;
}

struct ParticleFragmentOut {
  @location(0) color: vec4<f32>,
  @builtin(frag_depth) depth: f32,
};

@fragment
fn particleFragment(in: ParticleOut) -> ParticleFragmentOut {
  let r2 = dot(in.local, in.local);
  if (
    r2 > 1.0 ||
    in.centerDepth <= nearPlane() ||
    hiddenByImplicit(in.centerDepth, in.position.xy)
  ) {
    discard;
  }

  let sphereZ = sqrt(max(1.0 - r2, 0.0));
  let directionalHead = select(
    1.0,
    0.72 + 0.28 * (in.local.x * 0.5 + 0.5),
    globals.flockStyle.x > 0.5 &&
    globals.flockStyle.z > 0.5
  );
  let light = (0.45 + 0.55 * sphereZ) * directionalHead;
  let alpha = clamp(globals.projectionStyle.z, 0.0, 1.0) *
    (1.0 - smoothstep(0.84, 1.0, r2));

  var out: ParticleFragmentOut;
  out.color = vec4<f32>(in.color * light, alpha);
  out.depth = depth01(
    in.centerDepth - sphereZ * globals.projectionStyle.y
  );
  return out;
}
