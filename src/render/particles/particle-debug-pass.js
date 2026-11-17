export class ParticleDebugPass {
  // Bindings each auto-layout pipeline actually uses (see the .wgsl):
  // trailVertex reads globals + history; edgeVertex reads globals + records
  // + spatialOrder; lineFragment reads globals + implicitDepth.
  static TRAIL_BINDINGS = Object.freeze([0, 3, 4]);
  static EDGE_BINDINGS = Object.freeze([0, 1, 2, 4]);

  static async create({
    device,
    format,
    gbuffer,
    camera,
    records,
    spatialOrder,
    trailHistory,
    count,
    fetchImpl = globalThis.fetch,
    shaderUrl = new URL(
      "./particle-debug-pass.wgsl",
      import.meta.url
    ),
  }) {
    if (
      !records ||
      !spatialOrder ||
      !trailHistory?.buffer
    ) {
      throw new TypeError(
        "ParticleDebugPass requires records, SCS order, and trail history"
      );
    }

    const response = await fetchImpl(shaderUrl, {
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(
        "Particle debug shader load failed: " +
        response.status
      );
    }

    return new ParticleDebugPass({
      device,
      format,
      gbuffer,
      camera,
      records,
      spatialOrder,
      trailHistory,
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
    spatialOrder,
    trailHistory,
    count,
    shaderCode,
  }) {
    const U = globalThis.GPUBufferUsage;
    if (!U) {
      throw new Error("GPUBufferUsage is unavailable");
    }

    this.device = device;
    this.gbuffer = gbuffer;
    this.camera = camera;
    this.records = records;
    this.spatialOrder = spatialOrder;
    this.trailHistory = trailHistory;
    this.count = Math.max(0, Math.trunc(count));

    this.trailsEnabled = true;
    this.neighborEdgesEnabled = true;
    this.trailLength = 6;
    this.trailStride = 4;
    this.trailOpacity = 0.42;
    this.edgeFan = 4;
    this.edgeStride = 2;
    this.edgeOpacity = 0.20;
    this.positionScale = 0.01;
    this.occludeByImplicit = false;

    this.uniformBuffer = device.createBuffer({
      label: "Lapinet particle debug globals",
      size: 128,
      usage: U.UNIFORM | U.COPY_DST,
    });

    const module = device.createShaderModule({
      label: "Lapinet particle debug overlays",
      code: shaderCode,
    });

    const blend = {
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
    };

    const pipeline = (label, vertexEntry) =>
      device.createRenderPipeline({
        label,
        layout: "auto",
        vertex: {
          module,
          entryPoint: vertexEntry,
        },
        fragment: {
          module,
          entryPoint: "lineFragment",
          targets: [{ format, blend }],
        },
        primitive: {
          topology: "line-list",
        },
      });

    this.trailPipeline = pipeline(
      "Lapinet particle trails",
      "trailVertex"
    );
    this.edgePipeline = pipeline(
      "Lapinet neighbor edges",
      "edgeVertex"
    );

    this.trailBindGroup = null;
    this.edgeBindGroup = null;
    this.boundGBufferVersion = -1;

  }

  kernelInfo() {
    const parts = [];
    if (this.trailsEnabled) {
      parts.push(
        "trails " + this.trailLength +
        " / stride " + this.trailStride
      );
    }
    if (this.neighborEdgesEnabled) {
      parts.push(
        "edges fan " + this.edgeFan +
        " / stride " + this.edgeStride
      );
    }
    return {
      id: "simulation.particles.debug-overlays",
      label: "Particle trails + neighbor edges",
      kind: "render",
      stage: "vertex+fragment",
      active:
        this.trailsEnabled ||
        this.neighborEdgesEnabled,
      detail: parts.join(" | ") || "disabled",
    };
  }

  syncBindGroups() {
    if (this.boundGBufferVersion === this.gbuffer.version) {
      return;
    }

    const entries = [
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
        resource: { buffer: this.spatialOrder },
      },
      {
        binding: 3,
        resource: { buffer: this.trailHistory.buffer },
      },
      {
        binding: 4,
        resource: this.gbuffer.views.depth,
      },
    ];
    // Both pipelines use layout: "auto", which drops bindings an entry point
    // never reads. Passing an entry the layout lacks invalidates the bind
    // group, and with it the whole frame's command buffer (black screen).
    const pick = (bindings) =>
      entries.filter((entry) => bindings.includes(entry.binding));

    this.trailBindGroup = this.device.createBindGroup({
      label: "Lapinet trail overlay bindings",
      layout: this.trailPipeline.getBindGroupLayout(0),
      entries: pick(ParticleDebugPass.TRAIL_BINDINGS),
    });
    this.edgeBindGroup = this.device.createBindGroup({
      label: "Lapinet edge overlay bindings",
      layout: this.edgePipeline.getBindGroupLayout(0),
      entries: pick(ParticleDebugPass.EDGE_BINDINGS),
    });
    this.boundGBufferVersion = this.gbuffer.version;
  }

  updateGlobals(size) {
    const camera = this.camera.snapshot();
    const values = new Float32Array(32);

    values.set([
      size[0],
      size[1],
      camera.near,
      camera.far,
    ], 0);
    values.set([
      camera.fovY,
      this.positionScale,
      this.trailOpacity,
      this.edgeOpacity,
    ], 4);
    values.set([
      ...camera.position,
      this.occludeByImplicit ? 1 : 0,
    ], 8);
    values.set([...camera.forward, 0], 12);
    values.set([...camera.right, 0], 16);
    values.set([...camera.up, 0], 20);
    values.set([
      this.trailHistory.head,
      this.trailHistory.valid,
      this.trailHistory.historyLength,
      this.count,
    ], 24);
    values.set([
      this.trailLength,
      this.trailStride,
      this.edgeFan,
      this.edgeStride,
    ], 28);

    this.device.queue.writeBuffer(
      this.uniformBuffer,
      0,
      values
    );
  }

  encode(encoder, { view, size }) {
    if (
      !this.trailsEnabled &&
      !this.neighborEdgesEnabled
    ) {
      return;
    }

    this.syncBindGroups();
    this.updateGlobals(size);

    const pass = encoder.beginRenderPass({
      label: "Lapinet particle debug overlays",
      colorAttachments: [{
        view,
        loadOp: "load",
        storeOp: "store",
      }],
    });

    if (
      this.trailsEnabled &&
      this.trailHistory.valid >= 2
    ) {
      const stride = Math.max(
        1,
        Math.trunc(this.trailStride)
      );
      const sampled = Math.ceil(this.count / stride);
      const segments = Math.max(
        0,
        Math.min(
          Math.trunc(this.trailLength),
          this.trailHistory.valid
        ) - 1
      );

      if (sampled > 0 && segments > 0) {
        pass.setPipeline(this.trailPipeline);
        pass.setBindGroup(0, this.trailBindGroup);
        pass.draw(2, sampled * segments);
      }
    }

    if (this.neighborEdgesEnabled) {
      const stride = Math.max(
        1,
        Math.trunc(this.edgeStride)
      );
      const fan = Math.max(
        1,
        Math.trunc(this.edgeFan)
      );
      const sampled = Math.ceil(this.count / stride);

      if (sampled > 0) {
        pass.setPipeline(this.edgePipeline);
        pass.setBindGroup(0, this.edgeBindGroup);
        pass.draw(2, sampled * fan);
      }
    }

    pass.end();
  }

  destroy() {
    this.uniformBuffer.destroy?.();
    this.trailBindGroup = null;
    this.edgeBindGroup = null;
  }
}
