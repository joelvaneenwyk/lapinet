struct FieldGlobals {
  resolutionSteps: vec4<u32>, // xy resolution, z max steps
  trace: vec4<f32>,           // x time, y fovY, z unused, w far
  cameraPosition: vec4<f32>,
  cameraForward: vec4<f32>,
  cameraRight: vec4<f32>,
  cameraUp: vec4<f32>,
  march: vec4<f32>,           // x hit eps, y base normal eps, z max step, w normal distance scale
  surfaceMaterial: vec4<f32>, // roughness, metallic, transmission, ior
  tracePrecision: vec4<f32>,       // x hit distance scale
  surfaceColor: vec4<f32>,         // rgb authored base color
};

struct FieldSample {
  distance: f32,
  step: f32,
  lowerBound: f32,
  material: u32,
};

struct TraceHit {
  hit: u32,
  steps: u32,
  material: u32,
  _pad: u32,
  distance: f32,
  fieldDistance: f32,
  position: vec3<f32>,
};

@group(0) @binding(0) var<uniform> fieldGlobals: FieldGlobals;
@group(0) @binding(1) var gAlbedo:
  texture_storage_2d<rgba16float, write>;
@group(0) @binding(2) var gNormal:
  texture_storage_2d<rgba16float, write>;
@group(0) @binding(3) var gMaterial:
  texture_storage_2d<rgba16float, write>;
@group(0) @binding(4) var gDepth:
  texture_storage_2d<r32float, write>;

// __FIELD_MODULE__

fn cameraRay(uv: vec2<f32>) -> vec3<f32> {
  let size = vec2<f32>(fieldGlobals.resolutionSteps.xy);
  let aspect = size.x / max(size.y, 1.0);
  let tanHalfFov = tan(fieldGlobals.trace.y * 0.5);
  return normalize(
    fieldGlobals.cameraForward.xyz +
    fieldGlobals.cameraRight.xyz *
      (uv.x * aspect * tanHalfFov) +
    fieldGlobals.cameraUp.xyz *
      (uv.y * tanHalfFov)
  );
}

fn scalarUlp(value: f32) -> f32 {
  let bits = bitcast<u32>(abs(value));
  let exponent = (bits >> 23u) & 0xffu;

  if (exponent == 0u) {
    return bitcast<f32>(1u);
  }
  if (exponent >= 255u) {
    return 3.402823466e38;
  }
  if (exponent > 23u) {
    return bitcast<f32>((exponent - 23u) << 23u);
  }
  return bitcast<f32>(1u << (exponent - 1u));
}

fn positionUlp(p: vec3<f32>) -> f32 {
  return max(
    scalarUlp(p.x),
    max(scalarUlp(p.y), scalarUlp(p.z))
  );
}

const NUMERICAL_ULP_MARGIN: f32 = 16.0;

fn hitEpsilon(distance: f32, p: vec3<f32>) -> f32 {
  let base = max(fieldGlobals.march.x, 1e-10);
  let footprint =
    pixelFootprint(distance) * max(fieldGlobals.tracePrecision.x, 0.0);
  return max(
    max(base, footprint),
    positionUlp(p) * NUMERICAL_ULP_MARGIN
  );
}

fn traceRay(origin: vec3<f32>, direction: vec3<f32>) -> TraceHit {
  var t = 0.0;
  var previousT = 0.0;
  var previousDistance = 0.0;
  var hasPrevious = false;
  var lastDistance = 1e6;
  var stepsTaken = 0u;

  for (
    var i = 0u;
    i < fieldGlobals.resolutionSteps.z;
    i = i + 1u
  ) {
    if (t >= fieldGlobals.trace.w) {
      break;
    }

    let p = origin + direction * t;
    let sample = evaluateField(p);
    let epsilon = hitEpsilon(t, p);
    lastDistance = sample.distance;
    stepsTaken = i + 1u;

    if (hasPrevious) {
      let crossedSurface =
        (previousDistance < 0.0 && sample.distance >= 0.0) ||
        (previousDistance > 0.0 && sample.distance <= 0.0);

      if (crossedSurface) {
        var lo = previousT;
        var hi = t;
        var loDistance = previousDistance;

        for (var j = 0u; j < 8u; j = j + 1u) {
          let mid = 0.5 * (lo + hi);
          let d = evaluateField(
            origin + direction * mid
          ).distance;
          let sameSide =
            (loDistance < 0.0 && d < 0.0) ||
            (loDistance > 0.0 && d > 0.0);

          if (sameSide) {
            lo = mid;
            loDistance = d;
          } else {
            hi = mid;
          }
        }

        let hitT = 0.5 * (lo + hi);
        let hitSample = evaluateField(
          origin + direction * hitT
        );
        return TraceHit(
          1u,
          stepsTaken,
          hitSample.material,
          0u,
          hitT,
          hitSample.distance,
          origin + direction * hitT
        );
      }

      if (abs(sample.distance) <= epsilon) {
        return TraceHit(
          1u,
          stepsTaken,
          sample.material,
          0u,
          t,
          sample.distance,
          p
        );
      }
    }

    previousT = t;
    previousDistance = sample.distance;
    hasPrevious = true;

    let stepLength = clamp(
      sample.step,
      epsilon * 0.5,
      max(fieldGlobals.march.z, epsilon)
    );
    t = t + max(stepLength, epsilon * 0.5);
  }

  return TraceHit(
    0u,
    stepsTaken,
    0u,
    0u,
    min(t, fieldGlobals.trace.w),
    lastDistance,
    origin + direction * min(t, fieldGlobals.trace.w)
  );
}

