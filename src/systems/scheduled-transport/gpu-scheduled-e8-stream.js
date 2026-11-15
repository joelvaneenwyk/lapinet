import {
  E8_GRAM,
  E8_ROOT_STEPS,
  E8_STRIDE,
} from "./noether/icosian-e8.mjs";
import {
  createH4DirectionTableQ10,
  createH4ExactCandidateTable,
} from "./h4-directions.js";

const U = () => GPUBufferUsage;

async function compile(device, shaderUrl, fetchImpl) {
  const response = await fetchImpl(shaderUrl, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(
      "scheduled E8 stream WGSL HTTP " + response.status
    );
  }
  const module = device.createShaderModule({
    label: "Lapinet scheduled E8 stream",
    code: await response.text(),
  });
  const info = await module.getCompilationInfo?.();
  const errors = info?.messages?.filter(
    (message) => message.type === "error"
  ) ?? [];
  if (errors.length) {
    throw new Error(
      errors.map((message) =>
        message.lineNum + ":" + message.linePos + " " + message.message
      ).join("; ")
    );
  }
  return module;
}

export class GPUScheduledE8Stream {
  constructor(device) {
    this.device = device;
    this.ready = false;
    this.bound = null;
  }

  static async create(device, {
    fetchImpl = globalThis.fetch,
    shaderUrl = new URL(
      "./gpu-scheduled-e8-stream.wgsl",
      import.meta.url
    ),
  } = {}) {
    if (!device) {
      throw new Error("GPUScheduledE8Stream requires GPUDevice");
    }

    const stream = new GPUScheduledE8Stream(device);
    const module = await compile(device, shaderUrl, fetchImpl);
    stream.pipeline = await device.createComputePipelineAsync({
      label: "Lapinet scheduled E8 stream",
      layout: "auto",
      compute: {
        module,
        entryPoint: "scheduledStream",
      },
    });

    const roots = new Int32Array(E8_ROOT_STEPS.length * 8);
    E8_ROOT_STEPS.forEach((root, channel) => {
      roots.set(root, channel * 8);
    });
    const gram = new Int32Array(64);
    E8_GRAM.forEach((row, i) => {
      gram.set(row, i * 8);
    });

    stream.roots = device.createBuffer({
      label: "Lapinet E8 root steps",
      size: roots.byteLength,
      usage: U().STORAGE | U().COPY_DST,
    });
    stream.gram = device.createBuffer({
      label: "Lapinet E8 Gram matrix",
      size: gram.byteLength,
      usage: U().STORAGE | U().COPY_DST,
    });
    const directions = createH4DirectionTableQ10();
    const candidates = createH4ExactCandidateTable();
    stream.directions = device.createBuffer({
      label: "Lapinet H4 directions Q10",
      size: directions.byteLength,
      usage: U().STORAGE | U().COPY_DST,
    });
    stream.candidates = device.createBuffer({
      label: "Lapinet H4 exact candidate table",
      size: candidates.byteLength,
      usage: U().STORAGE | U().COPY_DST,
    });
    stream.zeroFlock = device.createBuffer({
      label: "Lapinet zero flock state",
      size: 32,
      usage: U().STORAGE | U().COPY_DST,
    });
    device.queue.writeBuffer(
      stream.zeroFlock,
      0,
      new Int32Array(8)
    );
    stream.config = device.createBuffer({
      label: "Lapinet scheduled transport config",
      size: 48,
      usage: U().UNIFORM | U().COPY_DST,
    });

    device.queue.writeBuffer(stream.roots, 0, roots);
    device.queue.writeBuffer(stream.gram, 0, gram);
    device.queue.writeBuffer(stream.directions, 0, directions);
    device.queue.writeBuffer(stream.candidates, 0, candidates);
    stream.ready = true;
    return stream;
  }

  bind(records, topology, flockState) {
    if (
      this.bound?.records === records &&
      this.bound?.topology === topology &&
      this.bound?.flockState === flockState
    ) return this.bound.group;

    const group = this.device.createBindGroup({
      label: "Lapinet scheduled E8 stream bindings",
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: records } },
        { binding: 1, resource: { buffer: this.roots } },
        { binding: 2, resource: { buffer: this.gram } },
        { binding: 3, resource: { buffer: topology } },
        { binding: 4, resource: { buffer: this.config } },
        { binding: 5, resource: { buffer: flockState } },
        { binding: 6, resource: { buffer: this.directions } },
        { binding: 7, resource: { buffer: this.candidates } },
      ],
    });
    this.bound = { records, topology, flockState, group };
    return group;
  }

  encode(encoder, {
    records,
    topology,
    count,
    frame,
    reverse = false,
    seed = 17,
    threshold = 3072,
    cellShift = 17,
    flockState,
    flockEnabled = false,
    flockBaseWeight = 8,
  }) {
    if (!this.ready) {
      throw new Error("GPUScheduledE8Stream not initialized");
    }
    if (!Number.isInteger(count) || count < 1) {
      throw new Error("scheduled stream count must be positive");
    }
    if (!Number.isInteger(frame) || frame < 0) {
      throw new Error("scheduled stream frame must be nonnegative");
    }
    if (
      !Number.isInteger(threshold) ||
      threshold < 0 ||
      threshold > 4096
    ) {
      throw new Error("scheduled stream threshold must be 0..4096");
    }

    this.device.queue.writeBuffer(
      this.config,
      0,
      new Int32Array([
        count,
        frame >>> 0,
        seed >>> 0,
        threshold >>> 0,
        reverse ? 1 : 0,
        cellShift >>> 0,
        E8_STRIDE >>> 0,
        flockEnabled ? 1 : 0,
        Math.trunc(flockBaseWeight),
        0,
        0,
        0,
      ])
    );

    const pass = encoder.beginComputePass({
      label: reverse
        ? "Lapinet inverse scheduled E8 stream"
        : "Lapinet scheduled E8 stream",
    });
    pass.setPipeline(this.pipeline);
    const steering = flockState ?? this.zeroFlock;
    pass.setBindGroup(
      0,
      this.bind(records, topology, steering)
    );
    pass.dispatchWorkgroups(Math.ceil(count / 256));
    pass.end();

    return Object.freeze({
      count,
      frame,
      reverse: !!reverse,
      seed: seed >>> 0,
      threshold,
      topologyState: topology,
    });
  }

  destroy() {
    this.roots?.destroy?.();
    this.gram?.destroy?.();
    this.directions?.destroy?.();
    this.candidates?.destroy?.();
    this.zeroFlock?.destroy?.();
    this.config?.destroy?.();
    this.ready = false;
  }
}
