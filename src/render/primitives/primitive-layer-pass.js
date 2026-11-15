const PRODUCER_DEFINITIONS = Object.freeze([
  Object.freeze({
    id: "primitive.splats",
    label: "Spherical splats",
    kind: "render",
    topology: "triangle-strip",
    vertexEntry: "splatVertex",
    fragmentEntry: "splatFragment",
    vertexCount: 4,
    countKey: "splats",
    bufferKey: "splats",
    binding: 1,
  }),
  Object.freeze({
    id: "primitive.lines",
    label: "Thin lines",
    kind: "render",
    topology: "line-list",
    vertexEntry: "thinLineVertex",
    fragmentEntry: "lineFragment",
    vertexCount: 2,
    countKey: "thinLines",
    bufferKey: "thinLines",
    binding: 2,
  }),
  Object.freeze({
    id: "primitive.thick-lines",
    label: "Thick line quads",
    kind: "render",
    topology: "triangle-list",
    vertexEntry: "thickLineVertex",
    fragmentEntry: "lineFragment",
    vertexCount: 6,
    countKey: "thickLines",
    bufferKey: "thickLines",
    binding: 3,
  }),
  Object.freeze({
    id: "primitive.sdf-splats",
    label: "SDF splat impostors",
    kind: "render",
    topology: "triangle-strip",
    vertexEntry: "sdfSplatVertex",
    fragmentEntry: "sdfSplatFragment",
    vertexCount: 4,
    countKey: "sdfSplats",
    bufferKey: "sdfSplats",
    binding: 4,
  }),
  Object.freeze({
    id: "primitive.polygons",
    label: "Polygons",
    kind: "render",
    topology: "triangle-list",
    vertexEntry: "polygonVertex",
    fragmentEntry: "polygonFragment",
    vertexCount: null,
    countKey: "polygonVertices",
    bufferKey: "polygons",
    binding: 5,
  }),
]);

class PrimitiveProducer {
  constructor({ definition, pipeline, source, layer }) {
    this.definition = definition;
    this.pipeline = pipeline;
    this.source = source;
    this.layer = layer;
    this.enabled = true;
  }

  draw(pass, bindGroup) {
    if (!this.enabled) return false;

    const count = this.source.counts[this.definition.countKey] ?? 0;
    if (count <= 0) return false;

    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, bindGroup);
    if (this.definition.vertexCount == null) {
      pass.draw(count);
    } else {
      pass.draw(this.definition.vertexCount, count);
    }
    return true;
  }

  kernelInfo() {
    const count = this.source.counts[this.definition.countKey] ?? 0;
    return {
      id: this.definition.id,
      label: this.definition.label,
      kind: "render",
      stage: "vertex+fragment",
      active: this.enabled && count > 0,
      detail:
        `${this.definition.topology} | ${count} ` +
        (this.definition.vertexCount == null ? "vertices" : "instances"),
    };
  }
}

export class PrimitiveLayerPass {
  static async create({
    device,
    format,
    gbuffer,
    camera,
    source,
    fetchImpl = globalThis.fetch,
    shaderUrl = new URL("./primitive-layer.wgsl", import.meta.url),
  }) {
    const response = await fetchImpl(shaderUrl);
    if (!response.ok) {
      throw new Error(
        `Primitive layer shader load failed: ${response.status}`
      );
    }

    const shaderCode = await response.text();
    const canScope =
      typeof device.pushErrorScope === "function" &&
      typeof device.popErrorScope === "function";

    if (canScope) {
      device.pushErrorScope("validation");
    }

    let pass = null;
    try {
      pass = new PrimitiveLayerPass({
        device,
        format,
        gbuffer,
        camera,
        source,
        shaderCode,
      });
    } catch (error) {
      if (canScope) {
        await device.popErrorScope();
      }
      throw error;
    }

    if (canScope) {
      const validationError = await device.popErrorScope();
      if (validationError) {
        pass.destroy();
        throw new Error(
          "Primitive layer WebGPU validation failed: " +
          validationError.message
        );
      }
    }

    return pass;
  }

