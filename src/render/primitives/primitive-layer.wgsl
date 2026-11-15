struct PrimitiveGlobals {
  resolutionNearFar: vec4<f32>,
  projectionStyle: vec4<f32>,
  cameraPosition: vec4<f32>,
  cameraForward: vec4<f32>,
  cameraRight: vec4<f32>,
  cameraUp: vec4<f32>,
};

struct Splat {
  positionRadius: vec4<f32>,
  color: vec4<f32>,
};

struct LineRecord {
  a: vec4<f32>,
  b: vec4<f32>,
  color: vec4<f32>,
  style: vec4<f32>,
};

struct SdfSplat {
  positionRadius: vec4<f32>,
  color: vec4<f32>,
  shape: vec4<f32>,
  parameters: vec4<f32>,
};

struct PolygonVertex {
  position: vec4<f32>,
  color: vec4<f32>,
};

@group(0) @binding(0) var<uniform> globals: PrimitiveGlobals;
@group(0) @binding(1) var<storage, read> splats: array<Splat>;
@group(0) @binding(2) var<storage, read> thinLines: array<LineRecord>;
@group(0) @binding(3) var<storage, read> thickLines: array<LineRecord>;
@group(0) @binding(4) var<storage, read> sdfSplats: array<SdfSplat>;
@group(0) @binding(5) var<storage, read> polygonVertices: array<PolygonVertex>;
@group(0) @binding(6) var implicitDepth: texture_2d<f32>;

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

fn viewDepth(position: vec3<f32>) -> f32 {
  return dot(
    position - globals.cameraPosition.xyz,
    globals.cameraForward.xyz
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
  let sceneZ = implicitDepthAt(pixel);
  return
    sceneZ < farPlane() * 0.999 &&
    viewZ > sceneZ + 0.0008;
}

fn safeDirection(value: vec3<f32>) -> vec3<f32> {
  let m2 = dot(value, value);
  return select(
    vec3<f32>(0.0, 0.0, -1.0),
    value * inverseSqrt(max(m2, 1e-12)),
    m2 > 1e-12
  );
}

fn shade(color: vec3<f32>, normal: vec3<f32>) -> vec3<f32> {
  let light = safeDirection(vec3<f32>(-0.35, 0.78, -0.52));
  let diffuse = max(dot(normal, light), 0.0);
  let rim = pow(
    1.0 - abs(dot(normal, -globals.cameraForward.xyz)),
    2.0
  );
  return color * (0.28 + diffuse * 0.86) + rim * 0.10;
}

struct BillboardOut {
  @builtin(position) position: vec4<f32>,
  @location(0) local: vec2<f32>,
  @location(1) center: vec3<f32>,
  @location(2) radius: f32,
  @location(3) centerDepth: f32,
  @location(4) color: vec4<f32>,
  @location(5) shape: vec4<f32>,
};

fn billboardCorner(index: u32) -> vec2<f32> {
  var corners = array<vec2<f32>, 4>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 1.0, -1.0),
    vec2<f32>(-1.0,  1.0),
    vec2<f32>( 1.0,  1.0)
  );
  return corners[index];
}

fn billboardClip(
  center: vec3<f32>,
  radius: f32,
  corner: vec2<f32>
) -> vec4<f32> {
  var clip = projectWorld(center);
  let z = viewDepth(center);
  if (z <= nearPlane()) {
    return clip;
  }

  let tanY = max(tan(globals.projectionStyle.x * 0.5), 1e-6);
  let aspect = max(
    globals.resolutionNearFar.x /
      max(globals.resolutionNearFar.y, 1.0),
    1e-6
  );
  let radiusY = radius / (z * tanY);
  let radiusX = radiusY / aspect;
  clip.xy = clip.xy + corner * vec2<f32>(radiusX, radiusY);
  return clip;
}

@vertex
fn splatVertex(
  @builtin(vertex_index) vertexIndex: u32,
  @builtin(instance_index) instanceIndex: u32
) -> BillboardOut {
  let item = splats[instanceIndex];
  let radius =
    max(item.positionRadius.w, 1e-6) *
    max(globals.projectionStyle.z, 0.0);
  let corner = billboardCorner(vertexIndex);

  var out: BillboardOut;
  out.position = billboardClip(
    item.positionRadius.xyz,
    radius,
    corner
  );
  out.local = corner;
  out.center = item.positionRadius.xyz;
  out.radius = radius;
  out.centerDepth = viewDepth(item.positionRadius.xyz);
  out.color = item.color;
  out.shape = vec4<f32>(0.0);
  return out;
}

