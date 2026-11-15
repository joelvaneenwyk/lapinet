import assert from "node:assert/strict";
import test from "node:test";

import {
  GpuContext,
} from "../src/gpu/gpu-context.js";
import {
  GpuResourceRegistry,
} from "../src/gpu/resource-registry.js";
import {
  GpuScheduler,
} from "../src/gpu/scheduler.js";

function fakeGpu() {
  const submissions = [];

  const device = {
    queue: {
      submit(buffers) {
        submissions.push(buffers);
      },
    },
    createCommandEncoder({ label }) {
      const encoder = {
        label,
        operations: [],
        finish() {
          return Object.freeze({
            label,
            operations: [...this.operations],
          });
        },
      };
      return encoder;
    },
  };

  return {
    context: GpuContext.fromDevice(device),
    submissions,
  };
}

test("GpuContext can exist without canvas or renderer", () => {
  const { context } = fakeGpu();

  assert.equal("canvas" in context, false);
  assert.equal("renderer" in context, false);
  assert.strictEqual(context.queue, context.device.queue);
});

test("GpuScheduler resolves resource producers and runs headless", async () => {
  const { context, submissions } = fakeGpu();
  const resources = new GpuResourceRegistry();
  const scheduler = new GpuScheduler({
    gpu: context,
    resources,
  });

  const fakePositions = { label: "positions" };
  const fakeBounds = { label: "bounds" };

  scheduler.register({
    id: "bounds",
    inputs: ["particles.position"],
    outputs: ["particles.bounds"],
    initialize({ resources }) {
      resources.publish("particles.bounds", {
        resource: fakeBounds,
        owner: "bounds",
      });
    },
    encode({ encoder, resources }) {
      assert.strictEqual(
        resources.resource("particles.position"),
        fakePositions
      );
      encoder.operations.push("bounds");
    },
  });

  scheduler.register({
    id: "particles",
    outputs: ["particles.position"],
    initialize({ resources }) {
      resources.publish("particles.position", {
        resource: fakePositions,
        owner: "particles",
      });
    },
    encode({ encoder }) {
      encoder.operations.push("particles");
    },
  });

  assert.deepEqual(
    scheduler.compile(),
    ["particles", "bounds"]
  );

  await scheduler.initialize();
  const result = scheduler.tick({ dt: 1 / 60 });

  assert.deepEqual(
    result.operations,
    ["particles", "bounds"]
  );
  assert.equal(submissions.length, 1);
  assert.equal(scheduler.frameIndex, 1);
});

test("GpuScheduler rejects ambiguous or missing resource contracts", () => {
  const { context } = fakeGpu();

  const duplicate = new GpuScheduler({ gpu: context });
  duplicate.register({
    id: "a",
    outputs: ["shared"],
    encode() {},
  });
  duplicate.register({
    id: "b",
    outputs: ["shared"],
    encode() {},
  });
  assert.throws(
    () => duplicate.compile(),
    /multiple producers/
  );

  const missing = new GpuScheduler({ gpu: context });
  missing.register({
    id: "consumer",
    inputs: ["not.published"],
    encode() {},
  });
  assert.throws(
    () => missing.compile(),
    /unresolved input/
  );
});

test("owned GPU resources are released with their system", async () => {
  const { context } = fakeGpu();
  const scheduler = new GpuScheduler({ gpu: context });
  let destroyed = 0;

  scheduler.register({
    id: "producer",
    outputs: ["owned"],
    initialize({ resources }) {
      resources.publish("owned", {
        resource: {
          destroy() {
            destroyed += 1;
          },
        },
        owner: "producer",
        owned: true,
      });
    },
    encode() {},
  });

  await scheduler.initialize();
  assert.equal(scheduler.resources.has("owned"), true);

  await scheduler.destroy();

  assert.equal(scheduler.resources.has("owned"), false);
  assert.equal(destroyed, 1);
});