  constructor({
    device,
    format,
    gbuffer,
    camera,
    source,
    shaderCode,
  }) {
    const usage = globalThis.GPUBufferUsage;
    if (!usage) throw new Error("GPUBufferUsage is unavailable");

    this.device = device;
    this.format = format;
    this.gbuffer = gbuffer;
    this.camera = camera;
    this.source = source.resources();
    this.opacity = 1;
    this.splatScale = 1;
    this.thickLineScale = 1;
    this.depthTexture = null;
    this.depthView = null;
    this.depthSize = [0, 0];
    this.boundGBufferVersion = -1;
    this.bindGroups = new Map();

    this.uniformBuffer = device.createBuffer({
      label: "Lapinet primitive globals",
      size: 96,
      usage: usage.UNIFORM | usage.COPY_DST,
    });

    this.shaderModule = device.createShaderModule({
      label: "Lapinet primitive layer",
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

    this.producers = new Map();

    for (const definition of PRODUCER_DEFINITIONS) {
      const pipeline = device.createRenderPipeline({
        label: `Lapinet / ${definition.label}`,
        layout: "auto",
        vertex: {
          module: this.shaderModule,
          entryPoint: definition.vertexEntry,
        },
        fragment: {
          module: this.shaderModule,
          entryPoint: definition.fragmentEntry,
          targets: [{ format, blend }],
        },
        primitive: {
          topology: definition.topology,
        },
        depthStencil: {
          format: "depth24plus",
          depthWriteEnabled: true,
          depthCompare: "less-equal",
        },
      });

      this.producers.set(
        definition.id,
        new PrimitiveProducer({
          definition,
          pipeline,
          source: this.source,
          layer: this,
        })
      );
    }
  }

  setEnabled(id, enabled) {
    const producer = this.producers.get(id);
    if (!producer) {
      throw new Error(`Unknown primitive producer: ${id}`);
    }
    producer.enabled = !!enabled;
    return producer.enabled;
  }

  producer(id) {
    const producer = this.producers.get(id);
    if (!producer) {
      throw new Error(`Unknown primitive producer: ${id}`);
    }
    return producer;
  }

  kernelProviders() {
    return [...this.producers.values()];
  }

  ensureDepth(size) {
    const width = Math.max(Math.floor(size[0]), 1);
    const height = Math.max(Math.floor(size[1]), 1);
    if (
      this.depthTexture &&
      this.depthSize[0] === width &&
      this.depthSize[1] === height
    ) {
      return false;
    }

    this.depthTexture?.destroy?.();

    const usage = globalThis.GPUTextureUsage;
    if (!usage) throw new Error("GPUTextureUsage is unavailable");

    this.depthTexture = this.device.createTexture({
      label: "Lapinet primitive depth",
      size: [width, height, 1],
      format: "depth24plus",
      usage: usage.RENDER_ATTACHMENT,
    });
    this.depthView = this.depthTexture.createView();
    this.depthSize = [width, height];
    return true;
  }

  syncBindGroups() {
    if (
      this.bindGroups.size === this.producers.size &&
      this.boundGBufferVersion === this.gbuffer.version
    ) {
      return;
    }

    this.bindGroups.clear();

    for (const [id, producer] of this.producers) {
      const definition = producer.definition;
      this.bindGroups.set(
        id,
        this.device.createBindGroup({
          label: `Lapinet primitive bind group: ${id}`,
          layout: producer.pipeline.getBindGroupLayout(0),
          entries: [
            {
              binding: 0,
              resource: { buffer: this.uniformBuffer },
            },
            {
              binding: definition.binding,
              resource: {
                buffer: this.source[definition.bufferKey],
              },
            },
            {
              binding: 6,
              resource: this.gbuffer.views.depth,
            },
          ],
        })
      );
    }

    this.boundGBufferVersion = this.gbuffer.version;
  }

  updateGlobals(size) {
    const camera = this.camera.snapshot();
    const values = new Float32Array(24);
    values.set([
      size[0],
      size[1],
      camera.near,
      camera.far,
      camera.fovY,
      this.thickLineScale,
      this.splatScale,
      this.opacity,
    ], 0);
    values.set([...camera.position, 0], 8);
    values.set([...camera.forward, 0], 12);
    values.set([...camera.right, 0], 16);
    values.set([...camera.up, 0], 20);

    this.device.queue.writeBuffer(
      this.uniformBuffer,
      0,
      values
    );
  }

  encode(encoder, { view, size }) {
    const active = [...this.producers.values()].some(
      (producer) =>
        producer.enabled &&
        (this.source.counts[producer.definition.countKey] ?? 0) > 0
    );
    if (!active) return;

    this.ensureDepth(size);
    this.syncBindGroups();
    this.updateGlobals(size);

    const pass = encoder.beginRenderPass({
      label: "Lapinet primitive layer",
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

    for (const [id, producer] of this.producers) {
      producer.draw(pass, this.bindGroups.get(id));
    }
    pass.end();
  }

  destroy() {
    this.uniformBuffer.destroy?.();
    this.depthTexture?.destroy?.();
  }
}

export { PRODUCER_DEFINITIONS };
