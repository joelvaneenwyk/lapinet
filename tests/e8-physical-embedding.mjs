import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  createIsotropicE8Seed,
} from "../src/systems/scs/fixture-particles.js";
import {
  physical4FromStoredE8,
  signedE8Coefficients,
} from "../src/systems/scheduled-transport/e8-physical.js";
import {
  physical4E8,
} from "../src/systems/scheduled-transport/noether/icosian-e8.mjs";

test("stored modular E8 coefficients map to Noether physical4 exactly", () => {
  for (let i = 0; i < 256; i += 1) {
    const signed = createIsotropicE8Seed(i);
    const stored = Array.from(
      signed,
      (value) => value & 4095
    );

    const expected = physical4E8(
      signedE8Coefficients(stored)
    );
    const actual = physical4FromStoredE8(stored);

    for (let axis = 0; axis < 4; axis += 1) {
      assert.ok(
        Math.abs(actual[axis] - expected[axis]) < 1e-12,
        "axis " + axis + " sample " + i
      );
    }
  }
});

test("H4-root fixture seed is physically isotropic across four axes", () => {
  const count = 20000;
  const sum = [0, 0, 0, 0];
  const sum2 = [0, 0, 0, 0];

  for (let i = 0; i < count; i += 1) {
    const signed = createIsotropicE8Seed(i);
    const stored = Array.from(
      signed,
      (value) => value & 4095
    );
    const p = physical4FromStoredE8(stored);

    for (let axis = 0; axis < 4; axis += 1) {
      sum[axis] += p[axis];
      sum2[axis] += p[axis] * p[axis];
    }
  }

  const means = sum.map((value) => value / count);
  const sigma = sum2.map((value, axis) =>
    Math.sqrt(
      value / count -
      means[axis] * means[axis]
    )
  );

  const minSigma = Math.min(...sigma);
  const maxSigma = Math.max(...sigma);

  assert.ok(
    maxSigma / minSigma < 1.02,
    "physical-axis sigma ratio " +
      (maxSigma / minSigma)
  );
  assert.ok(
    Math.max(...means.map(Math.abs)) < 1,
    "fixture mean drift " + means.join(",")
  );
});

test("renderer and SCS shaders use canonical icosian basis transform", () => {
  const files = [
    "../src/render/particles/simulation-particle-pass.wgsl",
    "../src/gpu/scs/gpu-r4-keys.wgsl",
    "../src/gpu/scs/gpu-r4-neighbors.wgsl",
    "../src/gpu/scs/gpu-r4-hierarchy.wgsl",
    "../src/systems/scheduled-transport/gpu-scheduled-e8-stream.wgsl",
  ];

  for (const relative of files) {
    const source = readFileSync(
      new URL(relative, import.meta.url),
      "utf8"
    );

    assert.match(source, /icosianNumerator/);
    assert.match(
      source,
      /z\[4\].*k\[0\].*k\[1\].*k\[3\].*k\[4\]/
    );
    assert.match(source, /signed12/);
    assert.doesNotMatch(source, /center\s*=\s*4095/);
  }
});