struct ColorDepthOut {
  @location(0) color: vec4<f32>,
  @builtin(frag_depth) depth: f32,
};

@fragment
fn splatFragment(in: BillboardOut) -> ColorDepthOut {
  let r2 = dot(in.local, in.local);
  let aa = clamp(fwidth(r2) * 1.25, 0.001, 0.08);
  if (r2 > 1.0 || in.centerDepth <= nearPlane()) {
    discard;
  }

  let sphereZ = sqrt(max(1.0 - r2, 0.0));
  let surfaceDepth = in.centerDepth - sphereZ * in.radius;
  if (hiddenByImplicit(surfaceDepth, in.position.xy)) {
    discard;
  }

  let normal = safeDirection(
    globals.cameraRight.xyz * in.local.x +
    globals.cameraUp.xyz * in.local.y -
    globals.cameraForward.xyz * sphereZ
  );
  let coverage = 1.0 - smoothstep(1.0 - aa, 1.0, r2);
  let alpha =
    coverage *
    in.color.a *
    clamp(globals.projectionStyle.w, 0.0, 1.0);
  if (alpha <= 1.0 / 255.0) {
    discard;
  }

  var out: ColorDepthOut;
  out.color = vec4<f32>(shade(in.color.rgb, normal), alpha);
  out.depth = depth01(surfaceDepth);
  return out;
}

struct LineOut {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec4<f32>,
  @location(1) viewZ: f32,
};

@vertex
fn thinLineVertex(
  @builtin(vertex_index) vertexIndex: u32,
  @builtin(instance_index) instanceIndex: u32
) -> LineOut {
  let item = thinLines[instanceIndex];
  let useB = vertexIndex != 0u;
  let world = select(item.a.xyz, item.b.xyz, useB);

  var out: LineOut;
  out.position = projectWorld(world);
  out.color = item.color;
  out.viewZ = viewDepth(world);
  return out;
}

@fragment
fn lineFragment(in: LineOut) -> ColorDepthOut {
  if (
    in.color.a <= 1.0 / 255.0 ||
    hiddenByImplicit(in.viewZ, in.position.xy)
  ) {
    discard;
  }

  var out: ColorDepthOut;
  out.color = vec4<f32>(
    in.color.rgb,
    in.color.a * clamp(globals.projectionStyle.w, 0.0, 1.0)
  );
  out.depth = depth01(in.viewZ);
  return out;
}

@vertex
fn thickLineVertex(
  @builtin(vertex_index) vertexIndex: u32,
  @builtin(instance_index) instanceIndex: u32
) -> LineOut {
  let item = thickLines[instanceIndex];
  let clipA = projectWorld(item.a.xyz);
  let clipB = projectWorld(item.b.xyz);
  let zA = viewDepth(item.a.xyz);
  let zB = viewDepth(item.b.xyz);

  var pattern = array<vec3<f32>, 6>(
    vec3<f32>(0.0, -1.0, 0.0),
    vec3<f32>(0.0,  1.0, 0.0),
    vec3<f32>(1.0, -1.0, 0.0),
    vec3<f32>(1.0, -1.0, 0.0),
    vec3<f32>(0.0,  1.0, 0.0),
    vec3<f32>(1.0,  1.0, 0.0)
  );
  let spec = pattern[vertexIndex];
  let base = mix(clipA, clipB, spec.x);
  let deltaPixels =
    (clipB.xy - clipA.xy) *
    0.5 *
    globals.resolutionNearFar.xy;
  var direction = vec2<f32>(1.0, 0.0);
  if (dot(deltaPixels, deltaPixels) > 1e-8) {
    direction = normalize(deltaPixels);
  }
  let normal = vec2<f32>(-direction.y, direction.x);
  let widthPixels =
    max(item.style.x, 1.0) *
    max(globals.projectionStyle.y, 0.0);
  let offsetNdc =
    normal *
    spec.y *
    widthPixels *
    2.0 /
    max(globals.resolutionNearFar.xy, vec2<f32>(1.0));

  var out: LineOut;
  out.position = vec4<f32>(
    base.xy + offsetNdc,
    base.z,
    base.w
  );
  out.color = item.color;
  out.viewZ = mix(zA, zB, spec.x);
  return out;
}

