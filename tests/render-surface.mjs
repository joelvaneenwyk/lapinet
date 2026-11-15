import assert from "node:assert/strict";
import test from "node:test";

import {
  GpuContext,
} from "../src/gpu/gpu-context.js";
import {
  RenderSurface,
  bindRenderFocusPause,
} from "../src/render/render-surface.js";

test("RenderSurface is an optional GPU consumer with composable passes", () => {
  const events = [];
  const context = {
    configure(descriptor) {
      events.push(["configure", descriptor.format]);
    },
    getCurrentTexture() {
      return {
        createView() {
          return { id: "view" };
        },
      };
    },
  };
  const canvas = {
    width: 0,
    height: 0,
    getContext(kind) {
      assert.equal(kind, "webgpu");
      return context;
    },
    getBoundingClientRect() {
      return { width: 320, height: 180 };
    },
  };

  const device = {
    queue: {
      submit(buffers) {
        events.push(["submit", buffers.length]);
      },
    },
    createCommandEncoder() {
      return {
        beginRenderPass(descriptor) {
          events.push([
            "render-pass",
            descriptor.colorAttachments[0].loadOp,
          ]);
          return {
            end() {
              events.push("clear-end");
            },
          };
        },
        finish() {
          return { id: "commands" };
        },
      };
    },
  };

  const gpu = GpuContext.fromDevice(device);
  const surface = RenderSurface.create({
    gpu,
    canvas,
    format: "bgra8unorm",
  });

  let encoded = 0;
  surface.addPass({
    encode(_encoder, frame) {
      encoded += 1;
      assert.deepEqual(frame.size, [320, 180]);
      assert.equal(frame.format, "bgra8unorm");
    },
  });

  const previousRatio = globalThis.devicePixelRatio;
  globalThis.devicePixelRatio = 1;
  try {
    surface.running = true;
    surface.frame();
    surface.running = false;
  } finally {
    globalThis.devicePixelRatio = previousRatio;
  }

  assert.equal(encoded, 1);
  assert.equal(canvas.width, 320);
  assert.equal(canvas.height, 180);
  assert.deepEqual(events[0], ["configure", "bgra8unorm"]);
  assert.ok(events.some(
    (event) =>
      Array.isArray(event) &&
      event[0] === "render-pass" &&
      event[1] === "clear"
  ));
  assert.ok(events.some(
    (event) =>
      Array.isArray(event) &&
      event[0] === "submit"
  ));
});


class FakeEventTarget {
  constructor() {
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, []);
    }
    this.listeners.get(type).push(listener);
  }

  removeEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    const index = listeners.indexOf(listener);
    if (index >= 0) listeners.splice(index, 1);
  }

  dispatch(type) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener();
    }
  }
}

function makePauseSurface() {
  const context = {
    configure() {},
    getCurrentTexture() {
      return {
        createView() {
          return {};
        },
      };
    },
  };
  const canvas = {
    width: 100,
    height: 100,
    getContext() {
      return context;
    },
    getBoundingClientRect() {
      return { width: 100, height: 100 };
    },
  };
  const device = {
    queue: {
      submit() {},
    },
    createCommandEncoder() {
      return {
        beginRenderPass() {
          return { end() {} };
        },
        finish() {
          return {};
        },
      };
    },
  };
  return RenderSurface.create({
    gpu: GpuContext.fromDevice(device),
    canvas,
    format: "bgra8unorm",
  });
}

test("manual render pause survives focus pause and focus resume", () => {
  const previousRaf = globalThis.requestAnimationFrame;
  const previousCancel = globalThis.cancelAnimationFrame;
  let nextId = 1;
  const cancelled = [];

  globalThis.requestAnimationFrame = () => nextId++;
  globalThis.cancelAnimationFrame = (id) => cancelled.push(id);

  try {
    const surface = makePauseSurface();

    surface.start();
    assert.equal(surface.running, true);
    assert.equal(surface.state().paused, false);

    surface.setPaused(true);
    assert.equal(surface.running, false);
    assert.equal(surface.state().manualPaused, true);

    surface.setFocusPaused(true);
    surface.setFocusPaused(false);
    assert.equal(surface.running, false);
    assert.equal(surface.state().manualPaused, true);
    assert.equal(surface.state().focusPaused, false);

    surface.setPaused(false);
    assert.equal(surface.running, true);
    assert.equal(surface.state().paused, false);
    assert.ok(cancelled.length >= 1);

    surface.stop();
  } finally {
    globalThis.requestAnimationFrame = previousRaf;
    globalThis.cancelAnimationFrame = previousCancel;
  }
});

test("a focus-paused surface still renders one initial static frame", () => {
  const previousRaf = globalThis.requestAnimationFrame;
  const previousCancel = globalThis.cancelAnimationFrame;

  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};

  try {
    const surface = makePauseSurface();
    surface.setFocusPaused(true);

    surface.start();

    assert.equal(surface.running, false);
    assert.equal(surface.frameIndex, 1);
    assert.equal(surface.state().focusPaused, true);
  } finally {
    globalThis.requestAnimationFrame = previousRaf;
    globalThis.cancelAnimationFrame = previousCancel;
  }
});

test("focus binding pauses while window is blurred or document is hidden", () => {
  const document = new FakeEventTarget();
  const window = new FakeEventTarget();
  document.hidden = false;
  document.focused = true;
  document.hasFocus = () => document.focused;

  const states = [];
  const surface = {
    setFocusPaused(paused) {
      states.push(!!paused);
    },
  };

  const binding = bindRenderFocusPause(surface, {
    document,
    window,
  });

  assert.equal(states.at(-1), false);

  window.dispatch("blur");
  assert.equal(states.at(-1), true);

  window.dispatch("focus");
  assert.equal(states.at(-1), false);

  document.hidden = true;
  document.dispatch("visibilitychange");
  assert.equal(states.at(-1), true);

  document.hidden = false;
  document.focused = false;
  document.dispatch("visibilitychange");
  assert.equal(states.at(-1), true);

  document.focused = true;
  window.dispatch("focus");
  assert.equal(states.at(-1), false);

  binding.destroy();
});
