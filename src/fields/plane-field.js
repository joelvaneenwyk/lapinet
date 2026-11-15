const DEFAULT_HEIGHT = -0.5;

export class PlaneField {
  static async create({
    device,
    fetchImpl = globalThis.fetch,
    shaderUrl = new URL("./plane-field.wgsl", import.meta.url),
  }) {
    const response = await fetchImpl(shaderUrl);
    if (!response.ok) {
      throw new Error(`Plane field shader load failed: ${response.status}`);
    }

    return new PlaneField({
      device,
      shaderSource: await response.text(),
    });
  }

  constructor({
    device,
    shaderSource,
    height = DEFAULT_HEIGHT,
  }) {
    const usage = globalThis.GPUBufferUsage;
    if (!usage) throw new Error("GPUBufferUsage is unavailable");

    this.id = "plane";
    this.device = device;
    this.shaderSource = shaderSource;
    this.parameterBuffer = device.createBuffer({
      label: "Lapinet plane field parameters",
      size: 16,
      usage: usage.UNIFORM | usage.COPY_DST,
    });
    this.height = Number(height);
    this.revision = 0;
    this.update();
  }

  update({ height = this.height } = {}) {
    this.revision += 1;
    this.height = Number.isFinite(Number(height))
      ? Number(height)
      : DEFAULT_HEIGHT;

    const values = new Float32Array([
      this.height,
      0,
      0,
      0,
    ]);
    this.device.queue.writeBuffer(
      this.parameterBuffer,
      0,
      values
    );
    return values;
  }

  createBindGroup(pipeline) {
    return this.device.createBindGroup({
      label: "Lapinet plane field bind group",
      layout: pipeline.getBindGroupLayout(1),
      entries: [{
        binding: 0,
        resource: { buffer: this.parameterBuffer },
      }],
    });
  }

  destroy() {
    this.parameterBuffer.destroy?.();
  }
}

export { DEFAULT_HEIGHT as PLANE_FIELD_DEFAULT_HEIGHT };
