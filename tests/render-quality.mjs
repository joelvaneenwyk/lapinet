import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

test("deferred resolve is edge-aware and camera-correct", () => {
  const source = readFileSync(
    new URL(
      "../src/render/deferred/deferred-lighting.wgsl",
      import.meta.url
    ),
    "utf8"
  );

  assert.match(source, /fn reconstructionWeight/);
  assert.match(source, /fn resolveSurface/);
  assert.match(source, /cameraPosition/);
  assert.match(source, /fn cameraRay/);
  assert.match(source, /tan\(\s*lighting\.cameraProjection\.x \* 0\.5\s*\)/);
  assert.doesNotMatch(source, /max\(lighting\.cameraProjection\.x, 0\.01\)/);
  assert.match(source, /D_GGX/);
  assert.match(source, /F_Schlick/);
  assert.match(source, /V_SmithGGXCorrelated/);
  assert.match(source, /material\.w/);
});

test("implicit quality path publishes adaptive precision and trace effort", () => {
  const source = readFileSync(
    new URL(
      "../src/render/implicit/implicit-surface.wgsl",
      import.meta.url
    ),
    "utf8"
  );

  assert.match(source, /fn hitEpsilon\(distance: f32, p: vec3<f32>\)/);
  assert.match(source, /tracePrecision\.x/);
  assert.match(source, /pixelFootprint\(distance\)/);
  assert.match(source, /var t = 0\.0;/);
  assert.match(source, /var hasPrevious = false;/);
  assert.match(source, /if \(hasPrevious\)/);
  assert.match(source, /previousDistance < 0\.0 && sample\.distance >= 0\.0/);
  assert.match(source, /previousDistance > 0\.0 && sample\.distance <= 0\.0/);
  assert.match(source, /let hitT = 0\.5 \* \(lo \+ hi\);/);
  assert.doesNotMatch(source, /if \(sample\.distance <= epsilon\)/);
  assert.match(source, /let stepLength = clamp\(\s*sample\.step,/);
  assert.doesNotMatch(
    source,
    /max\(\s*sample\.step,\s*sample\.lowerBound\s*\)/
  );
  assert.doesNotMatch(source, /trace\.z/);
  assert.match(source, /fn scalarUlp\(value: f32\)/);
  assert.match(source, /fn positionUlp\(p: vec3<f32>\)/);
  assert.match(source, /const NUMERICAL_ULP_MARGIN: f32 = 16\.0/);
  assert.match(source, /positionUlp\(p\) \* NUMERICAL_ULP_MARGIN/);
  assert.doesNotMatch(source, /dot\(normal, ray\) > 0\.0/);
  assert.doesNotMatch(source, /normal = -normal/);
  assert.match(source, /let normal = fieldNormal\(hit\.position, hit\.distance\)/);
  assert.match(source, /vec4<f32>\(normal, effort\)/);
});


test("rich readability shading has no hidden attenuation coefficients", () => {
  const source = readFileSync(
    new URL(
      "../src/render/deferred/deferred-lighting.wgsl",
      import.meta.url
    ),
    "utf8"
  );
  const passSource = readFileSync(
    new URL(
      "../src/render/deferred/deferred-lighting-pass.js",
      import.meta.url
    ),
    "utf8"
  );

  for (const symbol of [
    "rimColor",
    "rimControl",
    "curvature",
    "occlusion",
    "hazeColor",
    "hazeControl",
    "tone",
    "reconstruction0",
    "reconstruction1",
    "shadingControl",
    "finishColor",
  ]) {
    assert.match(source, new RegExp(symbol));
  }

  assert.doesNotMatch(source, /hemisphere/i);
  assert.match(source, /let viewDirection = -ray;/);
  assert.doesNotMatch(
    source,
    /cameraPosition\.xyz - worldPosition/
  );

  for (const setting of [
    "ambientMetallicAttenuation",
    "ambientTransmissionAttenuation",
    "rimMetallicAttenuation",
    "ambientOcclusionBendScale",
  ]) {
    assert.match(passSource, new RegExp(setting));
  }

  assert.doesNotMatch(source, /metallic \* 0\.65/);
  assert.doesNotMatch(source, /transmission \* 0\.5/);
  assert.doesNotMatch(source, /metallic \* 0\.5/);
  assert.doesNotMatch(source, /bend \* 4\.0/);
});



test("orbit surface zoom reads the authoritative G-buffer depth", () => {
  const gbufferSource = readFileSync(
    new URL("../src/render/gbuffer.js", import.meta.url),
    "utf8"
  );
  const mainSource = readFileSync(
    new URL("../src/main.js", import.meta.url),
    "utf8"
  );
  const controlsSource = readFileSync(
    new URL(
      "../src/render/camera-controls.js",
      import.meta.url
    ),
    "utf8"
  );

  assert.match(gbufferSource, /usage\.COPY_SRC/);
  assert.match(gbufferSource, /async readDepthAt\(x, y\)/);
  assert.match(gbufferSource, /copyTextureToBuffer/);
  assert.match(mainSource, /resolveOrbitSurfaceTarget/);
  assert.match(mainSource, /gbuffer\.readDepthAt/);
  assert.match(mainSource, /const uvX = \(px \+ 0\.5\) \/ gbuffer\.width \* 2 - 1/);
  assert.match(mainSource, /const uvY = -\(\(py \+ 0\.5\) \/ gbuffer\.height \* 2 - 1\)/);
  assert.match(mainSource, /const tanHalfFov = Math\.tan\(snapshot\.fovY \* 0\.5\)/);
  assert.match(mainSource, /const rayLength = Math\.hypot\(\.\.\.ray\)/);
  assert.doesNotMatch(mainSource, /snapshot\.forward\[axis\] \* depth/);
  assert.match(
    controlsSource,
    /resolveOrbitTarget = null/
  );
  assert.match(
    controlsSource,
    /controller\.initializeOrbit\(/
  );
});
