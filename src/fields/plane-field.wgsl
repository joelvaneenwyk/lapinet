struct PlaneParameters {
  control: vec4<f32>, // x = world-space plane height
};

@group(1) @binding(0) var<uniform> fieldParameters: PlaneParameters;

fn evaluateField(p0: vec3<f32>) -> FieldSample {
  let d = p0.y - fieldParameters.control.x;
  let exactDistance = abs(d);
  return FieldSample(
    d,
    exactDistance,
    exactDistance,
    3u
  );
}
