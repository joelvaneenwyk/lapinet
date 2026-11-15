import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  createH4DirectionTableQ10,
  createH4ExactCandidateTable,
  effectiveH4Direction,
  H4_DIRECTION_COUNT,
  H4_EXACT_CANDIDATES,
} from "../src/systems/scheduled-transport/h4-directions.js";

test("H4 steering table is the 120-direction unit shell", () => {
  const table = createH4DirectionTableQ10();
  assert.equal(table.length, H4_DIRECTION_COUNT * 4);

  const norms = [];
  for (let i = 0; i < H4_DIRECTION_COUNT; i += 1) {
    let n2 = 0;
    for (let a = 0; a < 4; a += 1) {
      const x = table[i * 4 + a];
      n2 += x * x;
    }
    norms.push(n2);
  }

  assert.ok(
    Math.max(...norms) / Math.min(...norms) < 1.01
  );
});

test("zero steering preserves H4 direction and transport shell", () => {
  const zero = [0, 0, 0, 0];
  for (let channel = 0; channel < 240; channel += 1) {
    assert.equal(
      effectiveH4Direction(channel, zero, 4),
      channel
    );
  }
});

test("17 orthant candidates exactly reproduce the 120-direction maximum", () => {
  const directions = createH4DirectionTableQ10();
  const candidates = createH4ExactCandidateTable();
  assert.equal(candidates.length, 16 * H4_EXACT_CANDIDATES);

  for (let sample = 0; sample < 512; sample += 1) {
    const channel = sample % 240;
    const base = channel % 120;
    const steering = [0, 1, 2, 3].map((axis) =>
      (
        (
          Math.imul(
            sample + 1,
            1103515245 + axis * 12345
          ) >>> 8
        ) & 0x3ffff
      ) - 131072
    );

    const desired = [0, 1, 2, 3].map((axis) =>
      directions[base * 4 + axis] * 4 +
      steering[axis]
    );

    let brute = 0;
    let bruteDot = -Infinity;
    for (let direction = 0; direction < 120; direction += 1) {
      let dot = 0;
      for (let axis = 0; axis < 4; axis += 1) {
        dot +=
          directions[direction * 4 + axis] *
          desired[axis];
      }
      if (dot > bruteDot) {
        bruteDot = dot;
        brute = direction;
      }
    }

    assert.equal(
      effectiveH4Direction(channel, steering, 4) % 120,
      brute
    );
  }
});

test("scheduled flock is a dt-free reversible steering layer", () => {
  const shader = readFileSync(
    new URL(
      "../src/systems/scheduled-transport/scheduled-flock.wgsl",
      import.meta.url
    ),
    "utf8"
  );
  const runtime = readFileSync(
    new URL(
      "../src/systems/scs/simulation-runtime.js",
      import.meta.url
    ),
    "utf8"
  );
  const system = readFileSync(
    new URL(
      "../src/systems/scheduled-transport/scheduled-flock.js",
      import.meta.url
    ),
    "utf8"
  );
  const stream = readFileSync(
    new URL(
      "../src/systems/scheduled-transport/gpu-scheduled-e8-stream.wgsl",
      import.meta.url
    ),
    "utf8"
  );
  const centroidShader = readFileSync(
    new URL(
      "../src/systems/scheduled-transport/scheduled-flock-centroids.wgsl",
      import.meta.url
    ),
    "utf8"
  );

  assert.match(shader, /hiddenStage/);
  assert.match(
    shader,
    /cohesionDelta \+ separationDelta - alignmentDelta/
  );
  assert.match(shader, /cohesionImpulse/);
  assert.match(shader, /centroids\[block\]/);
  assert.match(shader, /options\.cohesion/);
  assert.match(shader, /options\.separation/);
  assert.match(shader, /physicalWorld/);
  assert.match(shader, /normalizedPairDirection/);
  assert.match(shader, /const FAN: i32 = 4i/);
  assert.doesNotMatch(shader, /positionScalar/);
  assert.doesNotMatch(shader, /findOccupiedCell/);
  assert.doesNotMatch(shader, /\bdt\b/);
  assert.match(centroidShader, /computeFlockCentroids/);
  assert.match(centroidShader, /@workgroup_size\(64\)/);
  assert.match(centroidShader, /centroids\[wid\.x\]/);


  assert.match(
    system,
    /simulation\.scheduled-flock-reverse/
  );
  assert.match(
    system,
    /simulation\.scheduled-flock-centroids/
  );
  assert.match(
    system,
    /simulation\.scheduled-flock-forward/
  );
  assert.match(stream, /exactCandidates/);
  assert.match(stream, /i < 17u/);
  assert.doesNotMatch(stream, /candidate < 120u/);

  const reverse = runtime.indexOf(
    "scheduler.register(scheduledFlock.reverse)"
  );
  const transport = runtime.indexOf(
    "scheduledTransport.definition ?? scheduledTransport"
  );
  const scs = runtime.indexOf(
    "scheduler.register(locality.definition)"
  );
  const centroids = runtime.indexOf(
    "scheduler.register(scheduledFlock.centroids)"
  );
  const forward = runtime.indexOf(
    "scheduler.register(scheduledFlock.forward)"
  );

  assert.ok(reverse >= 0);
  assert.ok(reverse < transport);
  assert.ok(transport < scs);
  assert.ok(scs < centroids);
  assert.ok(centroids < forward);
});

test("flock v0 defaults favor cohesion without suppressing separation", () => {
  const schema = readFileSync(
    new URL(
      "../src/config/config-schema.js",
      import.meta.url
    ),
    "utf8"
  );

  assert.match(
    schema,
    /simulation\.flock\.cohesion[\s\S]*?default: 16/
  );
  assert.match(
    schema,
    /simulation\.flock\.separation[\s\S]*?default: 1/
  );
  assert.match(
    schema,
    /simulation\.flock\.positionGain[\s\S]*?default: 64/
  );
});
