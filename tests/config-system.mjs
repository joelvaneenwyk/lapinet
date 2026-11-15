import assert from "node:assert/strict";
import test from "node:test";

import {
  LAPINET_CONFIG_SCHEMA,
  LAPINET_CONFIG_VERSION,
} from "../src/config/config-schema.js";
import {
  ConfigSystem,
} from "../src/config/config-system.js";

function makeConfig(initial = null) {
  return new ConfigSystem({
    version: LAPINET_CONFIG_VERSION,
    schema: LAPINET_CONFIG_SCHEMA,
    initial,
  });
}

test("config defaults preserve Lapin UI defaults", () => {
  const config = makeConfig();

  assert.equal(config.get("ui.fontSize"), 12);
  assert.equal(config.get("ui.sliderWidth"), 82);
});

test("config normalizes authored UI values", () => {
  const config = makeConfig();

  assert.equal(config.set("ui.fontSize", 999), 20);
  assert.equal(config.set("ui.sliderWidth", -1), 48);

  assert.throws(
    () => config.set("unknown.value", 1),
    /Unknown config field/
  );
});

test("restore fills missing fields and ignores unknown fields", () => {
  const config = makeConfig();

  config.restore({
    version: LAPINET_CONFIG_VERSION,
    values: {
      ui: {
        fontSize: 15,
        invented: "ignored",
      },
      inventedRoot: true,
    },
  });

  assert.equal(config.get("ui.fontSize"), 15);
  assert.equal(config.get("ui.sliderWidth"), 82);
  assert.equal("inventedRoot" in config.snapshot().values, false);
  assert.equal("invented" in config.snapshot().values.ui, false);
});

test("late-defined config fields hydrate from the original saved document", () => {
  const config = makeConfig({
    version: LAPINET_CONFIG_VERSION,
    values: {
      ui: {
        fontSize: 13,
      },
      display: {
        visibility: {
          displays: false,
        },
      },
    },
  });

  assert.equal(config.hasSourceValue("display.visibility.displays"), true);

  config.define({
    path: "display.visibility.displays",
    label: "Display: Displays",
    type: "boolean",
    default: true,
  });

  assert.equal(config.get("display.visibility.displays"), false);
  assert.equal(
    config.snapshot().values.display.visibility.displays,
    false
  );
});

test("reset applies defaults to dynamically registered display state", () => {
  const config = makeConfig();
  config.define({
    path: "display.visibility.displays",
    label: "Display: Displays",
    type: "boolean",
    default: true,
  });

  config.set("display.visibility.displays", false);
  config.reset();

  assert.equal(config.get("display.visibility.displays"), true);
});

test("snapshots are detached from canonical state", () => {
  const config = makeConfig();
  const snapshot = config.snapshot();

  snapshot.values.ui.fontSize = 19;

  assert.equal(config.get("ui.fontSize"), 12);
});

test("duplicate schema paths are rejected", () => {
  assert.throws(
    () => new ConfigSystem({
      version: 1,
      schema: [
        { path: "a", type: "number", default: 1 },
        { path: "a", type: "number", default: 2 },
      ],
    }),
    /Duplicate config field/
  );
});


test("cursor config defaults and color normalization are canonical", () => {
  const config = makeConfig();

  assert.equal(config.get("render.cursor.reticule"), true);
  assert.equal(config.get("render.cursor.size"), 1);
  assert.equal(config.get("render.cursor.color"), "#f0f7ff");
  assert.equal(config.get("render.cursor.opacity"), 0.95);

  assert.equal(
    config.set("render.cursor.color", "#80A0ff"),
    "#80a0ff"
  );
  assert.equal(
    config.set("render.cursor.color", "not-a-color"),
    "#f0f7ff"
  );
  assert.equal(config.set("render.cursor.size", 99), 4);
  assert.equal(config.set("render.cursor.opacity", -2), 0);
});


test("implicit render scale defaults to quality half scale and clamps", () => {
  const config = makeConfig();

  assert.equal(config.get("render.implicit.renderScale"), 0.5);
  assert.equal(config.set("render.implicit.renderScale", 0.25), 0.25);
  assert.equal(config.set("render.implicit.renderScale", 9), 1);
  assert.equal(config.set("render.implicit.renderScale", 0), 0.125);
});

