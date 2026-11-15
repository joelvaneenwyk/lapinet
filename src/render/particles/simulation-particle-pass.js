import {
  createH4DirectionTableQ10,
  createH4ExactCandidateTable,
} from "../../systems/scheduled-transport/h4-directions.js";

export class SimulationParticlePass {
  static async create({
    device,
    format,
    gbuffer,
    camera,
    records,
    stableIds,
    flockState,
    count,
    fetchImpl = globalThis.fetch,
    shaderUrl = new URL(
      "./simulation-particle-pass.wgsl",
      import.meta.url
    ),
  }) {
    if (!records || !stableIds || !flockState) {
      throw new TypeError(
        "SimulationParticlePass requires records, stable IDs, and flock state"
      );
    }

    const response = await fetchImpl(shaderUrl);
    if (!response.ok) {
      throw new Error(
        `Simulation particle shader load failed: ${response.status}`
      );
    }

    return new SimulationParticlePass({
      device,
      format,
      gbuffer,
      camera,
      records,
      stableIds,
      flockState,
      count,
      shaderCode: await response.text(),
    });
  }

  constructor({
    device,
    format,
    gbuffer,
    camera,
    records,
    stableIds,
    flockState,
    count,
    shaderCode,
  }) {
    const usage = globalThis.GPUBufferUsage;
    if (!usage) {
      throw new Error("GPUBufferUsage is unavailable");
    }

    this.device = device;
    this.format = format;
    this.gbuffer = gbuffer;
    this.camera = camera;
    this.records = records;
    this.stableIds = stableIds;
    this.flockState = flockState;
    this.count = Math.max(Math.floor(Number(count) || 0), 0);
    this.enabled = true;
    this.radius = 0.028;
    this.opacity = 0.98;
    this.positionScale = 0.01;
    this.occludeByImplicit = false;
    this.flockEnabled = false;
    this.flockBaseWeight = 4;
    this.directionalStretch = true;
    this.headingStreak = 3.5;
    this.depthTexture = null;
    this.depthView = null;
    this.depthSize = [0, 0];
    this.boundGBufferVersion = -1;
    this.bindGroup = null;

    this.uniformBuffer = device.createBuffer({
      label: "Lapinet simulation particle globals",
      size: 112,
      usage: usage.UNIFORM | usage.COPY_DST,
    });

    const directions = createH4DirectionTableQ10();
    this.directionBuffer = device.createBuffer({
      label: "Lapinet render H4 directions Q10",
      size: directions.byteLength,
      usage: usage.STORAGE | usage.COPY_DST,
    });
    device.queue.writeBuffer(
      this.directionBuffer,
      0,
      directions
    );

    const candidates = createH4ExactCandidateTable();
    this.candidateBuffer = device.createBuffer({
      label: "Lapinet render H4 exact candidates",
      size: candidates.byteLength,
      usage: usage.STORAGE | usage.COPY_DST,
    });
    device.queue.writeBuffer(
      this.candidateBuffer,
      0,
      candidates
    );

    const module = device.createShaderModule({
      label: "Lapinet simulation particles",
      code: shaderCode,
    });
    this.pipeline = device.createRenderPipeline({
      label: "Lapinet simulation particles",
      layout: "auto",
      vertex: {
        module,
        entryPoint: "particleVertex",
      },
      fragment: {
        module,
        entryPoint: "particleFragment",
        targets: [{
          format,
          blend: {
            color: {
              srcFactor: "src-alpha",
              dstFactor: "one-minus-src-alpha",
              operation: "add",
            },
            alpha: {
              srcFactor: "one",
              dstFactor: "one-minus-src-alpha",
              operation: "add",
            },
          },
        }],
      },
      primitive: {
        topology: "triangle-strip",
      },
      depthStencil: {
        format: "depth24plus",
        depthWriteEnabled: true,
        depthCompare: "less-equal",
      },
    });
  }

  kernelInfo() {
    return {
      id: "simulation.particles.render",
      label: "Simulation particles",
      kind: "render",
      stage: "vertex+fragment",
      active: this.enabled && this.count > 0,
      detail:
        `${this.count} E8 particles | radius ${this.radius.toFixed(4)}` +
        (
          this.flockEnabled && this.directionalStretch
            ? " | heading streaks"
            : ""
        ),
    };
  }

  ensureDepth(size) {
    const width = Math.max(Math.floor(size[0]), 1);
    const height = Math.max(Math.floor(size[1]), 1);
    if (
      this.depthTexture &&
      this.depthSize[0] === width &&
      this.depthSize[1] === height
    ) {
      return;
    }

    this.depthTexture?.destroy?.();
    const usage = globalThis.GPUTextureUsage;
    if (!usage) {
      throw new Error("GPUTextureUsage is unavailable");
    }
    this.depthTexture = this.device.createTexture({
      label: "Lapinet simulation particle depth",
      size: [width, height, 1],
      format: "depth24plus",
      usage: usage.RENDER_ATTACHMENT,
    });
    this.depthView = this.depthTexture.createView();
    this.depthSize = [width, height];
  }

  syncBindGroup() {
    if (
      this.bindGroup &&
      this.boundGBufferVersion === this.gbuffer.version
    ) {
      return;
    }

    this.bindGroup = this.device.createBindGroup({
      label: "Lapinet simulation particle bindings",
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        {
          binding: 0,
          resource: { buffer: this.uniformBuffer },
        },
        {
          binding: 1,
          resource: { buffer: this.records },
        },
        {
          binding: 2,
          resource: { buffer: this.stableIds },
        },
        {
          binding: 3,
          resource: this.gbuffer.views.depth,
        },
        {
          binding: 4,
          resource: { buffer: this.flockState },
        },
        {
          binding: 5,
          resource: { buffer: this.directionBuffer },
        },
        {
          binding: 6,
          resource: { buffer: this.candidateBuffer },
        },
      ],
    });
    this.boundGBufferVersion = this.gbuffer.version;
  }

  updateGlobals(size) {
    const camera = this.camera.snapshot();
    const values = new Float32Array(28);
    values.set([
      size[0],
      size[1],
      camera.near,
      camera.far,
      camera.fovY,
      this.radius,
      this.opacity,
      this.positionScale,
    ], 0);
    values.set([
      ...camera.position,
      this.occludeByImplicit ? 1 : 0,
    ], 8);
    values.set([...camera.forward, 0], 12);
    values.set([...camera.right, 0], 16);
    values.set([...camera.up, 0], 20);
    values.set([
      this.flockEnabled ? 1 : 0,
      this.flockBaseWeight,
      this.directionalStretch ? 1 : 0,
      this.headingStreak,
    ], 24);
    this.device.queue.writeBuffer(this.uniformBuffer, 0, values);
  }

  encode(encoder, { view, size }) {
    if (!this.enabled || this.count <= 0) {
      return;
    }

    this.ensureDepth(size);
    this.syncBindGroup();
    this.updateGlobals(size);

    const pass = encoder.beginRenderPass({
      label: "Lapinet simulation particles",
      colorAttachments: [{
        view,
        loadOp: "load",
        storeOp: "store",
      }],
      depthStencilAttachment: {
        view: this.depthView,
        depthClearValue: 1,
        depthLoadOp: "clear",
        depthStoreOp: "store",
      },
    });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.draw(4, this.count);
    pass.end();
  }

  destroy() {
    this.uniformBuffer.destroy?.();
    this.directionBuffer.destroy?.();
    this.candidateBuffer.destroy?.();
    this.depthTexture?.destroy?.();
    this.bindGroup = null;
  }
}
