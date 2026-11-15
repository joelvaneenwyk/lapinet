struct FractalParameters {
  rotationScale: vec4<f32>,
  translationScale: vec4<f32>,
  rotationVelocity: vec4<f32>,
  control: vec4<f32>, // x iterations, y safety factor
  rotation0: vec4<f32>,
  rotation1: vec4<f32>,
  rotation2: vec4<f32>,
  derived: vec4<f32>, // x norm, y safety, z abs(scale), w iterations
};

@group(1) @binding(0) var<uniform> fieldParameters: FractalParameters;

fn evaluateField(p0: vec3<f32>) -> FieldSample {
  let scale = fieldParameters.rotationScale.w;
  let translation =
    fieldParameters.translationScale.xyz *
    fieldParameters.translationScale.w;
  let rotationMatrix = mat3x3<f32>(
    fieldParameters.rotation0.xyz,
    fieldParameters.rotation1.xyz,
    fieldParameters.rotation2.xyz
  );
  let iterations = u32(fieldParameters.derived.w);

  var p = p0;
  for (var i = 0u; i < iterations; i = i + 1u) {
    p = abs(p * rotationMatrix) * scale - translation;
  }

  let d =
    max(max(p.x, p.y), p.z) *
    fieldParameters.derived.x;

  return FieldSample(
    d,
    abs(d) * fieldParameters.derived.y,
    abs(d) * fieldParameters.derived.z,
    1u
  );
}
