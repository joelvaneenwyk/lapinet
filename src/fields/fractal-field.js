const DEFAULTS = Object.freeze({
  rotationScale: Object.freeze([32.5, 5.29, 14.13, 1.54]),
  translationScale: Object.freeze([1.08, 0.5, 1.52, 0.13]),
  rotationVelocity: Object.freeze([0, 0, 0, 0]),
  iterations: 40,
  safety: 0.58,
});

function vec4(value, fallback) {
  return [
    Number(value?.[0] ?? fallback[0]),
    Number(value?.[1] ?? fallback[1]),
    Number(value?.[2] ?? fallback[2]),
    Number(value?.[3] ?? fallback[3]),
  ];
}

function rotateEulerXYZ(v0, angles) {
  const sx = Math.sin(angles[0]);
  const cx = Math.cos(angles[0]);
  const sy = Math.sin(angles[1]);
  const cy = Math.cos(angles[1]);
  const sz = Math.sin(angles[2]);
  const cz = Math.cos(angles[2]);

  const vx = [
    v0[0],
    v0[1] * cx - v0[2] * sx,
    v0[1] * sx + v0[2] * cx,
  ];
  const vy = [
    vx[0] * cy + vx[2] * sy,
    vx[1],
    -vx[0] * sy + vx[2] * cy,
  ];
  return [
    vy[0] * cz - vy[1] * sz,
    vy[0] * sz + vy[1] * cz,
    vy[2],
  ];
}

function rotationColumns(r) {
  const a = [
    Math.cos(r[0]) * Math.cos(r[1]),
    Math.sin(r[1]),
    Math.sin(r[0]) * Math.cos(r[1]),
  ];
  const c = Math.cos(r[2]);
  const sin = Math.sin(r[2]);
  const oneMinusC = 1 - c;
  const as = a.map((value) => value * sin);
  const ac = a.map((value) => value * value * oneMinusC);
  const ad = [
    a[1] * a[2] * oneMinusC,
    a[2] * a[0] * oneMinusC,
    a[0] * a[1] * oneMinusC,
  ];

  return [
    [c + ac[0], ad[2] - as[2], ad[1] + as[1], 0],
    [ad[2] + as[2], c + ac[1], ad[0] - as[0], 0],
    [ad[1] - as[1], ad[0] + as[0], c + ac[2], 0],
  ];
}

export class FractalField {
  static async create({
    device,
    fetchImpl = globalThis.fetch,
    shaderUrl = new URL("./fractal-field.wgsl", import.meta.url),
  }) {
    const response = await fetchImpl(shaderUrl);
    if (!response.ok) {
      throw new Error(`Fractal field shader load failed: ${response.status}`);
    }

    return new FractalField({
      device,
      shaderSource: await response.text(),
    });
  }

  constructor({ device, shaderSource }) {
    const usage = globalThis.GPUBufferUsage;
    if (!usage) throw new Error("GPUBufferUsage is unavailable");

    this.id = "fractal";
    this.device = device;
    this.shaderSource = shaderSource;
    this.parameterBuffer = device.createBuffer({
      label: "Lapinet fractal field parameters",
      size: 128,
      usage: usage.UNIFORM | usage.COPY_DST,
    });
    this.parameters = { ...DEFAULTS };
    this.revision = 0;
    this.time = 0;
    this.lastPreparedTime = Number.NaN;
    this.update();
  }

  update(parameters = {}) {
    this.parameters = {
      ...this.parameters,
      ...parameters,
    };
    this.revision += 1;
    this.lastPreparedTime = Number.NaN;
    return this.prepareFrame(this.time);
  }

  prepareFrame(time = 0) {
    const nextTime = Number.isFinite(Number(time))
      ? Number(time)
      : 0;

    if (
      nextTime === this.lastPreparedTime
    ) {
      return null;
    }

    this.time = nextTime;
    this.lastPreparedTime = nextTime;

    const rotationScale = vec4(
      this.parameters.rotationScale,
      DEFAULTS.rotationScale
    );
    const translationScale = vec4(
      this.parameters.translationScale,
      DEFAULTS.translationScale
    );
    const rotationVelocity = vec4(
      this.parameters.rotationVelocity,
      DEFAULTS.rotationVelocity
    );
    const iterations = Math.min(Math.max(
      Math.round(Number(this.parameters.iterations) || 40),
      1
    ), 64);
    const safety = Math.min(Math.max(
      Number(this.parameters.safety) || DEFAULTS.safety,
      0.01
    ), 1);

    const phase = [
      rotationVelocity[0] * nextTime,
      rotationVelocity[1] * nextTime,
      rotationVelocity[2] * nextTime,
    ];
    const rotation = rotateEulerXYZ(
      rotationScale.slice(0, 3),
      phase
    );
    const columns = rotationColumns(rotation);
    const scale = rotationScale[3];
    const absScale = Math.abs(scale);
    const norm = Math.pow(
      Math.max(absScale, 1e-12),
      -(iterations + 1)
    );

    const values = new Float32Array(32);
    values.set(rotationScale, 0);
    values.set(translationScale, 4);
    values.set(rotationVelocity, 8);
    values.set([
      iterations,
      safety,
      0,
      0,
    ], 12);
    values.set(columns[0], 16);
    values.set(columns[1], 20);
    values.set(columns[2], 24);
    values.set([
      norm,
      safety,
      absScale,
      iterations,
    ], 28);

    this.device.queue.writeBuffer(this.parameterBuffer, 0, values);
    return values;
  }

  createBindGroup(pipeline) {
    return this.device.createBindGroup({
      label: "Lapinet fractal field bind group",
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
