const TARGET_CODES = Object.freeze({
  final: 0,
  albedo: 1,
  normal: 2,
  material: 3,
  depth: 4,
  all: 5,
  position: 6,
  effort: 7,
  roughness: 8,
  ior: 9,
});

export class RenderTargetDebugPass {
  static async create({
    device,
    format,
    gbuffer,
    camera,
    fetchImpl = globalThis.fetch,
    shaderUrl = new URL("./render-target-debug.wgsl", import.meta.url),
  }) {
    const response = await fetchImpl(shaderUrl);
    if (!response.ok) {
      throw new Error(
        `Render target debug shader load failed: ${response.status}`
      );
    }

    return new RenderTargetDebugPass({
      device,
      format,
      gbuffer,
      camera,
      shaderCode: await response.text(),
    });
  }

  constructor({
    device,
    format,
    gbuffer,
    camera,
    shaderCode,
  }) {
    const usage = globalThis.GPUBufferUsage;
    if (!usage) throw new Error("GPUBufferUsage is unavailable");

    this.device = device;
    this.gbuffer = gbuffer;
    this.camera = camera;
    this.target = "final";
    this.uniformBuffer = device.createBuffer({
      label: "Lapinet render target diagnostics",
      size: 96,
      usage: usage.UNIFORM | usage.COPY_DST,
    });

    const module = device.createShaderModule({
      label: "Lapinet render target diagnostics",
      code: shaderCode,
    });

    this.pipeline = device.createRenderPipeline({
      label: "Lapinet render target diagnostics",
      layout: "auto",
      vertex: {
        module,
        entryPoint: "vertexMain",
      },
      fragment: {
        module,
        entryPoint: "fragmentMain",
        targets: [{ format }],
      },
      primitive: { topology: "triangle-list" },
    });

    this.uniformValues = new Float32Array(24);
    this.bindGroup = null;
    this.boundGBufferVersion = -1;
  }

  setTarget(target) {
    if (!(target in TARGET_CODES)) {
      throw new Error(`Unknown render target diagnostic: ${target}`);
    }
    this.target = target;
    return target;
  }

  kernelInfo() {
    return {
      id: "diagnostics.render-target",
      label: "Render target diagnostics",
      kind: "render",
      stage: "fragment",
      active: this.target !== "final",
      detail:
        this.target === "final"
          ? "disabled"
          : `fullscreen | ${this.target}`,
    };
  }

  syncBindGroup() {
    if (
      this.bindGroup &&
      this.boundGBufferVersion === this.gbuffer.version
    ) {
      return;
    }

    this.bindGroup = this.device.createBindGroup({
      label: "Lapinet render target diagnostics GBuffer",
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.gbuffer.views.albedo },
        { binding: 1, resource: this.gbuffer.views.normal },
        { binding: 2, resource: this.gbuffer.views.material },
        { binding: 3, resource: this.gbuffer.views.depth },
        { binding: 4, resource: { buffer: this.uniformBuffer } },
      ],
    });
    this.boundGBufferVersion = this.gbuffer.version;
  }

  updateGlobals(size) {
    const camera = this.camera.snapshot();
    this.uniformValues.set([
      size[0],
      size[1],
      TARGET_CODES[this.target],
      camera.far,
      ...camera.position, 0,
      ...camera.forward, 0,
      ...camera.right, 0,
      ...camera.up, 0,
      camera.fovY, camera.near, camera.far, 0,
    ]);
    this.device.queue.writeBuffer(
      this.uniformBuffer,
      0,
      this.uniformValues
    );
  }

  encode(encoder, { view, size }) {
    if (this.target === "final") return;

    this.syncBindGroup();
    this.updateGlobals(size);

    const pass = encoder.beginRenderPass({
      label: "Lapinet render target diagnostics",
      colorAttachments: [{
        view,
        loadOp: "load",
        storeOp: "store",
      }],
    });

    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.draw(3);
    pass.end();
  }

  destroy() {
    this.uniformBuffer.destroy?.();
  }
}

export { TARGET_CODES };
