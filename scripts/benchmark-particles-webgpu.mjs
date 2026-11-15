import {
  createScsFixtureData,
} from "../src/systems/scs/fixture-particles.js";
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

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

async function timeRender(device, pass, target, width, height) {
  const encoder = device.createCommandEncoder();
  const clear = encoder.beginRenderPass({
    colorAttachments: [{
      view: target.createView(),
      clearValue: { r: 0, g: 0, b: 0, a: 1 },
      loadOp: "clear",
      storeOp: "store",
    }],
  });
  clear.end();
  pass.encode(encoder, {
    view: target.createView(),
    size: [width, height],
  });
  const start = performance.now();
  device.queue.submit([encoder.finish()]);
  await device.queue.onSubmittedWorkDone();
  return performance.now() - start;
}

const counts = Deno.args.length
  ? Deno.args.map(Number)
  : [4096, 65536, 262144];
const width = 1920;
const height = 1080;

if (!navigator.gpu) throw new Error("WebGPU unavailable");
const adapter = await navigator.gpu.requestAdapter({
  powerPreference: "high-performance",
});
if (!adapter) throw new Error("No WebGPU adapter");
const device = await adapter.requestDevice();

const depth = device.createTexture({
  size: [1, 1, 1],
  format: "r32float",
  usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
});
device.queue.writeTexture(
  { texture: depth },
  new Float32Array([40]),
  { bytesPerRow: 256, rowsPerImage: 1 },
  [1, 1, 1]
);
const target = device.createTexture({
  size: [width, height, 1],
  format: "rgba8unorm",
  usage: GPUTextureUsage.RENDER_ATTACHMENT,
});
const gbuffer = {
  version: 1,
  views: { depth: depth.createView() },
};
const camera = new PerspectiveCamera();

for (const count of counts) {
  const fixture = createScsFixtureData(count);
  const records = device.createBuffer({
    size: fixture.records.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  const stableIds = device.createBuffer({
    size: fixture.stableIds.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(records, 0, fixture.records);
  device.queue.writeBuffer(stableIds, 0, fixture.stableIds);

  const pass = await SimulationParticlePass.create({
    device,
    format: "rgba8unorm",
    gbuffer,
    camera,
    records,
    stableIds,
    count,
    fetchImpl: fileFetch,
  });
  pass.radius = 0.028;
  pass.positionScale = 0.01;
  pass.opacity = 0.98;
  pass.occludeByImplicit = false;

  const firstMs = await timeRender(
    device, pass, target, width, height
  );
  const samples = [];
  for (let i = 0; i < 5; i++) {
    samples.push(await timeRender(
      device, pass, target, width, height
    ));
  }

  console.log("PARTICLE_RENDER_BENCH", JSON.stringify({
    count,
    resolution: [width, height],
    firstMs,
    steadyMs: samples,
    medianMs: median(samples),
    fpsEquivalent: 1000 / median(samples),
  }));

  pass.destroy();
  records.destroy();
  stableIds.destroy();
}

target.destroy();
depth.destroy();
device.destroy();
