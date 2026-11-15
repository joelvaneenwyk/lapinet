const FIELD_MARKER = "// __FIELD_MODULE__";

const EMPTY_FIELD_SHADER = `
struct FieldGlobals {
  resolutionSteps: vec4<u32>,
  trace: vec4<f32>,
  cameraPosition: vec4<f32>,
  cameraForward: vec4<f32>,
  cameraRight: vec4<f32>,
  cameraUp: vec4<f32>,
  march: vec4<f32>,
  surfaceMaterial: vec4<f32>,
  tracePrecision: vec4<f32>,
  surfaceColor: vec4<f32>,
};

@group(0) @binding(0) var<uniform> fieldGlobals: FieldGlobals;
@group(0) @binding(1) var gAlbedo:
  texture_storage_2d<rgba16float, write>;
@group(0) @binding(2) var gNormal:
  texture_storage_2d<rgba16float, write>;
@group(0) @binding(3) var gMaterial:
  texture_storage_2d<rgba16float, write>;
@group(0) @binding(4) var gDepth:
  texture_storage_2d<r32float, write>;

@compute @workgroup_size(8, 8, 1)
fn implicitSurfaceMain(
  @builtin(global_invocation_id) id: vec3<u32>
) {
  let resolution = fieldGlobals.resolutionSteps.xy;
  if (id.x >= resolution.x || id.y >= resolution.y) {
    return;
  }

  let coord = vec2<i32>(id.xy);
  textureStore(gAlbedo, coord, vec4<f32>(0.0));
  textureStore(gNormal, coord, vec4<f32>(0.0));
  textureStore(gMaterial, coord, vec4<f32>(0.0));
  textureStore(
    gDepth,
    coord,
    vec4<f32>(fieldGlobals.trace.w, 0.0, 0.0, 0.0)
  );
}
`;

export class ImplicitSurfacePass {
  static async create({
    device,
    gbuffer,
    camera,
    field,
    fetchImpl = globalThis.fetch,
    shaderUrl = new URL("./implicit-surface.wgsl", import.meta.url),
  }) {
    const response = await fetchImpl(shaderUrl);
    if (!response.ok) {
      throw new Error(
        `Implicit surface shader load failed: ${response.status}`
      );
    }

    return new ImplicitSurfacePass({
      device,
      gbuffer,
      camera,
      field,
      shaderTemplate: await response.text(),
    });
  }

  constructor({
    device,
    gbuffer,
    camera,
    field,
    shaderTemplate,
  }) {
    const usage = globalThis.GPUBufferUsage;
    if (!usage) throw new Error("GPUBufferUsage is unavailable");

    this.device = device;
    this.gbuffer = gbuffer;
    this.camera = camera;
    this.shaderTemplate = shaderTemplate;
    this.commonBuffer = device.createBuffer({
      label: "Lapinet implicit surface globals",
      size: 160,
      usage: usage.UNIFORM | usage.COPY_DST,
    });
    const emptyModule = device.createShaderModule({
      label: "Lapinet implicit surface: none",
      code: EMPTY_FIELD_SHADER,
    });
    this.emptyPipeline = device.createComputePipeline({
      label: "Lapinet implicit surface: none",
      layout: "auto",
      compute: {
        module: emptyModule,
        entryPoint: "implicitSurfaceMain",
      },
    });
    this.pipelineCache = new Map();
    this.commonBindGroup = null;
    this.boundGBufferVersion = -1;
    this.field = null;
    this.pipeline = null;
    this.fieldBindGroup = null;
    this.renderScale = 0.5;
    this.maxSteps = 192;
    this.hitEpsilon = 0.00000001;
    this.hitDistanceScale = 0.05;
    this.normalEpsilon = 0.00000001;
    this.normalDistanceScale = 0.5;
    this.maxStep = 0.25;
    this.material = {
      color: "#adbacc",
      roughness: 0.55,
      metallic: 0.0,
      transmission: 0.0,
      ior: 1.45,
    };
    this.time = 0;
    this.lastRenderSignature = null;
    this.lastEncodeSkipped = false;
    this.setField(field);
  }

  compileField(field) {
    if (field?.empty === true) {
      return {
        pipeline: this.emptyPipeline,
        fieldBindGroup: null,
        code: EMPTY_FIELD_SHADER,
      };
    }

    if (!field?.id || !field?.shaderSource || !field?.createBindGroup) {
      throw new TypeError(
        "Implicit field requires id, shaderSource, and createBindGroup()"
      );
    }

    if (this.pipelineCache.has(field.id)) {
      return this.pipelineCache.get(field.id);
    }

    if (!this.shaderTemplate.includes(FIELD_MARKER)) {
      throw new Error("Implicit surface shader is missing field marker");
    }

    const code = this.shaderTemplate.replace(
      FIELD_MARKER,
      field.shaderSource
    );
    const module = this.device.createShaderModule({
      label: `Lapinet implicit surface: ${field.id}`,
      code,
    });
    const pipeline = this.device.createComputePipeline({
      label: `Lapinet implicit surface: ${field.id}`,
      layout: "auto",
      compute: {
        module,
        entryPoint: "implicitSurfaceMain",
      },
    });
    const record = {
      pipeline,
      fieldBindGroup: field.createBindGroup(pipeline),
      code,
    };
    this.pipelineCache.set(field.id, record);
    return record;
  }

