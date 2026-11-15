import {
  GPUR4ScanCurveSpectrum,
} from "../src/gpu/scs/gpu-r4-scs.js";
import {
  createScsFixtureData,
} from "../src/systems/scs/fixture-particles.js";

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

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) * 0.5;
}

async function timeFrame(device, scs, records, stableIDs, count) {
  const encoder = device.createCommandEncoder({
    label: "Lapinet SCS benchmark frame",
  });
  scs.encode(encoder, {
    records,
    stableIDs,
    count,
    cellShift: 16,
    neighborRadius: 1,
    prefixBits: [20, 40, 60, 80],
  });
  const start = performance.now();
  device.queue.submit([encoder.finish()]);
  await device.queue.onSubmittedWorkDone();
  return performance.now() - start;
}

const counts = Deno.args.length
  ? Deno.args.map(Number)
  : [4096, 16384, 65536, 262144];
for (const count of counts) {
  if (!Number.isInteger(count) || count < 1) {
    throw new Error("Counts must be positive integers");
  }
}

if (!navigator.gpu) throw new Error("Deno WebGPU unavailable");
const adapter = await navigator.gpu.requestAdapter({
  powerPreference: "high-performance",
});
if (!adapter) throw new Error("No WebGPU adapter");

console.log("adapter limits", JSON.stringify({
  maxBufferSize: adapter.limits.maxBufferSize,
  maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
  maxStorageBuffersPerShaderStage:
    adapter.limits.maxStorageBuffersPerShaderStage,
}));

const device = await adapter.requestDevice();
const scs = await GPUR4ScanCurveSpectrum.create(device, {
  fetchImpl: fileFetch,
  maxHierarchyLevels: 4,
});

for (const count of counts) {
  const fixtureStart = performance.now();
  const fixture = createScsFixtureData(count);
  const fixtureMs = performance.now() - fixtureStart;
  const usage = GPUBufferUsage;

  const records = device.createBuffer({
    size: fixture.records.byteLength,
    usage: usage.STORAGE | usage.COPY_DST | usage.COPY_SRC,
  });
  const stableIDs = device.createBuffer({
    size: fixture.stableIds.byteLength,
    usage: usage.STORAGE | usage.COPY_DST | usage.COPY_SRC,
  });

  const uploadStart = performance.now();
  device.queue.writeBuffer(records, 0, fixture.records);
  device.queue.writeBuffer(stableIDs, 0, fixture.stableIds);
  await device.queue.onSubmittedWorkDone();
  const uploadMs = performance.now() - uploadStart;

  const prepareStart = performance.now();
  scs.prepare(count, { prefixBits: [20, 40, 60, 80] });
  const prepareMs = performance.now() - prepareStart;

  const firstMs = await timeFrame(
    device, scs, records, stableIDs, count
  );
  const samples = [];
  for (let i = 0; i < 3; i++) {
    samples.push(await timeFrame(
      device, scs, records, stableIDs, count
    ));
  }

  const totalBufferBytes = [
    ...scs.index.buffers,
    ...scs.index.sorter.buffers,
    ...scs.index.scan.scratch.flatMap(level => [
      level.sums,
      level.output,
      ...(level.scanUniforms ?? []),
      ...(level.offsetUniforms ?? []),
    ].filter(Boolean)),
    ...scs.index.ranges.buffers,
    ...scs.neighbors.buffers,
    scs.neighbors.coarseLookup,
    scs.neighbors.coarseConfig,
    scs.neighbors.neighborConfig,
    ...scs.hierarchy.levels.flatMap(level =>
      Object.values(level)
    ),
    records,
    stableIDs,
  ].filter(Boolean).reduce(
    (sum, buffer) => sum + Number(buffer.size ?? 0),
    0
  );

  console.log("SCS_BENCH", JSON.stringify({
    count,
    fixtureMs,
    uploadMs,
    prepareMs,
    firstMs,
    steadyMs: samples,
    medianMs: median(samples),
    updatesPerSecond: 1000 / median(samples),
    bufferMiB: totalBufferBytes / (1024 * 1024),
  }));

  records.destroy();
  stableIDs.destroy();
}

scs.destroy();
device.destroy();
