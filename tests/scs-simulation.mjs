import assert from "node:assert/strict";
import test from "node:test";

import {
  GpuContext,
} from "../src/gpu/gpu-context.js";
import {
  createScsFixtureData,
  SCS_PARTICLE_RECORDS,
  SCS_PARTICLE_STABLE_IDS,
  SCS_TOPOLOGY_DISPATCH,
  SCS_TOPOLOGY_STATE,
} from "../src/systems/scs/fixture-particles.js";
import {
  R4_SCS_RESOURCES,
  r4FrequencyResourceId,
} from "../src/systems/scs/r4-scs-system.js";
import {
  createScsSimulationRuntime,
} from "../src/systems/scs/simulation-runtime.js";
import {
  SCHEDULED_FLOCK_STATE,
  SCHEDULED_FLOCK_CENTROIDS,
} from "../src/systems/scheduled-transport/scheduled-flock.js";

function fakeGpu() {
  const writes = [];
  const submissions = [];
  const buffers = [];

  const device = {
    queue: {
      writeBuffer(buffer, offset, data) {
        writes.push({ buffer, offset, data });
      },
      submit(commandBuffers) {
        submissions.push(commandBuffers);
      },
      async onSubmittedWorkDone() {},
    },

    createBuffer(descriptor) {
      const buffer = {
        ...descriptor,
        descriptor,
        destroyed: false,
        destroy() {
          this.destroyed = true;
        },
      };
      buffers.push(buffer);
      return buffer;
    },

    createCommandEncoder({ label } = {}) {
      return {
        label,
        copyBufferToBuffer(source, sourceOffset, destination, destinationOffset, size) {
          // Mock history-copy encoding only; no GPU execution required.
          writes.push({ copy: { source, sourceOffset, destination, destinationOffset, size } });
        },
        finish() {
          return { label };
        },
      };
    },
  };

  return {
    context: GpuContext.fromDevice(device),
    writes,
    submissions,
    buffers,
  };
}

function fakeScsEngine() {
  const state = {
    encodeCalls: 0,
    destroyed: false,
  };

  const buffer = (label) => ({ label });

  return {
    state,

    prepare(count, { prefixBits }) {
      return {
        count,
        spatialKeys: buffer("spatial-keys"),
        spatialOrder: buffer("spatial-order"),
        quantizedCells: buffer("quantized-cells"),
        occupiedCellStarts: buffer("cell-starts"),
        occupiedCellMetadata: buffer("cell-metadata"),
        localMoments: buffer("local-moments"),
        coarseLookup: buffer("coarse-lookup"),
        neighborConfig: buffer("neighbor-config"),
        frequencyLevels: prefixBits.map((bits) => ({
          prefixBits: bits,
          moments: buffer("moments-" + bits),
          particleNodeIDs: buffer("node-ids-" + bits),
        })),
      };
    },

    encode(_encoder, options) {
      state.encodeCalls += 1;
      state.lastOptions = options;
      return {
        count: options.count,
        gpuResident: true,
      };
    },

    destroy() {
      state.destroyed = true;
    },
  };
}

function fakeTransportFactory(calls) {
  return () => {
    const params = {};
    const definition = {
      id: "simulation.scheduled-transport",
      inputs: [
        SCS_PARTICLE_RECORDS,
        SCS_PARTICLE_STABLE_IDS,
        SCS_TOPOLOGY_STATE,
        SCHEDULED_FLOCK_STATE,
      ],
      outputs: [],
      after: ["simulation.scheduled-flock-reverse"],
      enabled(frame) {
        return frame.positionsChanged !== false;
      },
      initialize() {},
      encode({ frame }) {
        calls.transport.push({
          transportFrame: frame.transportFrame,
          reverse: !!frame.reverse,
        });
      },
      destroy() {},
    };

    return {
      definition,
      diagnostics: {
        kernelInfo() {
          return {
            id: definition.id,
            active: true,
            detail: "fake scheduled transport",
          };
        },
      },
      setParameters(next) {
        Object.assign(params, next);
        return { ...params };
      },
    };
  };
}

