import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  DiagnosticsRegistry,
} from "../src/diagnostics/diagnostics-registry.js";
import {
  RENDER_TARGET_OPTIONS,
} from "../src/diagnostics/render-target-diagnostics-ui.js";
import {
  RenderTargetDebugPass,
  TARGET_CODES,
} from "../src/render/diagnostics/render-target-debug-pass.js";

test("diagnostics registry enumerates self-describing kernels", () => {
  const registry = new DiagnosticsRegistry();
  let active = true;

  const provider = {
    kernelInfo() {
      return {
        id: "example.compute",
        label: "Example compute",
        kind: "compute",
        stage: "compute",
        active,
        detail: "8x8",
      };
    },
  };

  let notifications = 0;
  registry.subscribe(() => {
    notifications += 1;
  });

  registry.registerKernelProvider(provider);
  assert.equal(notifications, 1);
  assert.deepEqual(registry.kernels(), [{
    id: "example.compute",
    label: "Example compute",
    kind: "compute",
    stage: "compute",
    active: true,
    detail: "8x8",
  }]);

  active = false;
  registry.notify();
  assert.equal(registry.kernels()[0].active, false);
  assert.equal(notifications, 2);

  assert.equal(registry.unregisterKernel("example.compute"), true);
  assert.equal(registry.kernels().length, 0);
});

test("render target diagnostics expose final, grid, and every G-buffer target", () => {
  assert.deepEqual(
    RENDER_TARGET_OPTIONS.map(([value]) => value),
    [
      "final",
      "all",
      "albedo",
      "normal",
      "material",
      "depth",
      "position",
      "effort",
      "roughness",
      "ior",
    ]
  );
  assert.deepEqual(TARGET_CODES, {
    final: 0,
    albedo: 1,
    normal: 2,
    material: 3,
    depth: 4,
    all: 5,
    position: 6,
    effort: 7,
    roughness: 8,
    ior: 9,
  });
});

test("render target shader visualizes all four G-buffer attachments", () => {
  const source = readFileSync(
    new URL(
      "../src/render/diagnostics/render-target-debug.wgsl",
      import.meta.url
    ),
    "utf8"
  );

  assert.match(source, /gAlbedo/);
  assert.match(source, /gNormal/);
  assert.match(source, /gMaterial/);
  assert.match(source, /gDepth/);
  assert.match(source, /code == 5u/);
  assert.match(source, /code == 6u/);
  assert.match(source, /code == 7u/);
  assert.match(source, /code == 8u/);
  assert.match(source, /code == 9u/);
  assert.match(source, /cameraRay/);
  assert.match(source, /effortGradient/);
  assert.match(source, /quadrant/);
});

test("render target debug pass is dormant on final output", () => {
  const previousUsage = globalThis.GPUBufferUsage;
  globalThis.GPUBufferUsage = {
    UNIFORM: 1,
    COPY_DST: 2,
  };

  try {
    const calls = [];
    const pipeline = {
      getBindGroupLayout() {
        return {};
      },
    };
    const device = {
      queue: {
        writeBuffer() {
          calls.push("write");
        },
      },
      createBuffer() {
        return { destroy() {} };
      },
      createShaderModule() {
        return {};
      },
      createRenderPipeline() {
        return pipeline;
      },
      createBindGroup() {
        calls.push("bind-group");
        return {};
      },
    };
    const pass = new RenderTargetDebugPass({
      device,
      format: "bgra8unorm",
      gbuffer: {
        version: 1,
        views: {
          albedo: {},
          normal: {},
          material: {},
          depth: {},
        },
      },
      camera: {
        snapshot() {
          return { far: 40 };
        },
      },
      shaderCode: "shader",
    });

    assert.equal(pass.kernelInfo().active, false);
    pass.encode({
      beginRenderPass() {
        throw new Error("final output must not open debug render pass");
      },
    }, {
      view: {},
      size: [100, 100],
    });

    pass.setTarget("normal");
    assert.equal(pass.kernelInfo().active, true);
    assert.match(pass.kernelInfo().detail, /normal/);
    assert.throws(
      () => pass.setTarget("unknown"),
      /Unknown render target diagnostic/
    );
    assert.deepEqual(calls, []);
  } finally {
    globalThis.GPUBufferUsage = previousUsage;
  }
});
