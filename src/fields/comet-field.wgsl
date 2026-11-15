struct CometParameters {
  rotationScale: vec4<f32>,
  positionScale: vec4<f32>,
  foldWeight: vec4<f32>,
  field: vec4<f32>,
  control: vec4<f32>, // x iterations, y safety factor
};

@group(1) @binding(0) var<uniform> fieldParameters: CometParameters;

fn fieldTri(x: f32) -> f32 {
  return abs(fract(x) - 0.5);
}

fn fieldRotationMatrix(r: vec3<f32>) -> mat3x3<f32> {
  let a = vec3<f32>(
    cos(r.x) * cos(r.y),
    sin(r.y),
    sin(r.x) * cos(r.y)
  );
  let c = cos(r.z);
  let s = sin(r.z);
  let as_ = a * s;
  let ac = a * a * (1.0 - c);
  let ad = a.yzx * a.zxy * (1.0 - c);

  return mat3x3<f32>(
    vec3<f32>(c + ac.x, ad.z - as_.z, ad.y + as_.y),
    vec3<f32>(ad.z + as_.z, c + ac.y, ad.x - as_.x),
    vec3<f32>(ad.y - as_.y, ad.x + as_.x, c + ac.z)
  );
}

fn evaluateField(p0: vec3<f32>) -> FieldSample {
  let rotationEuler = fieldParameters.rotationScale.xyz;
  let rotationScale = fieldParameters.rotationScale.w;
  let positionOffset = fieldParameters.positionScale.xyz;
  let positionScale = fieldParameters.positionScale.w;
  let foldScale = fieldParameters.foldWeight.x;
  let weightScale = fieldParameters.foldWeight.y;
  let radiusScale = fieldParameters.foldWeight.z;
  let radiusFieldScale = fieldParameters.foldWeight.w;
  let fieldScale = fieldParameters.field.x;
  let amplitude = fieldParameters.field.y;
  let massOffset = fieldParameters.field.z;
  let rangeBlend = fieldParameters.field.w;
  let iterations = u32(clamp(
    round(fieldParameters.control.x),
    1.0,
    64.0
  ));

  var position = p0;
  var mass = length(position) * positionScale;
  let rotation = fieldRotationMatrix(rotationEuler) * rotationScale;
  var field = 0.0;
  var radius = 0.0;
  var fold = vec3<f32>(0.0);
  var fmax = 0.0;
  var fmin = 999999999.0;

  for (var i = 0u; i < iterations; i = i + 1u) {
    let weight = f32(i + 1u) / f32(iterations);
    position = (position + positionOffset) * rotation;
    position = position * pow(1.0 + weight, weightScale);

    fold = fold + vec3<f32>(
      fieldTri(position.z),
      fieldTri(position.y),
      fieldTri(position.x)
    );
    fold = fold * rotation;

    radius =
      fieldTri(fieldTri(fieldTri(fold.x) + fold.y) + fold.z) *
      foldScale;
    radius = radius * radiusScale;
    radius =
      radius +
      field * (1.0 - weight) * radiusFieldScale;

    field = field + fieldTri(radius) * weight;
    field = field * fieldScale;
    fmin = min(field, fmin);
    fmax = max(field, fmax);
  }

  field = mix(fmin, fmax, rangeBlend) * 0.0000001;
  let d = (mass + field * amplitude) - massOffset;
  let safety = clamp(fieldParameters.control.y, 0.01, 1.0);

  return FieldSample(
    d,
    abs(d) * safety,
    0.0,
    2u
  );
}
