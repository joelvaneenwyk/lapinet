import {
  createScsFixtureData,
} from "../src/systems/scs/fixture-particles.js";
import {
  evolveE8Words,
} from "../src/systems/scheduled-transport/noether/icosian-e8.mjs";
import {
  GPUExactSiteScheduler,
} from "../src/systems/scheduled-transport/gpu-exact-site-scheduler.js";
import {
  GPUScheduledE8Stream,
} from "../src/systems/scheduled-transport/gpu-scheduled-e8-stream.js";

function fileFetch(url) {
  const value = url instanceof URL ? url : new URL(url);
  if (value.protocol === "file:") {
    return Promise.resolve({
      ok: true,
      status: 200,
      text: () => Deno.readTextFile(value),
    });
  }
  return fetch(value);
}

async function readBuffer(device, source, size) {
  const out = device.createBuffer({
    size,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const encoder = device.createCommandEncoder();
  encoder.copyBufferToBuffer(source, 0, out, 0, size);
  device.queue.submit([encoder.finish()]);
  await out.mapAsync(GPUMapMode.READ);
  const copy = new Uint32Array(out.getMappedRange().slice(0));
  out.unmap();
  out.destroy();
  return copy;
}

function assertEqualWords(actual, expected, label) {
  if (actual.length !== expected.length) {
    throw new Error(
      label + " length mismatch " +
      actual.length + " != " + expected.length
    );
  }
  for (let i = 0; i < actual.length; i += 1) {
    if (actual[i] !== expected[i]) {
      throw new Error(
        label + " mismatch at word " + i +
        ": " + actual[i] + " != " + expected[i]
      );
    }
  }
}

if (!navigator.gpu) {
  throw new Error("Deno WebGPU unavailable");
}
const adapter = await navigator.gpu.requestAdapter({
  powerPreference: "high-performance",
});
if (!adapter) throw new Error("No WebGPU adapter");
const device = await adapter.requestDevice();

const count = Number(Deno.args[0] ?? 4096);
const steps = Number(Deno.args[1] ?? 8);
const fixture = createScsFixtureData(count);
const initial = new Uint32Array(fixture.records);
const bytes = initial.byteLength;

const records = device.createBuffer({
  size: bytes,
  usage:
    GPUBufferUsage.STORAGE |
    GPUBufferUsage.COPY_DST |
    GPUBufferUsage.COPY_SRC,
});
const stableIDs = device.createBuffer({
  size: fixture.stableIds.byteLength,
  usage:
    GPUBufferUsage.STORAGE |
    GPUBufferUsage.COPY_DST |
    GPUBufferUsage.COPY_SRC,
});
const topology = device.createBuffer({
  size: 16,
  usage:
    GPUBufferUsage.STORAGE |
    GPUBufferUsage.COPY_DST |
    GPUBufferUsage.COPY_SRC,
});

device.queue.writeBuffer(records, 0, initial);
device.queue.writeBuffer(stableIDs, 0, fixture.stableIds);
device.queue.writeBuffer(
  topology, 0, new Uint32Array([0, 0, 0, 0])
);

const stream = await GPUScheduledE8Stream.create(device, {
  fetchImpl: fileFetch,
});
const scheduler = await GPUExactSiteScheduler.create(device, {
  fetchImpl: fileFetch,
});

for (let frame = 0; frame < steps; frame += 1) {
  const encoder = device.createCommandEncoder();
  stream.encode(encoder, {
    records,
    topology,
    count,
    frame,
    seed: 17,
    threshold: 3072,
    cellShift: 17,
  });
  device.queue.submit([encoder.finish()]);
  await device.queue.onSubmittedWorkDone();
}

const gpuStreamForward = await readBuffer(device, records, bytes);
const cpuStreamForward = evolveE8Words(initial, steps, {
  start: 0,
  seed: 17,
  threshold: 3072,
});
assertEqualWords(
  gpuStreamForward,
  cpuStreamForward,
  "GPU scheduled stream vs CPU oracle"
);

for (let frame = steps - 1; frame >= 0; frame -= 1) {
  const encoder = device.createCommandEncoder();
  stream.encode(encoder, {
    records,
    topology,
    count,
    frame,
    reverse: true,
    seed: 17,
    threshold: 3072,
    cellShift: 17,
  });
  device.queue.submit([encoder.finish()]);
  await device.queue.onSubmittedWorkDone();
}
assertEqualWords(
  await readBuffer(device, records, bytes),
  initial,
  "scheduled stream rewind"
);

device.queue.writeBuffer(records, 0, initial);

const forwardStart = performance.now();
for (let frame = 0; frame < steps; frame += 1) {
  const encoder = device.createCommandEncoder();
  scheduler.encode(encoder, {
    records,
    stableIDs,
    count,
    frame,
    applyCollisions: true,
  });
  stream.encode(encoder, {
    records,
    topology,
    count,
    frame,
    seed: 17,
    threshold: 3072,
    cellShift: 17,
  });
  device.queue.submit([encoder.finish()]);
  await device.queue.onSubmittedWorkDone();
}
const forwardMs = performance.now() - forwardStart;

const reverseStart = performance.now();
for (let frame = steps - 1; frame >= 0; frame -= 1) {
  const encoder = device.createCommandEncoder();
  stream.encode(encoder, {
    records,
    topology,
    count,
    frame,
    reverse: true,
    seed: 17,
    threshold: 3072,
    cellShift: 17,
  });
  scheduler.encode(encoder, {
    records,
    stableIDs,
    count,
    frame,
    applyCollisions: true,
  });
  device.queue.submit([encoder.finish()]);
  await device.queue.onSubmittedWorkDone();
}
const reverseMs = performance.now() - reverseStart;

assertEqualWords(
  await readBuffer(device, records, bytes),
  initial,
  "full scheduled transport rewind"
);

console.log("SCHEDULED_TRANSPORT_GPU_PASS", JSON.stringify({
  count,
  steps,
  streamCpuOracle: true,
  streamExactRewind: true,
  scatterStreamExactRewind: true,
  forwardMs,
  reverseMs,
  forwardFramesPerSecond: steps * 1000 / forwardMs,
  reverseFramesPerSecond: steps * 1000 / reverseMs,
}));

scheduler.destroy();
stream.destroy();
records.destroy();
stableIDs.destroy();
topology.destroy();
device.destroy();
