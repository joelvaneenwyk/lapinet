function parseHexColor(value) {
  if (Array.isArray(value) || ArrayBuffer.isView(value)) {
    return [
      Number(value[0] ?? 1),
      Number(value[1] ?? 1),
      Number(value[2] ?? 1),
      Number(value[3] ?? 1),
    ].map((component) =>
      Math.min(Math.max(Number(component) || 0, 0), 1)
    );
  }

  const text = String(value ?? "#ffffff").trim();
  const match = /^#([0-9a-f]{6})$/i.exec(text);
  if (!match) return [1, 1, 1, 1];

  const packed = match[1];
  return [
    parseInt(packed.slice(0, 2), 16) / 255,
    parseInt(packed.slice(2, 4), 16) / 255,
    parseInt(packed.slice(4, 6), 16) / 255,
    1,
  ];
}

export class GpuCursorPass {
  static async create({
    device,
    format,
    fetchImpl = globalThis.fetch,
    shaderUrl = new URL("./cursor.wgsl", import.meta.url),
  }) {
    if (typeof fetchImpl !== "function") {
      throw new Error("GpuCursorPass requires fetch() to load WGSL");
    }

    const response = await fetchImpl(shaderUrl);
    if (!response.ok) {
      throw new Error(
        `Cursor shader load failed: ${response.status} ${response.statusText}`
      );
    }

    return new GpuCursorPass({
      device,
      format,
      shaderCode: await response.text(),
    });
  }

  constructor({ device, format, shaderCode }) {
    if (!device || !format || !shaderCode) {
      throw new TypeError(
        "GpuCursorPass requires device, target format, and shader code"
      );
    }

    const usage = globalThis.GPUBufferUsage;
    if (!usage) {
      throw new Error("GPUBufferUsage is unavailable");
    }

    this.device = device;
    this.format = format;
    this.active = false;
    this.enabled = true;
    this.opacity = 1;
    this.uniforms = new Float32Array(12);
    this.uniformBuffer = device.createBuffer({
      label: "Lapinet cursor uniforms",
      size: this.uniforms.byteLength,
      usage: usage.UNIFORM | usage.COPY_DST,
    });

    this.shaderModule = device.createShaderModule({
      label: "Lapinet procedural cursor",
      code: shaderCode,
    });

    this.pipeline = device.createRenderPipeline({
      label: "Lapinet procedural cursor",
      layout: "auto",
      vertex: {
        module: this.shaderModule,
        entryPoint: "vertexMain",
      },
      fragment: {
        module: this.shaderModule,
        entryPoint: "fragmentMain",
        targets: [{
          format,
          blend: {
            color: {
              srcFactor: "one",
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
        topology: "triangle-list",
      },
    });

    this.bindGroup = device.createBindGroup({
      label: "Lapinet cursor bind group",
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [{
        binding: 0,
        resource: { buffer: this.uniformBuffer },
      }],
    });
  }

  update({
    pointer = [0.5, 0.5],
    active = false,
    enabled = true,
    size = 1,
    opacity = 1,
    color = "#ffffff",
    viewport = [1, 1],
  } = {}) {
    const rgba = parseHexColor(color);
    this.active = !!active;
    this.enabled = !!enabled;
    this.opacity = Math.min(Math.max(Number(opacity) || 0, 0), 1);
    this.uniforms.set([
      Math.min(Math.max(Number(pointer[0]) || 0, 0), 1),
      Math.min(Math.max(Number(pointer[1]) || 0, 0), 1),
      this.active ? 1 : 0,
      this.enabled ? 1 : 0,
      Math.min(Math.max(Number(size) || 1, 0.25), 4),
      this.opacity,
      Math.max(Number(viewport[0]) || 1, 1),
      Math.max(Number(viewport[1]) || 1, 1),
      ...rgba,
    ]);

    this.device.queue.writeBuffer(
      this.uniformBuffer,
      0,
      this.uniforms
    );
  }

  encode(encoder, { view }) {
    if (!encoder?.beginRenderPass || !view) {
      throw new TypeError("GpuCursorPass.encode requires encoder and target view");
    }
    if (!this.enabled || !this.active || this.opacity <= 0) {
      return false;
    }

    const pass = encoder.beginRenderPass({
      label: "Lapinet cursor overlay",
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
    return true;
  }

  kernelInfo() {
    return {
      id: "cursor.overlay",
      label: "GPU cursor",
      kind: "render",
      stage: "fragment",
      active: this.enabled && this.active && this.opacity > 0,
      detail: "fullscreen triangle | procedural reticule",
    };
  }

  destroy() {
    this.uniformBuffer.destroy?.();
  }
}