function fakeFlockFactory(calls) {
  return ({ count = 64 } = {}) => {
    let flockBuffer = null;
    let centroidBuffer = null;
    const params = {
      enabled: false,
      alignment: 12,
      coupling: 6,
      baseWeight: 8,
    };

    const stateSystem = {
      id: "simulation.scheduled-flock-state",
      outputs: [
        SCHEDULED_FLOCK_STATE,
        SCHEDULED_FLOCK_CENTROIDS,
      ],
      enabled: false,
      initialize({ gpu, resources, system }) {
        flockBuffer = gpu.device.createBuffer({
          label: "fake flock state",
          size: Math.max(32, count * 32),
          usage: 1 | 2 | 4,
        });
        resources.publish(SCHEDULED_FLOCK_STATE, {
          resource: flockBuffer,
          owner: system.id,
          owned: true,
          metadata: { count, stride: 32 },
        });
        centroidBuffer = gpu.device.createBuffer({
          label: "fake flock centroids",
          size: Math.max(16, Math.ceil(count / 64) * 16),
          usage: 1 | 2 | 4,
        });
        resources.publish(SCHEDULED_FLOCK_CENTROIDS, {
          resource: centroidBuffer,
          owner: system.id,
          owned: true,
          metadata: {
            count: Math.ceil(count / 64),
            stride: 16,
            blockSize: 64,
          },
        });
      },
      encode() {},
    };

    const centroids = {
      id: "simulation.scheduled-flock-centroids",
      inputs: [
        SCHEDULED_FLOCK_STATE,
        SCHEDULED_FLOCK_CENTROIDS,
      ],
      after: ["simulation.r4-scs"],
      outputs: [],
      enabled(frame) {
        return (
          frame.forceSCS === true ||
          frame.positionsChanged !== false
        );
      },
      initialize() {},
      encode() {},
    };

    const reverse = {
      id: "simulation.scheduled-flock-reverse",
      inputs: [SCHEDULED_FLOCK_STATE],
      after: ["simulation.scheduled-flock-state"],
      outputs: [],
      enabled(frame) {
        return params.enabled &&
          frame.positionsChanged !== false &&
          !!frame.reverse;
      },
      initialize() {},
      encode() {
        calls.flockReverse += 1;
      },
    };

    const forward = {
      id: "simulation.scheduled-flock-forward",
      inputs: [SCHEDULED_FLOCK_STATE],
      after: ["simulation.scheduled-flock-centroids"],
      outputs: [],
      enabled(frame) {
        return params.enabled &&
          frame.positionsChanged !== false &&
          !frame.reverse;
      },
      initialize() {},
      encode() {
        calls.flockForward += 1;
      },
    };

    return {
      stateSystem,
      centroids,
      reverse,
      forward,
      diagnostics: {
        kernelInfo() {
          return {
            id: "simulation.scheduled-flock",
            active: params.enabled,
            detail: "fake flock",
          };
        },
      },
      parameters() {
        return { ...params };
      },
      setParameters(next) {
        Object.assign(params, next);
        return { ...params };
      },
      reset(queue) {
        queue.writeBuffer(
          flockBuffer,
          0,
          new Int32Array(count * 8)
        );
        return true;
      },
    };
  };
}

function fakeTopologyFactory(calls) {
  return () => ({
    gate: {
      id: "simulation.topology-gate",
      inputs: [
        SCS_TOPOLOGY_STATE,
        SCS_TOPOLOGY_DISPATCH,
      ],
      outputs: [],
      after: ["simulation.scheduled-transport"],
      enabled(frame) {
        return (
          frame.forceSCS === true ||
          frame.positionsChanged !== false
        );
      },
      initialize() {},
      encode() {
        calls.gate += 1;
      },
      destroy() {},
    },

    clear: {
      id: "simulation.topology-clear",
      inputs: [
        SCS_TOPOLOGY_STATE,
        SCS_TOPOLOGY_DISPATCH,
      ],
      outputs: [],
      after: ["simulation.r4-scs"],
      enabled(frame) {
        return (
          frame.forceSCS === true ||
          frame.positionsChanged !== false
        );
      },
      initialize() {},
      encode() {
        calls.clear += 1;
      },
      destroy() {},
    },

    diagnostics: {
      kernelInfo() {
        return {
          id: "simulation.topology-gate",
          active: true,
          detail: "fake topology gate",
        };
      },
    },
  });
}

test("SCS fixture generation is deterministic and identity-bearing", () => {
  const first = createScsFixtureData(32);
  const second = createScsFixtureData(32);

  assert.deepEqual(first.records, second.records);
  assert.deepEqual(first.stableIds, second.stableIds);
  assert.equal(first.records.length, 32 * 4);
  assert.equal(new Set(first.stableIds).size, 32);
});