fn pixelFootprint(distance: f32) -> f32 {
  let height = max(f32(fieldGlobals.resolutionSteps.y), 1.0);
  return 2.0 * max(distance, 0.0) *
    tan(fieldGlobals.trace.y * 0.5) / height;
}

fn normalEpsilon(p: vec3<f32>, distance: f32) -> f32 {
  let base = max(fieldGlobals.march.y, 1e-10);
  let footprint =
    pixelFootprint(distance) * max(fieldGlobals.march.w, 0.0);
  let authored = sqrt(base * base + footprint * footprint);
  return max(
    authored,
    positionUlp(p) * NUMERICAL_ULP_MARGIN
  );
}

fn fieldNormalWithEpsilon(
  p: vec3<f32>,
  epsilon: f32
) -> vec3<f32> {
  let e = max(epsilon, 1e-10);
  let ex = vec2<f32>(e, -e);
  let n =
    ex.xyy * evaluateField(p + ex.xyy).distance +
    ex.yyx * evaluateField(p + ex.yyx).distance +
    ex.yxy * evaluateField(p + ex.yxy).distance +
    ex.xxx * evaluateField(p + ex.xxx).distance;
  let magnitude = length(n);
  return select(
    vec3<f32>(0.0, 1.0, 0.0),
    n / max(magnitude, 1e-8),
    magnitude > 1e-8
  );
}

fn fieldNormal(p: vec3<f32>, distance: f32) -> vec3<f32> {
  return fieldNormalWithEpsilon(
    p,
    normalEpsilon(p, distance)
  );
}

@compute @workgroup_size(8, 8, 1)
fn implicitSurfaceMain(
  @builtin(global_invocation_id) id: vec3<u32>
) {
  let resolution = fieldGlobals.resolutionSteps.xy;
  if (id.x >= resolution.x || id.y >= resolution.y) {
    return;
  }

  let size = vec2<f32>(resolution);
  let pixel = vec2<f32>(id.xy) + vec2<f32>(0.5);
  var uv = pixel / size * 2.0 - 1.0;
  uv.y = -uv.y;

  let ray = cameraRay(uv);
  let hit = traceRay(fieldGlobals.cameraPosition.xyz, ray);
  let coord = vec2<i32>(id.xy);

  if (hit.hit == 0u) {
    textureStore(gAlbedo, coord, vec4<f32>(0.0));
    textureStore(gNormal, coord, vec4<f32>(0.0));
    textureStore(gMaterial, coord, vec4<f32>(0.0));
    textureStore(
      gDepth,
      coord,
      vec4<f32>(fieldGlobals.trace.w, 0.0, 0.0, 0.0)
    );
    return;
  }

  let normal = fieldNormal(hit.position, hit.distance);
  let effort = clamp(
    f32(hit.steps) /
      max(f32(fieldGlobals.resolutionSteps.z), 1.0),
    0.0,
    1.0
  );

  textureStore(
    gAlbedo,
    coord,
    vec4<f32>(fieldGlobals.surfaceColor.rgb, 1.0)
  );
  textureStore(
    gNormal,
    coord,
    vec4<f32>(normal, effort)
  );
  textureStore(
    gMaterial,
    coord,
    fieldGlobals.surfaceMaterial
  );
  textureStore(
    gDepth,
    coord,
    vec4<f32>(hit.distance, 0.0, 0.0, 0.0)
  );
}
