struct LightingGlobals {
  resolution: vec4<f32>, // xy output size, z far plane
  keyDirection: vec4<f32>,
  keyColor: vec4<f32>,
  ambientColor: vec4<f32>,
  cameraPosition: vec4<f32>,
  cameraForward: vec4<f32>,
  cameraRight: vec4<f32>,
  cameraUp: vec4<f32>,
  cameraProjection: vec4<f32>,
  rimColor: vec4<f32>,
  rimControl: vec4<f32>,
  curvature: vec4<f32>,
  occlusion: vec4<f32>,
  hazeColor: vec4<f32>,
  hazeControl: vec4<f32>,
  tone: vec4<f32>,
  reconstruction0: vec4<f32>,
  reconstruction1: vec4<f32>,
  shadingControl: vec4<f32>,
};

@group(0) @binding(0) var gAlbedo: texture_2d<f32>;
@group(0) @binding(1) var gNormal: texture_2d<f32>;
@group(0) @binding(2) var gMaterial: texture_2d<f32>;
@group(0) @binding(3) var gDepth: texture_2d<f32>;
@group(0) @binding(4) var<uniform> lighting: LightingGlobals;

struct VertexOut {
  @builtin(position) position: vec4<f32>,
};

struct SurfaceSample {
  albedoValid: vec4<f32>,
  normalEffort: vec4<f32>,
  material: vec4<f32>,
  depthValid: vec4<f32>,
  detail: vec4<f32>,
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

fn clampCoord(coord: vec2<i32>, size: vec2<i32>) -> vec2<i32> {
  return clamp(
    coord,
    vec2<i32>(0),
    size - vec2<i32>(1)
  );
}

fn loadSurface(coord0: vec2<i32>) -> SurfaceSample {
  let size = vec2<i32>(textureDimensions(gDepth));
  let coord = clampCoord(coord0, size);
  let albedo = textureLoad(gAlbedo, coord, 0);
  var normalEffort = textureLoad(gNormal, coord, 0);
  let material = textureLoad(gMaterial, coord, 0);
  let depth = textureLoad(gDepth, coord, 0).x;
  let valid =
    albedo.a > 0.5 &&
    depth < lighting.resolution.z * 0.999;

  if (valid && dot(normalEffort.xyz, normalEffort.xyz) > 1e-10) {
    normalEffort = vec4<f32>(
      normalize(normalEffort.xyz),
      normalEffort.w
    );
  } else {
    normalEffort = vec4<f32>(0.0);
  }

  return SurfaceSample(
    albedo,
    normalEffort,
    material,
    vec4<f32>(depth, select(0.0, 1.0, valid), 0.0, 0.0),
    vec4<f32>(0.0)
  );
}

fn reconstructionWeight(
  reference: SurfaceSample,
  candidate: SurfaceSample,
  bilinearWeight: f32
) -> f32 {
  if (
    bilinearWeight <= 0.0 ||
    candidate.depthValid.y < 0.5
  ) {
    return 0.0;
  }

  let referenceDepth = reference.depthValid.x;
  let depthTolerance = max(
    referenceDepth * max(lighting.reconstruction0.x, 1e-6),
    max(lighting.reconstruction0.y, 1e-6)
  );
  let depthWeight = exp(
    -max(lighting.reconstruction0.z, 0.0) *
    abs(candidate.depthValid.x - referenceDepth) /
    depthTolerance
  );
  let normalWeight = pow(
    max(
      dot(
        reference.normalEffort.xyz,
        candidate.normalEffort.xyz
      ),
      0.0
    ),
    max(lighting.reconstruction0.w, 0.0)
  );

  return bilinearWeight *
    depthWeight *
    mix(clamp(lighting.reconstruction1.x, 0.0, 1.0), 1.0, normalWeight);
}

fn detailBetween(
  reference: SurfaceSample,
  candidate: SurfaceSample
) -> vec2<f32> {
  if (candidate.depthValid.y < 0.5) {
    return vec2<f32>(0.0);
  }

  let bend = clamp(
    1.0 - dot(
      reference.normalEffort.xyz,
      candidate.normalEffort.xyz
    ),
    0.0,
    1.0
  );
  let depthTolerance = max(
    reference.depthValid.x *
      max(lighting.reconstruction0.x, 1e-6),
    max(lighting.reconstruction0.y, 1e-6)
  );
  let nearer = max(
    reference.depthValid.x - candidate.depthValid.x,
    0.0
  ) / depthTolerance;
  let ao = clamp(
    (nearer - max(lighting.occlusion.y, 0.0)) /
      max(lighting.occlusion.z, 1e-5),
    0.0,
    1.0
  ) * clamp(bend * max(lighting.shadingControl.w, 0.0), 0.0, 1.0);

  return vec2<f32>(bend, ao);
}

fn resolveSurface(uv0: vec2<f32>) -> SurfaceSample {
  let uv = clamp(
    uv0,
    vec2<f32>(0.0),
    vec2<f32>(0.999999)
  );
  let sourceSizeI = vec2<i32>(textureDimensions(gDepth));
  let sourceSize = vec2<f32>(sourceSizeI);
  let outputSize = max(
    lighting.resolution.xy,
    vec2<f32>(1.0)
  );

  let nearestCoord = clampCoord(
    vec2<i32>(uv * sourceSize),
    sourceSizeI
  );
  var reference = loadSurface(nearestCoord);

  if (reference.depthValid.y < 0.5) {
    return reference;
  }

  let needsNeighborhood =
    lighting.resolution.w > 0.5 ||
    lighting.rimControl.z > 0.5 ||
    lighting.occlusion.w > 0.5;
  if (!needsNeighborhood) {
    return reference;
  }

  let sourcePosition = clamp(
    uv * sourceSize - vec2<f32>(0.5),
    vec2<f32>(0.0),
    sourceSize - vec2<f32>(1.0)
  );
  let base = vec2<i32>(floor(sourcePosition));
  let f = fract(sourcePosition);

  let s00 = loadSurface(base);
  let s10 = loadSurface(base + vec2<i32>(1, 0));
  let s01 = loadSurface(base + vec2<i32>(0, 1));
  let s11 = loadSurface(base + vec2<i32>(1, 1));

  let d00 = detailBetween(reference, s00);
  let d10 = detailBetween(reference, s10);
  let d01 = detailBetween(reference, s01);
  let d11 = detailBetween(reference, s11);
  let detail = (d00 + d10 + d01 + d11) * 0.25;
  reference.detail = vec4<f32>(detail, 0.0, 0.0);

  if (
    lighting.resolution.w <= 0.5 ||
    (
      abs(outputSize.x - sourceSize.x) < 0.5 &&
      abs(outputSize.y - sourceSize.y) < 0.5
    )
  ) {
    return reference;
  }

  let w00 = reconstructionWeight(
    reference, s00, (1.0 - f.x) * (1.0 - f.y)
  );
  let w10 = reconstructionWeight(
    reference, s10, f.x * (1.0 - f.y)
  );
  let w01 = reconstructionWeight(
    reference, s01, (1.0 - f.x) * f.y
  );
  let w11 = reconstructionWeight(
    reference, s11, f.x * f.y
  );
  let total = w00 + w10 + w01 + w11;

  if (total <= 1e-6) {
    return reference;
  }

  let inv = 1.0 / total;
  let albedo =
    (
      s00.albedoValid.rgb * w00 +
      s10.albedoValid.rgb * w10 +
      s01.albedoValid.rgb * w01 +
      s11.albedoValid.rgb * w11
    ) * inv;
  let mixedNormal =
    (
      s00.normalEffort.xyz * w00 +
      s10.normalEffort.xyz * w10 +
      s01.normalEffort.xyz * w01 +
      s11.normalEffort.xyz * w11
    ) * inv;
  var normal = reference.normalEffort.xyz;
  if (dot(mixedNormal, mixedNormal) > 1e-10) {
    normal = normalize(mixedNormal);
  }
  let effort =
    (
      s00.normalEffort.w * w00 +
      s10.normalEffort.w * w10 +
      s01.normalEffort.w * w01 +
      s11.normalEffort.w * w11
    ) * inv;
  let material =
    (
      s00.material * w00 +
      s10.material * w10 +
      s01.material * w01 +
      s11.material * w11
    ) * inv;
  let depth =
    (
      s00.depthValid.x * w00 +
      s10.depthValid.x * w10 +
      s01.depthValid.x * w01 +
      s11.depthValid.x * w11
    ) * inv;

  return SurfaceSample(
    vec4<f32>(albedo, 1.0),
    vec4<f32>(normal, effort),
    material,
    vec4<f32>(depth, 1.0, 0.0, 0.0),
    vec4<f32>(detail, 0.0, 0.0)
  );
}

fn cameraRay(uv: vec2<f32>) -> vec3<f32> {
  let size = max(
    lighting.resolution.xy,
    vec2<f32>(1.0)
  );
  let aspect = size.x / size.y;
  let tanHalfFov = tan(
    lighting.cameraProjection.x * 0.5
  );
  let screen = vec2<f32>(
    uv.x * 2.0 - 1.0,
    1.0 - uv.y * 2.0
  );

  return normalize(
    lighting.cameraForward.xyz +
    lighting.cameraRight.xyz *
      (screen.x * aspect * tanHalfFov) +
    lighting.cameraUp.xyz *
      (screen.y * tanHalfFov)
  );
}

const PI: f32 = 3.14159265358979323846;

fn D_GGX(NoH: f32, roughness: f32) -> f32 {
  let a2 = roughness * roughness;
  let f = (NoH * a2 - NoH) * NoH + 1.0;
  return a2 / max(PI * f * f, 1e-7);
}

fn F_Schlick(u: f32, f0: vec3<f32>) -> vec3<f32> {
  let f = pow(1.0 - u, 5.0);
  return f0 + (vec3<f32>(1.0) - f0) * f;
}

fn V_SmithGGXCorrelated(
  NoV: f32,
  NoL: f32,
  roughness: f32
) -> f32 {
  let a2 = roughness * roughness;
  let GGXL =
    NoV * sqrt((-NoL * a2 + NoL) * NoL + a2);
  let GGXV =
    NoL * sqrt((-NoV * a2 + NoV) * NoV + a2);
  return 0.5 / max(GGXV + GGXL, 1e-7);
}

fn finishColor(color0: vec3<f32>) -> vec3<f32> {
  var color =
    color0 *
    max(lighting.tone.x, 0.0) *
    max(lighting.tone.z, 0.0);
  let contrast = max(lighting.tone.y, 0.0);
  color =
    (color - vec3<f32>(0.5)) *
    contrast +
    vec3<f32>(0.5);
  let gamma = max(lighting.tone.w, 0.01);
  return pow(
    max(color, vec3<f32>(0.0)),
    vec3<f32>(1.0 / gamma)
  );
}

@fragment
fn fragmentMain(in: VertexOut) -> @location(0) vec4<f32> {
  let outputSize = max(
    lighting.resolution.xy,
    vec2<f32>(1.0)
  );
  let uv = clamp(
    in.position.xy / outputSize,
    vec2<f32>(0.0),
    vec2<f32>(0.999999)
  );
  let surface = resolveSurface(uv);

  if (surface.depthValid.y < 0.5) {
    return vec4<f32>(0.0, 0.0, 0.0, 1.0);
  }

  let albedo = max(
    surface.albedoValid.rgb,
    vec3<f32>(0.0)
  );
  let normal = normalize(surface.normalEffort.xyz);
  let material = surface.material;
  let depth = surface.depthValid.x;
  let ray = cameraRay(uv);
  let viewDirection = -ray;
  let lightDirection =
    normalize(lighting.keyDirection.xyz);
  let halfDirection = normalize(
    viewDirection + lightDirection
  );

  let NoV = clamp(
    dot(normal, viewDirection),
    0.0,
    1.0
  ) + 1e-5;
  let NoL = clamp(
    dot(normal, lightDirection),
    0.0,
    1.0
  );
  let NoH = clamp(
    dot(normal, halfDirection),
    0.0,
    1.0
  );
  let LoH = clamp(
    dot(lightDirection, halfDirection),
    0.0,
    1.0
  );

  let perceptualRoughness = clamp(
    material.x,
    0.045,
    1.0
  );
  let roughness =
    perceptualRoughness * perceptualRoughness;
  let metallic = clamp(material.y, 0.0, 1.0);
  let transmission = clamp(
    material.z,
    0.0,
    1.0
  );
  let ior = max(material.w, 1.0);
  let dielectricF0 = pow(
    (ior - 1.0) / (ior + 1.0),
    2.0
  );
  let f0 = mix(
    vec3<f32>(dielectricF0),
    albedo,
    metallic
  );

  let D = D_GGX(NoH, roughness);
  let F = F_Schlick(LoH, f0);
  let V = V_SmithGGXCorrelated(
    NoV,
    NoL,
    roughness
  );
  let specular = D * V * F;
  let diffuseWeight =
    (vec3<f32>(1.0) - F) *
    (1.0 - metallic) *
    (1.0 - transmission);
  let diffuse =
    diffuseWeight * albedo / PI;

  let direct =
    (diffuse + specular) *
    NoL *
    lighting.keyColor.rgb *
    max(lighting.keyDirection.w, 0.0);

  var ambientLight =
    lighting.ambientColor.rgb *
    max(lighting.ambientColor.w, 0.0);
  var ao = 1.0;
  if (lighting.occlusion.w > 0.5) {
    ao = 1.0 -
      clamp(lighting.occlusion.x, 0.0, 1.0) *
      clamp(surface.detail.y, 0.0, 1.0);
  }
  let ambient =
    albedo *
    ambientLight *
    ao *
    (1.0 - metallic * clamp(lighting.shadingControl.x, 0.0, 1.0)) *
    (1.0 - transmission * clamp(lighting.shadingControl.y, 0.0, 1.0));

  var color = ambient + direct;

  if (lighting.rimControl.y > 0.5) {
    let rim = pow(
      clamp(1.0 - NoV, 0.0, 1.0),
      max(lighting.rimControl.x, 0.1)
    ) * max(lighting.rimColor.w, 0.0);
    color +=
      lighting.rimColor.rgb *
      rim *
      (1.0 - metallic * clamp(lighting.shadingControl.z, 0.0, 1.0));
  }

  if (lighting.rimControl.z > 0.5) {
    let lo = min(
      lighting.curvature.y,
      lighting.curvature.z
    );
    let hi = max(
      lighting.curvature.y,
      lighting.curvature.z
    );
    let normalized = smoothstep(
      lo,
      max(hi, lo + 1e-6),
      max(surface.detail.x, 0.0)
    );
    let weight = lighting.curvature.x;
    let edge = clamp(
      normalized * abs(weight),
      0.0,
      1.0
    );
    let curvatureTarget = select(
      vec3<f32>(0.0),
      vec3<f32>(1.0),
      weight >= 0.0
    );
    color = mix(color, curvatureTarget, edge);
  }

  if (lighting.hazeControl.y > 0.5) {
    let haze =
      1.0 - exp(
        -depth * max(lighting.hazeColor.w, 0.0)
      );
    color = mix(
      color,
      lighting.hazeColor.rgb,
      clamp(
        haze,
        0.0,
        clamp(lighting.hazeControl.x, 0.0, 1.0)
      )
    );
  }

  return vec4<f32>(
    finishColor(color),
    1.0
  );
}