test("scheduled simulation advances and rewinds integer transport frames", async () => {
  const previousUsage = globalThis.GPUBufferUsage;
  globalThis.GPUBufferUsage = {
    STORAGE: 1,
    COPY_DST: 2,
    COPY_SRC: 4,
    INDIRECT: 8,
  };

  try {
    const fake = fakeGpu();
    const engine = fakeScsEngine();
    const calls = {
      transport: [],
      gate: 0,
      clear: 0,
      flockForward: 0,
      flockReverse: 0,
    };

    const runtime = await createScsSimulationRuntime({
      gpu: fake.context,
      count: 64,
      engineFactory: async () => engine,
      transportFactory: fakeTransportFactory(calls),
      flockFactory: fakeFlockFactory(calls),
      topologyFactory: fakeTopologyFactory(calls),
      setTimer() {
        throw new Error(
          "timer should not start during headless test"
        );
      },
    });

    assert.equal(runtime.transportFrame, 0);
    assert.equal(runtime.direction, "forward");

    for (const id of [
      SCS_PARTICLE_RECORDS,
      SCS_PARTICLE_STABLE_IDS,
      SCS_TOPOLOGY_STATE,
      SCS_TOPOLOGY_DISPATCH,
      ...Object.values(R4_SCS_RESOURCES),
      r4FrequencyResourceId(20, "moments"),
      r4FrequencyResourceId(80, "particleNodeIds"),
    ]) {
      assert.equal(runtime.resources.has(id), true, id);
    }

    runtime.stepForward();
    runtime.stepForward();

    assert.equal(runtime.transportFrame, 2);
    assert.deepEqual(calls.transport, [
      { transportFrame: 0, reverse: false },
      { transportFrame: 1, reverse: false },
    ]);
    assert.equal(engine.state.encodeCalls, 3);
    assert.equal(calls.gate, 3);
    assert.equal(calls.clear, 3);

    runtime.stepReverse();
    assert.equal(runtime.transportFrame, 1);
    assert.deepEqual(calls.transport.at(-1), {
      transportFrame: 1,
      reverse: true,
    });

    runtime.stepReverse();
    assert.equal(runtime.transportFrame, 0);
    assert.deepEqual(calls.transport.at(-1), {
      transportFrame: 0,
      reverse: true,
    });

    const submissionsBeforeZeroReverse =
      fake.submissions.length;
    assert.equal(runtime.stepReverse(), null);
    assert.equal(
      fake.submissions.length,
      submissionsBeforeZeroReverse
    );

    runtime.setDirection("reverse");
    assert.equal(runtime.direction, "reverse");
    runtime.setDirection("forward");
    assert.equal(runtime.direction, "forward");

    assert.equal(runtime.setPlaybackHz(48), 48);
    assert.equal(runtime.playbackHz, 48);

    const writesBeforeReset = fake.writes.length;
    runtime.reset();

    assert.equal(runtime.transportFrame, 0);
    assert.equal(runtime.scheduler.frameIndex, 1);
    assert.equal(engine.state.encodeCalls, 6);
    // Reset includes five queue writes and one encoded trail-history copy.
    assert.equal(
      fake.writes.length,
      writesBeforeReset + 6
    );

    await runtime.destroy();
    assert.equal(engine.state.destroyed, true);
    assert.equal(runtime.resources.list().length, 0);
  } finally {
    globalThis.GPUBufferUsage = previousUsage;
  }
});

test("playback cadence subtracts GPU work but never enters simulation state", async () => {
  const previousUsage = globalThis.GPUBufferUsage;
  globalThis.GPUBufferUsage = {
    STORAGE: 1,
    COPY_DST: 2,
    COPY_SRC: 4,
    INDIRECT: 8,
  };

  try {
    const fake = fakeGpu();
    const engine = fakeScsEngine();
    const calls = {
      transport: [],
      gate: 0,
      clear: 0,
      flockForward: 0,
      flockReverse: 0,
    };
    let clock = 0;
    const timers = [];

    fake.context.queue.onSubmittedWorkDone = async () => {
      clock += 20;
    };

    const runtime = await createScsSimulationRuntime({
      gpu: fake.context,
      count: 64,
      playbackHz: 30,
      engineFactory: async () => engine,
      transportFactory: fakeTransportFactory(calls),
      flockFactory: fakeFlockFactory(calls),
      topologyFactory: fakeTopologyFactory(calls),
      now: () => clock,
      setTimer(callback, delay) {
        timers.push({ callback, delay });
        return timers.length;
      },
      clearTimer() {},
    });

    runtime.start();
    assert.equal(timers.length, 1);
    assert.ok(
      Math.abs(timers[0].delay - (1000 / 30)) < 1e-6
    );

    const first = timers.shift();
    clock += first.delay;
    await first.callback();

    assert.equal(runtime.transportFrame, 1);
    assert.deepEqual(calls.transport[0], {
      transportFrame: 0,
      reverse: false,
    });

    assert.equal(timers.length, 1);
    assert.ok(
      Math.abs(
        timers[0].delay - ((1000 / 30) - 20)
      ) < 1e-6
    );

    runtime.setPlaybackHz(60);
    assert.equal(runtime.playbackHz, 60);

    runtime.stop();
    await runtime.destroy();
  } finally {
    globalThis.GPUBufferUsage = previousUsage;
  }
});