  setField(field) {
    const record = this.compileField(field);
    this.field = field;
    this.pipeline = record.pipeline;
    this.fieldBindGroup = record.fieldBindGroup;
    this.commonBindGroup = null;
    this.boundGBufferVersion = -1;
    this.lastRenderSignature = null;
    return field;
  }

  frameSignature(size, camera) {
    return [
      size[0],
      size[1],
      this.field?.id ?? "none",
      this.field?.revision ?? 0,
      this.time,
      camera.fovY,
      camera.far,
      ...camera.position,
      ...camera.forward,
      ...camera.right,
      ...camera.up,
      this.maxSteps,
      this.hitEpsilon,
      this.hitDistanceScale,
      this.normalEpsilon,
      this.normalDistanceScale,
      this.maxStep,
      this.material.color,
      this.material.roughness,
      this.material.metallic,
      this.material.transmission,
      this.material.ior,
    ].join("|");
  }

  updateGlobals(
    size,
    frameIndex = 0,
    camera = this.camera.snapshot()
  ) {
    const buffer = new ArrayBuffer(160);
    const u32 = new Uint32Array(buffer);
    const f32 = new Float32Array(buffer);

    u32[0] = size[0] >>> 0;
    u32[1] = size[1] >>> 0;
    u32[2] = Math.min(Math.max(
      Math.round(this.maxSteps),
      1
    ), 4096) >>> 0;

    f32.set([
      this.time,
      camera.fovY,
      0,
      camera.far,
    ], 4);
    f32.set([...camera.position, 0], 8);
    f32.set([...camera.forward, 0], 12);
    f32.set([...camera.right, 0], 16);
    f32.set([...camera.up, 0], 20);
    f32.set([
      Math.max(this.hitEpsilon, 1e-10),
      Math.max(this.normalEpsilon, 1e-10),
      Math.max(this.maxStep, 1e-5),
      Math.max(this.normalDistanceScale, 0),
    ], 24);
    f32.set([
      Math.min(Math.max(this.material.roughness, 0), 1),
      Math.min(Math.max(this.material.metallic, 0), 1),
      Math.min(Math.max(this.material.transmission, 0), 1),
      Math.max(this.material.ior, 1),
    ], 28);
    f32.set([
      Math.max(this.hitDistanceScale, 0),
      0,
      0,
      0,
    ], 32);
    const materialColor = /^#[0-9a-f]{6}$/i.test(
      String(this.material.color ?? "")
    )
      ? [
          parseInt(this.material.color.slice(1, 3), 16) / 255,
          parseInt(this.material.color.slice(3, 5), 16) / 255,
          parseInt(this.material.color.slice(5, 7), 16) / 255,
        ]
      : [0.68, 0.73, 0.80];
    f32.set([
      ...materialColor,
      1,
    ], 36);

    this.device.queue.writeBuffer(this.commonBuffer, 0, buffer);
  }

  syncCommonBindGroup() {
    if (
      this.commonBindGroup &&
      this.boundGBufferVersion === this.gbuffer.version
    ) {
      return;
    }

    this.commonBindGroup = this.device.createBindGroup({
      label: "Lapinet implicit GBuffer bind group",
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.commonBuffer } },
        { binding: 1, resource: this.gbuffer.views.albedo },
        { binding: 2, resource: this.gbuffer.views.normal },
        { binding: 3, resource: this.gbuffer.views.material },
        { binding: 4, resource: this.gbuffer.views.depth },
      ],
    });
    this.boundGBufferVersion = this.gbuffer.version;
  }

  traceSize(size) {
    const scale = Math.min(
      Math.max(Number(this.renderScale) || 1, 0.125),
      1
    );
    return Object.freeze([
      Math.max(Math.round(size[0] * scale), 1),
      Math.max(Math.round(size[1] * scale), 1),
    ]);
  }

  encode(encoder, { size, frameIndex }) {
    const traceSize = this.traceSize(size);

    this.field?.prepareFrame?.(this.time);
    const resized = this.gbuffer.ensureSize(
      traceSize[0],
      traceSize[1]
    );
    const camera = this.camera.snapshot();
    const signature = this.frameSignature(
      traceSize,
      camera
    );

    if (
      !resized &&
      signature === this.lastRenderSignature
    ) {
      this.lastEncodeSkipped = true;
      return false;
    }

    this.syncCommonBindGroup();
    this.updateGlobals(
      traceSize,
      frameIndex,
      camera
    );

    const pass = encoder.beginComputePass({
      label: `Lapinet implicit surface: ${this.field.id}`,
    });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.commonBindGroup);
    if (this.fieldBindGroup) {
      pass.setBindGroup(1, this.fieldBindGroup);
    }
    pass.dispatchWorkgroups(
      Math.ceil(traceSize[0] / 8),
      Math.ceil(traceSize[1] / 8),
      1
    );
    pass.end();

    this.lastRenderSignature = signature;
    this.lastEncodeSkipped = false;
    return true;
  }

  kernelInfo() {
    return {
      id: "implicit.surface",
      label: "Implicit surface",
      kind: "compute",
      stage: "compute",
      active: true,
      detail:
        `8x8 | field ${this.field?.id ?? "none"} | scale ${this.renderScale} | max ${this.maxSteps}` +
        `${this.lastEncodeSkipped ? " | cached" : ""}`,
    };
  }

  destroy() {
    this.commonBuffer.destroy?.();
  }
}
