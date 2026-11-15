function parseHexColor(value, fallback) {
  const text = String(value ?? "").trim().toLowerCase();
  const match = /^#([0-9a-f]{6})$/.exec(text);
  if (!match) return [...fallback];
  const hex = match[1];
  return [
    parseInt(hex.slice(0, 2), 16) / 255,
    parseInt(hex.slice(2, 4), 16) / 255,
    parseInt(hex.slice(4, 6), 16) / 255,
  ];
}

function finite(value, fallback) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

export class DeferredLightingPass {
  static async create({
    device,
    format,
    gbuffer,
    camera,
    fetchImpl = globalThis.fetch,
    shaderUrl = new URL("./deferred-lighting.wgsl", import.meta.url),
  }) {
    const response = await fetchImpl(shaderUrl);
    if (!response.ok) {
      throw new Error(
        `Deferred lighting shader load failed: ${response.status}`
      );
    }

    return new DeferredLightingPass({
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
    this.clearsTarget = true;
    this.settings = {
      reconstructionEnabled: true,
      reconstructionDepthScale: 0.0125,
      reconstructionDepthMinimum: 0.0015,
      reconstructionDepthFalloff: 4,
      reconstructionNormalPower: 4,
      reconstructionNormalFloor: 0.2,
      keyDirection: [-0.45, 0.82, -0.35],
      keyIntensity: 2.2,
      keyColor: [1, 0.95, 0.82],
      ambientIntensity: 0.055,
      ambientColor: [1, 1, 1],
      rimEnabled: true,
      rimStrength: 0.18,
      rimPower: 3,
      rimColor: [0.66, 0.78, 1],
      curvatureEnabled: true,
      curvatureWeight: 0.65,
      curvatureMinimum: 0.01,
      curvatureMaximum: 0.25,
      ambientOcclusionEnabled: true,
      ambientOcclusionStrength: 0.35,
      ambientOcclusionBias: 0.05,
      ambientOcclusionRange: 1,
      ambientMetallicAttenuation: 0.65,
      ambientTransmissionAttenuation: 0.5,
      rimMetallicAttenuation: 0.5,
      ambientOcclusionBendScale: 4,
      hazeEnabled: true,
      hazeDensity: 0.08,
      hazeColor: [0.028, 0.045, 0.075],
      hazeMaxOpacity: 0.72,
      brightness: 1,
      contrast: 1,
      exposure: 1,
      gamma: 1.9,
    };

    this.uniformBuffer = device.createBuffer({
      label: "Lapinet deferred lighting globals",
      size: 304,
      usage: usage.UNIFORM | usage.COPY_DST,
    });
    this.uniformValues = new Float32Array(76);

    const module = device.createShaderModule({
      label: "Lapinet deferred lighting",
      code: shaderCode,
    });
    this.pipeline = device.createRenderPipeline({
      label: "Lapinet deferred lighting",
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
    this.bindGroup = null;
    this.boundGBufferVersion = -1;
  }

  updateSettings(values = {}) {
    const settings = this.settings;
    if ("reconstructionEnabled" in values) {
      settings.reconstructionEnabled = !!values.reconstructionEnabled;
    }
    for (const key of [
      "reconstructionDepthScale",
      "reconstructionDepthMinimum",
      "reconstructionDepthFalloff",
      "reconstructionNormalPower",
      "reconstructionNormalFloor",
      "keyIntensity",
      "ambientIntensity",
      "rimStrength",
      "rimPower",
      "curvatureWeight",
      "curvatureMinimum",
      "curvatureMaximum",
      "ambientOcclusionStrength",
      "ambientOcclusionBias",
      "ambientOcclusionRange",
      "ambientMetallicAttenuation",
      "ambientTransmissionAttenuation",
      "rimMetallicAttenuation",
      "ambientOcclusionBendScale",
      "hazeDensity",
      "hazeMaxOpacity",
      "brightness",
      "contrast",
      "exposure",
      "gamma",
    ]) {
      if (key in values) {
        settings[key] = finite(values[key], settings[key]);
      }
    }
    for (const key of [
      "rimEnabled",
      "curvatureEnabled",
      "ambientOcclusionEnabled",
      "hazeEnabled",
    ]) {
      if (key in values) settings[key] = !!values[key];
    }
    if (Array.isArray(values.keyDirection)) {
      settings.keyDirection = values.keyDirection.slice(0, 3).map(
        (value, index) => finite(value, settings.keyDirection[index])
      );
    }
    if ("keyColor" in values) {
      settings.keyColor = parseHexColor(values.keyColor, settings.keyColor);
    }
    if ("ambientColor" in values) {
      settings.ambientColor = parseHexColor(
        values.ambientColor,
        settings.ambientColor
      );
    }
    if ("rimColor" in values) {
      settings.rimColor = parseHexColor(values.rimColor, settings.rimColor);
    }
    if ("hazeColor" in values) {
      settings.hazeColor = parseHexColor(
        values.hazeColor,
        settings.hazeColor
      );
    }
    return settings;
  }

  syncBindGroup() {
    if (
      this.bindGroup &&
      this.boundGBufferVersion === this.gbuffer.version
    ) {
      return;
    }

    this.bindGroup = this.device.createBindGroup({
      label: "Lapinet deferred lighting GBuffer",
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
    const s = this.settings;
    this.uniformValues.set([
      size[0], size[1], camera.far, s.reconstructionEnabled ? 1 : 0,
      ...s.keyDirection, s.keyIntensity,
      ...s.keyColor, 0,
      ...s.ambientColor, s.ambientIntensity,
      ...camera.position, 0,
      ...camera.forward, 0,
      ...camera.right, 0,
      ...camera.up, 0,
      camera.fovY, 0, camera.far, 0,
      ...s.rimColor, s.rimStrength,
      s.rimPower,
      s.rimEnabled ? 1 : 0,
      s.curvatureEnabled ? 1 : 0,
      0,
      s.curvatureWeight,
      s.curvatureMinimum,
      s.curvatureMaximum,
      0,
      s.ambientOcclusionStrength,
      s.ambientOcclusionBias,
      s.ambientOcclusionRange,
      s.ambientOcclusionEnabled ? 1 : 0,
      ...s.hazeColor, s.hazeDensity,
      s.hazeMaxOpacity, s.hazeEnabled ? 1 : 0, 0, 0,
      s.brightness, s.contrast, s.exposure, s.gamma,
      s.reconstructionDepthScale,
      s.reconstructionDepthMinimum,
      s.reconstructionDepthFalloff,
      s.reconstructionNormalPower,
      s.reconstructionNormalFloor, 0, 0, 0,
      s.ambientMetallicAttenuation,
      s.ambientTransmissionAttenuation,
      s.rimMetallicAttenuation,
      s.ambientOcclusionBendScale,
    ]);
    this.device.queue.writeBuffer(
      this.uniformBuffer,
      0,
      this.uniformValues
    );
  }

  encode(encoder, { view, size }) {
    this.syncBindGroup();
    this.updateGlobals(size);

    const pass = encoder.beginRenderPass({
      label: "Lapinet deferred lighting",
      colorAttachments: [{
        view,
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: "clear",
        storeOp: "store",
      }],
    });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.draw(3);
    pass.end();
  }

  kernelInfo() {
    return {
      id: "deferred.lighting",
      label: "Deferred lighting",
      kind: "render",
      stage: "fragment",
      active: true,
      detail:
        "edge-aware resolve | GGX PBR | rim/curvature/AO/haze",
    };
  }

  destroy() {
    this.uniformBuffer.destroy?.();
  }
}
