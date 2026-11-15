import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  PrimitiveSource,
} from "../src/primitives/primitive-source.js";
import {
  createPrimitiveTestScene,
} from "../src/scene/primitive-test-scene.js";
import {
  PrimitiveLayerPass,
  PRODUCER_DEFINITIONS,
} from "../src/render/primitives/primitive-layer-pass.js";

function fakeDevice() {
  const calls = [];
  const writes = [];

  return {
    calls,
    writes,
    device: {
      queue: {
        writeBuffer(buffer, offset, data) {
          writes.push({
            buffer,
            offset,
            byteLength: data.byteLength,
          });
        },
      },
      createBuffer(descriptor) {
        const buffer = {
          descriptor,
          destroy() {},
        };
        calls.push(["buffer", descriptor]);
        return buffer;
      },
      createShaderModule(descriptor) {
        calls.push(["shader", descriptor]);
        return { descriptor };
      },
      createRenderPipeline(descriptor) {
        calls.push(["pipeline", descriptor]);
        return {
          descriptor,
          getBindGroupLayout(index) {
            return { index, label: descriptor.label };
          },
        };
      },
      createBindGroup(descriptor) {
        calls.push(["bind-group", descriptor]);
        return { descriptor };
      },
    },
  };
}

test("primitive source owns GPU buffers independently of rendering", () => {
  const previousUsage = globalThis.GPUBufferUsage;
  globalThis.GPUBufferUsage = {
    STORAGE: 1,
    COPY_DST: 2,
  };

  try {
    const fake = fakeDevice();
    const scene = createPrimitiveTestScene();
    const source = new PrimitiveSource({
      device: fake.device,
      ...scene,
    });

    assert.deepEqual(source.counts, {
      splats: 3,
      thinLines: 2,
      thickLines: 2,
      sdfSplats: 2,
      polygonVertices: 6,
    });
    assert.equal(fake.calls.filter(([kind]) => kind === "buffer").length, 5);
    assert.equal(fake.writes.length, 5);
    assert.equal("renderer" in source, false);
    assert.equal("canvas" in source, false);
  } finally {
    globalThis.GPUBufferUsage = previousUsage;
  }
});

test("primitive layer exposes five independently toggleable producers", () => {
  assert.deepEqual(
    PRODUCER_DEFINITIONS.map((item) => [
      item.id,
      item.topology,
    ]),
    [
      ["primitive.splats", "triangle-strip"],
      ["primitive.lines", "line-list"],
      ["primitive.thick-lines", "triangle-list"],
      ["primitive.sdf-splats", "triangle-strip"],
      ["primitive.polygons", "triangle-list"],
    ]
  );

  const ids = new Set(PRODUCER_DEFINITIONS.map((item) => item.id));
  assert.equal(ids.size, PRODUCER_DEFINITIONS.length);
});

test("primitive shader includes sphere splats, thick quads, local SDFs, and polygons", () => {
  const source = readFileSync(
    new URL(
      "../src/render/primitives/primitive-layer.wgsl",
      import.meta.url
    ),
    "utf8"
  );

  assert.match(source, /fn splatVertex/);
  assert.match(source, /fn splatFragment/);
  assert.match(source, /fn thinLineVertex/);
  assert.match(source, /fn thickLineVertex/);
  assert.match(source, /array<vec3<f32>, 6>/);
  assert.match(source, /fn localSdf\(/);
  assert.match(source, /fn sdfSplatFragment/);
  assert.match(source, /for \(var i = 0u; i < 36u;/);
  assert.match(source, /fn polygonVertex/);
  assert.match(source, /fn polygonFragment/);
  assert.match(source, /hiddenByImplicit/);
});

test("primitive layer builds a separate pipeline for each producer", () => {
  const previousUsage = globalThis.GPUBufferUsage;
  globalThis.GPUBufferUsage = {
    UNIFORM: 1,
    COPY_DST: 2,
  };

  try {
    const fake = fakeDevice();
    const resources = {
      counts: {
        splats: 3,
        thinLines: 2,
        thickLines: 2,
        sdfSplats: 2,
        polygonVertices: 6,
      },
      splats: {},
      thinLines: {},
      thickLines: {},
      sdfSplats: {},
      polygons: {},
    };
    const source = {
      resources() {
        return resources;
      },
    };

    const pass = new PrimitiveLayerPass({
      device: fake.device,
      format: "bgra8unorm",
      gbuffer: {
        version: 1,
        views: { depth: {} },
      },
      camera: {
        snapshot() {
          return {
            position: [0, 0, -2],
            forward: [0, 0, 1],
            right: [1, 0, 0],
            up: [0, 1, 0],
            near: 0.01,
            far: 40,
            fovY: Math.PI / 3,
          };
        },
      },
      source,
      shaderCode: "shader",
    });

    assert.equal(
      fake.calls.filter(([kind]) => kind === "pipeline").length,
      5
    );
    assert.equal(pass.kernelProviders().length, 5);

    pass.syncBindGroups();
    const groups = fake.calls.filter(([kind]) => kind === "bind-group");
    assert.equal(groups.length, 5);
    assert.deepEqual(
      groups.map(([, descriptor]) =>
        descriptor.entries.map((entry) => entry.binding)
      ),
      [
        [0, 1, 6],
        [0, 2, 6],
        [0, 3, 6],
        [0, 4, 6],
        [0, 5, 6],
      ]
    );

    assert.equal(pass.producer("primitive.splats").enabled, true);
    pass.setEnabled("primitive.splats", false);
    assert.equal(pass.producer("primitive.splats").enabled, false);
    assert.equal(
      pass.producer("primitive.splats").kernelInfo().active,
      false
    );

    assert.throws(
      () => pass.setEnabled("primitive.unknown", true),
      /Unknown primitive producer/
    );
  } finally {
    globalThis.GPUBufferUsage = previousUsage;
  }
});

test("primitive config defaults enable every producer", async () => {
  const {
    LAPINET_CONFIG_SCHEMA,
  } = await import("../src/config/config-schema.js");

  const values = Object.fromEntries(
    LAPINET_CONFIG_SCHEMA.map((field) => [field.path, field.default])
  );

  assert.equal(values["render.primitives.splats"], true);
  assert.equal(values["render.primitives.lines"], true);
  assert.equal(values["render.primitives.thickLines"], true);
  assert.equal(values["render.primitives.sdfSplats"], true);
  assert.equal(values["render.primitives.polygons"], true);
});
