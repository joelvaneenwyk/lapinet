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

async function main() {
  if (!navigator.gpu) {
    throw new Error("Deno WebGPU is unavailable");
  }

  const adapter = await navigator.gpu.requestAdapter({
    powerPreference: "high-performance",
  });
  if (!adapter) {
    throw new Error("No headless WebGPU adapter");
  }

  console.log(
    "adapter maxStorageBuffersPerShaderStage",
    adapter.limits.maxStorageBuffersPerShaderStage
  );

  const device = await adapter.requestDevice();
  const uncaptured = [];
  device.addEventListener?.("uncapturederror", (event) => {
    uncaptured.push(event.error);
    console.error("uncaptured WebGPU error", event.error?.message ?? event.error);
  });

  const count = 4096;
  const fixture = createScsFixtureData(count);
  const usage = GPUBufferUsage;

  const records = device.createBuffer({
    label: "SCS hardware validation records",
    size: fixture.records.byteLength,
    usage: usage.STORAGE | usage.COPY_DST | usage.COPY_SRC,
  });
  const stableIDs = device.createBuffer({
    label: "SCS hardware validation stable IDs",
    size: fixture.stableIds.byteLength,
    usage: usage.STORAGE | usage.COPY_DST | usage.COPY_SRC,
  });
  device.queue.writeBuffer(records, 0, fixture.records);
  device.queue.writeBuffer(stableIDs, 0, fixture.stableIds);

  device.pushErrorScope("validation");
  const scs = await GPUR4ScanCurveSpectrum.create(device, {
    fetchImpl: fileFetch,
  });
  const creationError = await device.popErrorScope();
  if (creationError) {
    throw new Error("SCS pipeline creation: " + creationError.message);
  }

  const prepared = scs.prepare(count, {
    prefixBits: [20, 40, 60, 80],
  });
  if (!prepared.localMoments || prepared.frequencyLevels.length !== 4) {
    throw new Error("SCS prepare contract incomplete");
  }

  device.pushErrorScope("validation");
  const encoder = device.createCommandEncoder({
    label: "Lapinet SCS hardware validation frame",
  });
  const frame = scs.encode(encoder, {
    records,
    stableIDs,
    count,
    cellShift: 16,
    neighborRadius: 1,
    prefixBits: [20, 40, 60, 80],
  });
  device.queue.submit([encoder.finish()]);
  await device.queue.onSubmittedWorkDone();
  const frameError = await device.popErrorScope();
  if (frameError) {
    throw new Error("SCS frame validation: " + frameError.message);
  }
  if (uncaptured.length) {
    throw new Error(
      "SCS uncaptured validation errors: " +
      uncaptured.map((error) => error?.message ?? String(error)).join("; ")
    );
  }

  console.log(
    "SCS WebGPU validation PASS",
    JSON.stringify({
      count,
      stencilCells: frame.local.stencilCells,
      bands: frame.hierarchy.prefixBits,
      gpuResident: frame.gpuResident,
    })
  );

  scs.destroy();
  records.destroy();
  stableIDs.destroy();
  device.destroy();
}

await main();
Deno.exit(0);