fn sdRoundedBox(p: vec3<f32>, extent: f32, radius: f32) -> f32 {
  let q = abs(p) - vec3<f32>(extent);
  return
    length(max(q, vec3<f32>(0.0))) +
    min(max(q.x, max(q.y, q.z)), 0.0) -
    radius;
}

fn localSdf(p: vec3<f32>, shape: vec4<f32>) -> f32 {
  let kind = u32(round(shape.x));

  if (kind == 1u) {
    return sdRoundedBox(
      p,
      clamp(shape.y, 0.05, 0.95),
      clamp(shape.z, 0.0, 0.45)
    );
  }

  if (kind == 2u) {
    let major = clamp(shape.y, 0.10, 0.85);
    let minor = clamp(shape.z, 0.03, 0.45);
    let q = vec2<f32>(length(p.xy) - major, p.z);
    return length(q) - minor;
  }

  return length(p) - clamp(shape.y, 0.05, 0.95);
}

fn localSdfNormal(p: vec3<f32>, shape: vec4<f32>) -> vec3<f32> {
  let e = 0.006;
  let ex = vec2<f32>(e, -e);
  return safeDirection(
    ex.xyy * localSdf(p + ex.xyy, shape) +
    ex.yyx * localSdf(p + ex.yyx, shape) +
    ex.yxy * localSdf(p + ex.yxy, shape) +
    ex.xxx * localSdf(p + ex.xxx, shape)
  );
}

@vertex
fn sdfSplatVertex(
  @builtin(vertex_index) vertexIndex: u32,
  @builtin(instance_index) instanceIndex: u32
) -> BillboardOut {
  let item = sdfSplats[instanceIndex];
  let radius = max(item.positionRadius.w, 1e-6);
  let corner = billboardCorner(vertexIndex);

  var out: BillboardOut;
  out.position = billboardClip(
    item.positionRadius.xyz,
    radius,
    corner
  );
  out.local = corner;
  out.center = item.positionRadius.xyz;
  out.radius = radius;
  out.centerDepth = viewDepth(item.positionRadius.xyz);
  out.color = item.color;
  out.shape = item.shape;
  return out;
}

@fragment
fn sdfSplatFragment(in: BillboardOut) -> ColorDepthOut {
  if (dot(in.local, in.local) > 1.45) {
    discard;
  }

  var t = -1.25;
  var hit = false;
  var hitPoint = vec3<f32>(0.0);

  for (var i = 0u; i < 36u; i = i + 1u) {
    let p = vec3<f32>(in.local, t);
    let d = localSdf(p, in.shape);
    if (abs(d) <= 0.004) {
      hit = true;
      hitPoint = p;
      break;
    }
    t = t + max(d * 0.72, 0.008);
    if (t > 1.25) {
      break;
    }
  }

  if (!hit) {
    discard;
  }

  let surfaceDepth = in.centerDepth + hitPoint.z * in.radius;
  if (hiddenByImplicit(surfaceDepth, in.position.xy)) {
    discard;
  }

  let localNormal = localSdfNormal(hitPoint, in.shape);
  let normal = safeDirection(
    globals.cameraRight.xyz * localNormal.x +
    globals.cameraUp.xyz * localNormal.y +
    globals.cameraForward.xyz * localNormal.z
  );

  var out: ColorDepthOut;
  out.color = vec4<f32>(
    shade(in.color.rgb, normal),
    in.color.a * clamp(globals.projectionStyle.w, 0.0, 1.0)
  );
  out.depth = depth01(surfaceDepth);
  return out;
}

struct PolygonOut {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec4<f32>,
  @location(1) viewZ: f32,
};

@vertex
fn polygonVertex(
  @builtin(vertex_index) vertexIndex: u32
) -> PolygonOut {
  let item = polygonVertices[vertexIndex];

  var out: PolygonOut;
  out.position = projectWorld(item.position.xyz);
  out.color = item.color;
  out.viewZ = viewDepth(item.position.xyz);
  return out;
}

@fragment
fn polygonFragment(in: PolygonOut) -> ColorDepthOut {
  if (hiddenByImplicit(in.viewZ, in.position.xy)) {
    discard;
  }

  var out: ColorDepthOut;
  out.color = vec4<f32>(
    in.color.rgb,
    in.color.a * clamp(globals.projectionStyle.w, 0.0, 1.0)
  );
  out.depth = depth01(in.viewZ);
  return out;
}
