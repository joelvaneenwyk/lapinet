const DEFAULTS = Object.freeze({
  rotationScale: Object.freeze([0, 0, 0, 1.95]),
  positionScale: Object.freeze([0, 0, 0, 0.27]),
  foldWeight: Object.freeze([0.025, 1.69, 5.85, 0.02]),
  field: Object.freeze([3.58, 0.015, -0.00899, -1.19]),
  iterations: 16,
  safety: 0.35,
});

function vec4(value, fallback) {
  return [
    Number(value?.[0] ?? fallback[0]),
    Number(value?.[1] ?? fallback[1]),
    Number(value?.[2] ?? fallback[2]),
    Number(value?.[3] ?? fallback[3]),
  ];
}

export class CometField {
  static async create({
    device,
    fetchImpl = globalThis.fetch,
    shaderUrl = new URL("./comet-field.wgsl", import.meta.url),
  }) {
    const response = await fetchImpl(shaderUrl);
    if (!response.ok) {
      throw new Error(`Comet field shader load failed: ${response.status}`);
    }

    return new CometField({
      device,
      shaderSource: await response.text(),
    });
  }

  constructor({ device, shaderSource }) {
    const usage = globalThis.GPUBufferUsage;
    if (!usage) throw new Error("GPUBufferUsage is unavailable");

    this.id = "comet";
    this.device = device;
    this.shaderSource = shaderSource;
    this.parameterBuffer = device.createBuffer({
      label: "Lapinet comet field parameters",
      size: 80,
      usage: usage.UNIFORM | usage.COPY_DST,
    });
    this.parameters = { ...DEFAULTS };
    this.revision = 0;
    this.update();
  }

  update(parameters = {}) {
    this.parameters = {
      ...this.parameters,
      ...parameters,
    };
    this.revision += 1;

    const values = new Float32Array(20);
    values.set(vec4(
      this.parameters.rotationScale,
      DEFAULTS.rotationScale
    ), 0);
    values.set(vec4(
      this.parameters.positionScale,
      DEFAULTS.positionScale
    ), 4);
    values.set(vec4(
      this.parameters.foldWeight,
      DEFAULTS.foldWeight
    ), 8);
    values.set(vec4(
      this.parameters.field,
      DEFAULTS.field
    ), 12);
    values.set([
      Math.min(Math.max(
        Math.round(Number(this.parameters.iterations) || 16),
        1
      ), 64),
      Math.min(Math.max(
        Number(this.parameters.safety) || DEFAULTS.safety,
        0.01
      ), 1),
      0,
      0,
    ], 16);

    this.device.queue.writeBuffer(this.parameterBuffer, 0, values);
    return values;
  }

  createBindGroup(pipeline) {
    return this.device.createBindGroup({
      label: "Lapinet comet field bind group",
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
