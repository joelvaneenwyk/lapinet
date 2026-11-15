import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  PointerState,
  bindPointerSurface,
} from "../src/input/pointer-state.js";
import {
  GpuCursorPass,
} from "../src/render/cursor/cursor-pass.js";

class FakeClassList {
  constructor() {
    this.values = new Set();
  }

  toggle(name, force) {
    if (force) this.values.add(name);
    else this.values.delete(name);
    return !!force;
  }

  remove(name) {
    this.values.delete(name);
  }

  contains(name) {
    return this.values.has(name);
  }
}

class FakeSurface {
  constructor() {
    this.ownerDocument = { pointerLockElement: null };
    this.classList = new FakeClassList();
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  removeEventListener(type, listener) {
    if (this.listeners.get(type) === listener) {
      this.listeners.delete(type);
    }
  }

  dispatch(type, event = {}) {
    this.listeners.get(type)?.(event);
  }

  getBoundingClientRect() {
    return {
      left: 10,
      top: 20,
      width: 200,
      height: 100,
    };
  }
}

function fakeCursorDevice() {
  const writes = [];
  const calls = [];
  const buffer = {
    destroy() {
      calls.push("destroy-buffer");
    },
  };
  const pipeline = {
    getBindGroupLayout(index) {
      calls.push(["bind-group-layout", index]);
      return { index };
    },
  };

  return {
    writes,
    calls,
    device: {
      queue: {
        writeBuffer(target, offset, data) {
          writes.push({
            target,
            offset,
            values: [...data],
          });
        },
      },
      createBuffer(descriptor) {
        calls.push(["buffer", descriptor]);
        return buffer;
      },
      createShaderModule(descriptor) {
        calls.push(["shader", descriptor]);
        return { descriptor };
      },
      createRenderPipeline(descriptor) {
        calls.push(["pipeline", descriptor]);
        return pipeline;
      },
      createBindGroup(descriptor) {
        calls.push(["bind-group", descriptor]);
        return { descriptor };
      },
    },
  };
}

test("pointer state is rendering-independent and exposes screen + NDC", () => {
  const pointer = new PointerState();

  const snapshot = pointer.set({
    x: 0.25,
    y: 0.75,
    active: true,
  });

  assert.deepEqual(snapshot.screen, [0.25, 0.75]);
  assert.deepEqual(snapshot.ndc, [-0.5, -0.5]);
  assert.equal(snapshot.active, true);
});

test("GPU cursor exclusively owns native cursor only while active", () => {
  const surface = new FakeSurface();
  const pointer = new PointerState();
  let enabled = true;

  const binding = bindPointerSurface(
    surface,
    pointer,
    {
      isGpuCursorEnabled: () => enabled,
    }
  );

  surface.dispatch("pointerenter", {
    clientX: 110,
    clientY: 70,
  });

  assert.deepEqual(pointer.snapshot().screen, [0.5, 0.5]);
  assert.equal(pointer.snapshot().active, true);
  assert.equal(
    surface.classList.contains("lapinet-gpu-cursor-active"),
    true
  );

  enabled = false;
  binding.refreshCursorOwnership();
  assert.equal(
    surface.classList.contains("lapinet-gpu-cursor-active"),
    false
  );

  enabled = true;
  surface.dispatch("pointerleave");
  assert.equal(pointer.snapshot().active, false);
  assert.equal(
    surface.classList.contains("lapinet-gpu-cursor-active"),
    false
  );

  binding.destroy();
});

test("cursor shader preserves the proven thin procedural reticule", () => {
  const wgsl = readFileSync(
    new URL("../src/render/cursor/cursor.wgsl", import.meta.url),
    "utf8"
  );

  assert.match(wgsl, /let outer = 8\.0 \* scale;/);
  assert.match(wgsl, /let gap = 2\.25 \* scale;/);
  assert.match(wgsl, /let thickness = 0\.75;/);
  assert.doesNotMatch(wgsl, /texture_/);
  assert.doesNotMatch(wgsl, /@location\(0\).*uv/);
});

test("GpuCursorPass is a fullscreen procedural overlay with tiny uniforms", () => {
  const previousUsage = globalThis.GPUBufferUsage;
  globalThis.GPUBufferUsage = {
    UNIFORM: 1,
    COPY_DST: 2,
  };

  try {
    const wgsl = readFileSync(
      new URL("../src/render/cursor/cursor.wgsl", import.meta.url),
      "utf8"
    );
    const fake = fakeCursorDevice();
    const cursor = new GpuCursorPass({
      device: fake.device,
      format: "bgra8unorm",
      shaderCode: wgsl,
    });

    cursor.update({
      pointer: [0.25, 0.75],
      active: true,
      enabled: true,
      size: 1.5,
      opacity: 0.6,
      color: "#804020",
      viewport: [1600, 900],
    });

    assert.equal(fake.writes.length, 1);
    const values = fake.writes[0].values;
    assert.deepEqual(values.slice(0, 5), [
      0.25, 0.75, 1, 1, 1.5,
    ]);
    assert.ok(Math.abs(values[5] - 0.6) < 1e-6);
    assert.deepEqual(values.slice(6, 8), [1600, 900]);
    assert.ok(Math.abs(values[8] - 128 / 255) < 1e-6);
    assert.ok(Math.abs(values[9] - 64 / 255) < 1e-6);
    assert.ok(Math.abs(values[10] - 32 / 255) < 1e-6);
    assert.equal(values[11], 1);

    const drawCalls = [];
    const encoder = {
      beginRenderPass(descriptor) {
        assert.equal(
          descriptor.colorAttachments[0].loadOp,
          "load"
        );
        return {
          setPipeline() {
            drawCalls.push("pipeline");
          },
          setBindGroup() {
            drawCalls.push("bind");
          },
          draw(count) {
            drawCalls.push(["draw", count]);
          },
          end() {
            drawCalls.push("end");
          },
        };
      },
    };

    cursor.encode(encoder, { view: {} });

    assert.deepEqual(drawCalls, [
      "pipeline",
      "bind",
      ["draw", 3],
      "end",
    ]);

    const pipelineDescriptor = fake.calls.find(
      ([kind]) => kind === "pipeline"
    )[1];
    assert.equal(
      pipelineDescriptor.fragment.targets[0].blend.color.srcFactor,
      "one"
    );
    assert.equal(
      pipelineDescriptor.fragment.targets[0].blend.color.dstFactor,
      "one-minus-src-alpha"
    );
  } finally {
    globalThis.GPUBufferUsage = previousUsage;
  }
});