test("camera and adaptive-normal defaults are canonical", () => {
  const config = makeConfig();

  assert.equal(config.get("render.camera.mode"), "orbit");
  assert.equal(config.get("render.camera.moveSpeed"), 0.55);
  assert.equal(config.get("render.camera.lookSensitivity"), 0.002);
  assert.equal(config.get("render.camera.boostMultiplier"), 3.25);
  assert.equal(config.get("render.implicit.hitEpsilon"), 0.00000001);
  assert.equal(config.get("render.implicit.hitDistanceScale"), 0.05);
  assert.equal(config.get("render.implicit.normalEpsilon"), 0.00000001);
  assert.equal(config.get("render.implicit.normalDistanceScale"), 0.5);
  assert.equal(config.set("render.camera.mode", "free"), "free");
  assert.equal(config.set("render.camera.mode", "tracking"), "orbit");
});


test("rich shading coefficients remain canonical configuration", () => {
  const config = makeConfig();
  const expected = {
    "render.material.color": "#adbacc",
    "render.reconstruction.enabled": true,
    "render.reconstruction.depthScale": 0.0125,
    "render.reconstruction.depthMinimum": 0.0015,
    "render.reconstruction.depthFalloff": 4,
    "render.reconstruction.normalPower": 4,
    "render.reconstruction.normalFloor": 0.2,
    "render.lighting.keyIntensity": 2.2,
    "render.lighting.keyColor": "#fff2d1",
    "render.lighting.ambientIntensity": 0.055,
    "render.lighting.ambientColor": "#ffffff",
    "render.shading.rimEnabled": true,
    "render.shading.rimStrength": 0.18,
    "render.shading.rimPower": 3,
    "render.shading.rimColor": "#a8c8ff",
    "render.shading.curvatureEnabled": true,
    "render.shading.curvatureWeight": 0.65,
    "render.shading.curvatureMinimum": 0.01,
    "render.shading.curvatureMaximum": 0.25,
    "render.shading.ambientOcclusionEnabled": true,
    "render.shading.ambientOcclusionStrength": 0.35,
    "render.shading.ambientOcclusionBias": 0.05,
    "render.shading.ambientOcclusionRange": 1,
    "render.shading.ambientOcclusionBendScale": 4,
    "render.shading.ambientMetallicAttenuation": 0.65,
    "render.shading.ambientTransmissionAttenuation": 0.5,
    "render.shading.rimMetallicAttenuation": 0.5,
    "render.haze.enabled": true,
    "render.haze.density": 0.08,
    "render.haze.color": "#072137",
    "render.haze.maxOpacity": 0.72,
    "render.tone.brightness": 1,
    "render.tone.contrast": 1,
    "render.tone.exposure": 1,
    "render.tone.gamma": 1.9,
  };

  for (const [path, value] of Object.entries(expected)) {
    assert.equal(config.get(path), value, path);
  }
});

test("fractal default depth reaches the float32 precision regime", () => {
  const config = makeConfig();
  assert.equal(config.get("field.fractal.iterations"), 40);
  assert.equal(config.get("render.implicit.performanceRevision"), 3);
});

test("implicit field selector is a validated enum", () => {
  const config = makeConfig();

  assert.equal(config.get("render.implicit.field"), "fractal");
  assert.equal(config.set("render.implicit.field", "none"), "none");
  assert.equal(config.set("render.implicit.field", "plane"), "plane");
  assert.equal(config.set("render.implicit.field", "comet"), "comet");
  assert.equal(
    config.set("render.implicit.field", "not-a-field"),
    "fractal"
  );
});


test("simulation controls are canonical configuration state", () => {
  const config = makeConfig();

  assert.equal(config.get("simulation.control.enabled"), true);
  assert.equal(config.get("simulation.control.paused"), false);
  assert.equal(config.set("simulation.control.enabled", false), false);
  assert.equal(config.set("simulation.control.paused", true), true);
});


test("render pause is canonical configuration state", () => {
  const config = makeConfig();

  assert.equal(config.get("render.control.paused"), false);
  assert.equal(config.set("render.control.paused", true), true);
  assert.equal(config.get("render.control.paused"), true);
});
