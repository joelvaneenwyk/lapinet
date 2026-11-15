import { GpuContext } from "../src/gpu/gpu-context.js";
import {
  createScsFixtureData,
  SCS_PARTICLE_RECORDS,
  SCS_PARTICLE_STABLE_IDS,
} from "../src/systems/scs/fixture-particles.js";
import {
  createParticleMotionSystem,
} from "../src/systems/scs/particle-motion.js";
import {
  SimulationParticlePass,
} from "../src/render/particles/simulation-particle-pass.js";
import { PerspectiveCamera } from "../src/render/camera.js";

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
  console.log("particle validation: requesting adapter");
  if (!navigator.gpu) throw new Error("Deno WebGPU is unavailable");
  const adapter = await navigator.gpu.requestAdapter({
    powerPreference: "high-performance",
  });
  if (!adapter) throw new Error("No headless WebGPU adapter");
  console.log("particle validation: adapter ready");

  const device = await adapter.requestDevice();
  const gpu = GpuContext.fromDevice(device);
  const errors = [];
  device.addEventListener?.("uncapturederror", (event) => {
    errors.push(event.error);
  });

  const count = 4096;
  const fixture = createScsFixtureData(count);
  const records = device.createBuffer({
    label: "Lapinet particle validation records",
    size: fixture.records.byteLength,
    usage:
      GPUBufferUsage.STORAGE |
      GPUBufferUsage.COPY_DST |
      GPUBufferUsage.COPY_SRC,
  });
  const stableIds = device.createBuffer({
    label: "Lapinet particle validation stable IDs",
    size: fixture.stableIds.byteLength,
    usage:
      GPUBufferUsage.STORAGE |
      GPUBufferUsage.COPY_DST |
      GPUBufferUsage.COPY_SRC,
  });
  device.queue.writeBuffer(records, 0, fixture.records);
  device.queue.writeBuffer(stableIds, 0, fixture.stableIds);

  const entries = new Map([
    [SCS_PARTICLE_RECORDS, { resource: records }],
    [SCS_PARTICLE_STABLE_IDS, { resource: stableIds }],
  ]);
  const resources = {
    resource(id) {
      const entry = entries.get(id);
      if (!entry) throw new Error("missing resource: " + id);
      return entry.resource;
    },
  };

  device.pushErrorScope("validation");
  const motion = createParticleMotionSystem({
    count,
    cadence: 1,
    fetchImpl: fileFetch,
  });
  await motion.initialize({ gpu, resources, system: motion });
  console.log("particle validation: motion pipeline ready");

  const motionEncoder = device.createCommandEncoder();
  motion.encode({
    gpu,
    encoder: motionEncoder,
    frame: { frameIndex: 0, dt: 1 / 30 },
  });
  const recordReadback = device.createBuffer({
    size: 16,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  motionEncoder.copyBufferToBuffer(records, 0, recordReadback, 0, 16);
  device.queue.submit([motionEncoder.finish()]);
  await device.queue.onSubmittedWorkDone();
  await recordReadback.mapAsync(GPUMapMode.READ);
  const moved = new Uint32Array(recordReadback.getMappedRange().slice(0));
  recordReadback.unmap();
  if (moved.every((value, index) => value === fixture.records[index])) {
    throw new Error("motion dispatch did not mutate the canonical record");
  }
  console.log("particle validation: motion mutated canonical state");

  const depth = device.createTexture({
    size: [256, 256, 1],
    format: "r32float",
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  const farDepth = new Float32Array(256 * 256);
  farDepth.fill(40);
  device.queue.writeTexture(
    { texture: depth },
    farDepth,
    { bytesPerRow: 256 * 4, rowsPerImage: 256 },
    [256, 256, 1]
  );
  const gbuffer = {
    version: 1,
    views: { depth: depth.createView() },
  };
  const camera = new PerspectiveCamera();
  const particles = await SimulationParticlePass.create({
    device,
    format: "rgba8unorm",
    gbuffer,
    camera,
    records,
    stableIds,
    count,
    fetchImpl: fileFetch,
  });
  console.log("particle validation: render pipeline ready");

  const target = device.createTexture({
    size: [256, 256, 1],
    format: "rgba8unorm",
    usage:
      GPUTextureUsage.RENDER_ATTACHMENT |
      GPUTextureUsage.COPY_SRC,
  });
  const output = device.createBuffer({
    size: 256 * 256 * 4,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const encoder = device.createCommandEncoder();
  const clear = encoder.beginRenderPass({
    colorAttachments: [{
      view: target.createView(),
      clearValue: { r: 0, g: 0, b: 0, a: 0 },
      loadOp: "clear",
      storeOp: "store",
    }],
  });
  clear.end();
  particles.encode(encoder, {
    view: target.createView(),
    size: [256, 256],
    frameIndex: 0,
  });
  encoder.copyTextureToBuffer(
    { texture: target },
    { buffer: output, bytesPerRow: 256 * 4, rowsPerImage: 256 },
    [256, 256, 1]
  );
  device.queue.submit([encoder.finish()]);
  await device.queue.onSubmittedWorkDone();

  const validationError = await device.popErrorScope();
  if (validationError) {
    throw new Error("Particle WebGPU validation: " + validationError.message);
  }
  if (errors.length) {
    throw new Error(
      "Particle uncaptured errors: " +
      errors.map((error) => error?.message ?? String(error)).join("; ")
    );
  }

  await output.mapAsync(GPUMapMode.READ);
  const pixels = new Uint8Array(output.getMappedRange());
  let litPixels = 0;
  for (let i = 3; i < pixels.length; i += 4) {
    if (pixels[i] !== 0) litPixels += 1;
  }
  output.unmap();
  if (litPixels === 0) {
    throw new Error("particle renderer produced no visible pixels");
  }

  console.log(
    "Particle WebGPU validation PASS",
    JSON.stringify({
      count,
      movedCanonicalRecord: true,
      litPixels,
    })
  );

  particles.destroy();
  motion.destroy();
  recordReadback.destroy();
  output.destroy();
  target.destroy();
  depth.destroy();
  records.destroy();
  stableIds.destroy();
  device.destroy();
}

await main();
Deno.exit(0);
