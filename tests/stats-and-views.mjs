import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { RateMeter, formatMs, formatRate } from "../src/diagnostics/rate-meter.js";
import { cycleOption, LAPINET_PAGES } from "../src/display/view-switcher.js";
import { bindControlHotkeys } from "../src/input/control-hotkeys.js";
import { ParticleDebugPass } from "../src/render/particles/particle-debug-pass.js";

test("rate meter reports counts per second once per window", () => {
  const meter = new RateMeter({ windowMs: 500 });
  assert.equal(meter.update(0, 1000), null);
  assert.equal(meter.update(10, 1200), null, "window not yet elapsed");
  assert.equal(meter.update(30, 1500), 60);
  assert.equal(meter.period, 1000 / 60);
  assert.equal(meter.update(45, 2000), 30);
});

test("rate meter measures reverse-running counters by magnitude", () => {
  const meter = new RateMeter({ windowMs: 1000 });
  meter.update(100, 0);
  assert.equal(meter.update(70, 1000), 30);
});

test("rate meter restarts when time goes backwards", () => {
  const meter = new RateMeter({ windowMs: 100 });
  meter.update(0, 500);
  assert.equal(meter.update(10, 600), 100);
  meter.update(0, 0);
  assert.equal(meter.update(5, 100), 50);
});

test("rate formatting shows a dash before the first reading", () => {
  assert.equal(formatRate(null), "—");
  assert.equal(formatRate(59.94), "59.9");
  assert.equal(formatMs(null), "—");
  assert.equal(formatMs(16.667), "16.7 ms");
});

test("cycleOption wraps both directions and recovers from unknown values", () => {
  const options = [["final", "Final"], ["all", "All"], ["depth", "Depth"]];
  assert.equal(cycleOption(options, "final", 1), "all");
  assert.equal(cycleOption(options, "depth", 1), "final");
  assert.equal(cycleOption(options, "final", -1), "depth");
  assert.equal(cycleOption(options, "missing", 1), "final");
  assert.equal(cycleOption(["a", "b"], "a"), "b");
});

test("view switcher links both published pages", () => {
  assert.deepEqual(
    LAPINET_PAGES.map((page) => page.href),
    ["./", "./springs.html"]
  );
  const springs = readFileSync(new URL("../springs.html", import.meta.url), "utf8");
  assert.match(springs, /href="\.\/"[^>]*>E8\/H4 lattice</);
  assert.match(springs, /aria-current="page"[^>]*>Springs &amp; boids</);
});

test("V/G/backquote cycle view, field and stats without modifier chords", () => {
  const listeners = new Set();
  const document = {
    addEventListener(type, listener) { listeners.add(listener); },
    removeEventListener(type, listener) { listeners.delete(listener); },
  };
  const calls = [];
  const binding = bindControlHotkeys({
    document,
    onCycleRenderView: (direction) => calls.push(["view", direction]),
    onCycleField: (direction) => calls.push(["field", direction]),
    onToggleStats: () => calls.push(["stats"]),
  });
  const press = (code, extra = {}) => {
    for (const listener of listeners) {
      listener({ code, target: { tagName: "CANVAS" }, preventDefault() {}, ...extra });
    }
  };

  press("KeyV");
  press("KeyV", { shiftKey: true });
  press("KeyG");
  press("Backquote");
  press("KeyV", { ctrlKey: true, shiftKey: true });
  press("KeyG", { target: { tagName: "SELECT" } });

  assert.deepEqual(calls, [["view", 1], ["view", -1], ["field", 1], ["stats"]]);
  binding.destroy();
  assert.equal(listeners.size, 0);
});

// Regression: both overlay pipelines use layout "auto", which drops unused
// bindings. Passing all five entries to both bind groups invalidated every
// frame's command buffer and the integrated page rendered solid black.
function entryPointBody(wgsl, name) {
  const start = wgsl.indexOf("fn " + name + "(");
  assert.ok(start >= 0, name + " exists");
  const next = wgsl.slice(start + 1).search(/\n@(vertex|fragment|compute)/);
  return next < 0 ? wgsl.slice(start) : wgsl.slice(start, start + 1 + next);
}

test("particle debug binding lists match what each WGSL entry point reads", () => {
  const wgsl = readFileSync(
    new URL("../src/render/particles/particle-debug-pass.wgsl", import.meta.url),
    "utf8"
  );
  const names = { 1: /\brecords\[/, 2: /\bspatialOrder\[/, 3: /\bhistory\[/ };
  const used = (body) =>
    Object.entries(names)
      .filter(([, pattern]) => pattern.test(body))
      .map(([binding]) => Number(binding));

  // globals (0) is read by both vertex stages; implicitDepth (4) by lineFragment.
  assert.deepEqual(
    [0, ...used(entryPointBody(wgsl, "trailVertex")), 4],
    [...ParticleDebugPass.TRAIL_BINDINGS]
  );
  assert.deepEqual(
    [0, ...used(entryPointBody(wgsl, "edgeVertex")), 4],
    [...ParticleDebugPass.EDGE_BINDINGS]
  );
});

test("particle debug pass passes each pipeline only its own bindings", () => {
  const previous = globalThis.GPUBufferUsage;
  globalThis.GPUBufferUsage = { UNIFORM: 64, COPY_DST: 8 };
  try {
    const groups = [];
    const pipeline = (label) => ({
      label,
      getBindGroupLayout: () => ({ pipeline: label }),
    });
    const device = {
      createBuffer: (descriptor) => ({ ...descriptor }),
      createShaderModule: () => ({}),
      createRenderPipeline: ({ label }) => pipeline(label),
      createBindGroup: (descriptor) => {
        groups.push(descriptor);
        return descriptor;
      },
    };
    const pass = new ParticleDebugPass({
      device,
      format: "bgra8unorm",
      gbuffer: { version: 1, views: { depth: { depth: true } } },
      camera: {},
      records: { records: true },
      spatialOrder: { order: true },
      trailHistory: { buffer: { history: true } },
      count: 16,
      shaderCode: "",
    });
    pass.syncBindGroups();

    const bindings = (label) =>
      groups.find((group) => group.label === label).entries.map((e) => e.binding);
    assert.deepEqual(bindings("Lapinet trail overlay bindings"), [0, 3, 4]);
    assert.deepEqual(bindings("Lapinet edge overlay bindings"), [0, 1, 2, 4]);
  } finally {
    globalThis.GPUBufferUsage = previous;
  }
});
