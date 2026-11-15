import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  CometField,
} from "../src/fields/comet-field.js";
import {
  FractalField,
} from "../src/fields/fractal-field.js";
import {
  NoneField,
} from "../src/fields/none-field.js";
import {
  PLANE_FIELD_DEFAULT_HEIGHT,
  PlaneField,
} from "../src/fields/plane-field.js";
import {
  ImplicitSurfacePass,
} from "../src/render/implicit/implicit-surface-pass.js";

function fakeDevice() {
  const calls = [];
  const writes = [];

  const device = {
    queue: {
      writeBuffer(buffer, offset, data) {
        writes.push({
          buffer,
          offset,
          values: data instanceof ArrayBuffer
            ? [...new Float32Array(data)]
            : [...data],
        });
      },
    },
    createBuffer(descriptor) {
      const buffer = {
        descriptor,
        destroy() {},
      };
      calls.push(["buffer", descriptor]);
      return buffer;
    },
    createShaderModule(descriptor) {
      calls.push(["shader", descriptor]);
      return { descriptor };
    },
    createComputePipeline(descriptor) {
      calls.push(["pipeline", descriptor]);
      return {
        descriptor,
        getBindGroupLayout(index) {
          return { index, label: descriptor.label };
        },
      };
    },
    createBindGroup(descriptor) {
      calls.push(["bind-group", descriptor]);
      return { descriptor };
    },
  };

  return { device, calls, writes };
}

function camera() {
  return {
    snapshot() {
      return {
        position: [0, 0.35, -2.2],
        forward: [0, -0.08, 0.9968],
        right: [1, 0, 0],
        up: [0, 0.9968, 0.08],
        fovY: Math.PI / 3,
        near: 0.01,
        far: 40,
      };
    },
  };
}

function fakeGBuffer() {
  return {
    version: 1,
    views: {
      albedo: {},
      normal: {},
      material: {},
      depth: {},
    },
  };
}

test("generic implicit tracer contains no field-specific implementation", () => {
  const source = readFileSync(
    new URL(
      "../src/render/implicit/implicit-surface.wgsl",
      import.meta.url
    ),
    "utf8"
  );

  assert.match(source, /evaluateField\(p\)/);
  assert.match(source, /__FIELD_MODULE__/);
  assert.doesNotMatch(source, /fractal/i);
  assert.doesNotMatch(source, /comet/i);
  assert.doesNotMatch(source, /asteroid/i);
});

test("surface fields implement the same field ABI independently", () => {
  for (const filename of [
    "fractal-field.wgsl",
    "comet-field.wgsl",
    "plane-field.wgsl",
  ]) {
    const source = readFileSync(
      new URL("../src/fields/" + filename, import.meta.url),
      "utf8"
    );

    assert.match(
      source,
      /fn evaluateField\(p0: vec3<f32>\) -> FieldSample/
    );
    assert.match(
      source,
      /@group\(1\) @binding\(0\) var<uniform> fieldParameters/
    );
  }
});

test("field coefficient edits only write parameter buffers", () => {
  const previousUsage = globalThis.GPUBufferUsage;
  globalThis.GPUBufferUsage = {
    UNIFORM: 1,
    COPY_DST: 2,
  };

  try {
    const fake = fakeDevice();
    const fractal = new FractalField({
      device: fake.device,
      shaderSource: "fn evaluateField() {}",
    });
    const comet = new CometField({
      device: fake.device,
      shaderSource: "fn evaluateField() {}",
    });

    const initialPipelineCount = fake.calls.filter(
      ([kind]) => kind === "pipeline"
    ).length;
    const initialShaderCount = fake.calls.filter(
      ([kind]) => kind === "shader"
    ).length;
    const initialWrites = fake.writes.length;

    fractal.update({
      iterations: 17,
      safety: 0.41,
      rotationScale: [1, 2, 3, 1.77],
    });
    comet.update({
      iterations: 9,
      safety: 0.22,
      positionScale: [0, 0, 0, 0.44],
      field: [3.58, 0.03, 0.12, -1.19],
    });

    assert.equal(fake.writes.length, initialWrites + 2);
    assert.equal(
      fake.calls.filter(([kind]) => kind === "pipeline").length,
      initialPipelineCount
    );
    assert.equal(
      fake.calls.filter(([kind]) => kind === "shader").length,
      initialShaderCount
    );

    const fractalValues = fake.writes.at(-2).values;
    assert.ok(Math.abs(fractalValues[3] - 1.77) < 1e-6);
    assert.equal(fractalValues[12], 17);
    assert.ok(Math.abs(fractalValues[13] - 0.41) < 1e-6);

    const cometValues = fake.writes.at(-1).values;
    assert.ok(Math.abs(cometValues[7] - 0.44) < 1e-6);
    assert.equal(cometValues[16], 9);
    assert.ok(Math.abs(cometValues[17] - 0.22) < 1e-6);
  } finally {
    globalThis.GPUBufferUsage = previousUsage;
  }
});

test("fractal precomputes frame-constant trig and normalization", () => {
  const previousUsage = globalThis.GPUBufferUsage;
  globalThis.GPUBufferUsage = {
    UNIFORM: 1,
    COPY_DST: 2,
  };

  try {
    const fake = fakeDevice();
    const source = readFileSync(
      new URL(
        "../src/fields/fractal-field.wgsl",
        import.meta.url
      ),
      "utf8"
    );
    const fractal = new FractalField({
      device: fake.device,
      shaderSource: source,
    });

    const initialWrites = fake.writes.length;
    assert.equal(fractal.prepareFrame(0), null);
    const values = fractal.prepareFrame(1.25);

    assert.ok(values instanceof Float32Array);
    assert.equal(values.length, 32);
    assert.equal(fake.writes.length, initialWrites + 1);
    assert.doesNotMatch(source, /\bsin\s*\(/);
    assert.doesNotMatch(source, /\bcos\s*\(/);
    assert.doesNotMatch(source, /\bpow\s*\(/);
    assert.match(source, /fieldParameters\.rotation0\.xyz/);
    assert.match(source, /fieldParameters\.derived\.x/);
  } finally {
    globalThis.GPUBufferUsage = previousUsage;
  }
});

test("renderer switches field evaluators without changing tracer template", () => {
  const previousUsage = globalThis.GPUBufferUsage;
  globalThis.GPUBufferUsage = {
    UNIFORM: 1,
    COPY_DST: 2,
  };

  try {
    const fake = fakeDevice();
    const template = readFileSync(
      new URL(
        "../src/render/implicit/implicit-surface.wgsl",
        import.meta.url
      ),
      "utf8"
    );
    const fractalSource = readFileSync(
      new URL(
        "../src/fields/fractal-field.wgsl",
        import.meta.url
      ),
      "utf8"
    );
    const cometSource = readFileSync(
      new URL(
        "../src/fields/comet-field.wgsl",
        import.meta.url
      ),
      "utf8"
    );

    const fractal = new FractalField({
      device: fake.device,
      shaderSource: fractalSource,
    });
    const comet = new CometField({
      device: fake.device,
      shaderSource: cometSource,
    });

    const pass = new ImplicitSurfacePass({
      device: fake.device,
      gbuffer: fakeGBuffer(),
      camera: camera(),
      field: fractal,
      shaderTemplate: template,
    });

    const fractalRecord = pass.pipelineCache.get("fractal");
    assert.ok(fractalRecord);
    assert.equal(
      fractalRecord.code,
      template.replace("// __FIELD_MODULE__", fractalSource)
    );

    pass.setField(comet);

    const cometRecord = pass.pipelineCache.get("comet");
    assert.ok(cometRecord);
    assert.equal(
      cometRecord.code,
      template.replace("// __FIELD_MODULE__", cometSource)
    );
    assert.equal(pass.shaderTemplate, template);
    assert.equal(pass.field.id, "comet");

    const pipelineCount = fake.calls.filter(
      ([kind]) => kind === "pipeline"
    ).length;
    // Includes the permanent clear-only pipeline used by the none field.
    assert.equal(pipelineCount, 3);

    comet.update({ safety: 0.19 });

    assert.equal(
      fake.calls.filter(([kind]) => kind === "pipeline").length,
      pipelineCount
    );
  } finally {
    globalThis.GPUBufferUsage = previousUsage;
  }
});

test("G-buffer material contract already reserves reflection/refraction data", () => {
  const source = readFileSync(
    new URL(
      "../src/render/implicit/implicit-surface.wgsl",
      import.meta.url
    ),
    "utf8"
  );

  assert.match(
    source,
    /surfaceMaterial: vec4<f32>/
  );
  assert.match(
    source,
    /roughness, metallic, transmission, ior/
  );
  assert.match(
    source,
    /textureStore\(\s*gMaterial/
  );
});


test("implicit render scale reduces traced pixel dimensions quadratically", () => {
  const previousUsage = globalThis.GPUBufferUsage;
  globalThis.GPUBufferUsage = { UNIFORM: 1, COPY_DST: 2 };

  try {
    const fake = fakeDevice();
    const field = new FractalField({
      device: fake.device,
      shaderSource: "fn evaluateField() {}",
    });
    const pass = new ImplicitSurfacePass({
      device: fake.device,
      gbuffer: fakeGBuffer(),
      camera: camera(),
      field,
      shaderTemplate:
        "// __FIELD_MODULE__\n@compute @workgroup_size(8,8,1) fn implicitSurfaceMain() {}",
    });

    pass.renderScale = 0.25;
    assert.deepEqual(pass.traceSize([2880, 1800]), [720, 450]);

    pass.renderScale = 0.5;
    assert.deepEqual(pass.traceSize([2880, 1800]), [1440, 900]);

    pass.renderScale = 1;
    assert.deepEqual(pass.traceSize([2880, 1800]), [2880, 1800]);
  } finally {
    globalThis.GPUBufferUsage = previousUsage;
  }
});

test("implicit surface reuses unchanged G-buffer state", () => {
  const previousUsage = globalThis.GPUBufferUsage;
  globalThis.GPUBufferUsage = { UNIFORM: 1, COPY_DST: 2 };

  try {
    const fake = fakeDevice();
    const gbuffer = {
      version: 0,
      width: 0,
      height: 0,
      views: {
        albedo: {},
        normal: {},
        material: {},
        depth: {},
      },
      ensureSize(width, height) {
        if (this.width === width && this.height === height) {
          return false;
        }
        this.width = width;
        this.height = height;
        this.version += 1;
        return true;
      },
    };
    const field = new FractalField({
      device: fake.device,
      shaderSource: "fn evaluateField() {}",
    });
    const pass = new ImplicitSurfacePass({
      device: fake.device,
      gbuffer,
      camera: camera(),
      field,
      shaderTemplate:
        "// __FIELD_MODULE__\n@compute @workgroup_size(8,8,1) fn implicitSurfaceMain() {}",
    });

    let dispatches = 0;
    const encoder = {
      beginComputePass() {
        return {
          setPipeline() {},
          setBindGroup() {},
          dispatchWorkgroups() { dispatches += 1; },
          end() {},
        };
      },
    };

    assert.equal(
      pass.encode(encoder, { size: [640, 360], frameIndex: 0 }),
      true
    );
    assert.equal(dispatches, 1);

    assert.equal(
      pass.encode(encoder, { size: [640, 360], frameIndex: 1 }),
      false
    );
    assert.equal(dispatches, 1);
    assert.equal(pass.lastEncodeSkipped, true);

    field.update({ safety: 0.41 });
    assert.equal(
      pass.encode(encoder, { size: [640, 360], frameIndex: 2 }),
      true
    );
    assert.equal(dispatches, 2);

    pass.material.roughness = 0.2;
    assert.equal(
      pass.encode(encoder, { size: [640, 360], frameIndex: 3 }),
      true
    );
    assert.equal(dispatches, 3);
  } finally {
    globalThis.GPUBufferUsage = previousUsage;
  }
});

test("generic primary tracer uses authored field step rather than lower bound", () => {
  const source = readFileSync(
    new URL(
      "../src/render/implicit/implicit-surface.wgsl",
      import.meta.url
    ),
    "utf8"
  );

  assert.match(
    source,
    /let stepLength = clamp\(\s*sample\.step,/
  );
  assert.doesNotMatch(
    source,
    /max\(\s*sample\.step,\s*sample\.lowerBound\s*\)/
  );
});


test("plane field defaults to world y = -0.5", () => {
  const previousUsage = globalThis.GPUBufferUsage;
  globalThis.GPUBufferUsage = {
    UNIFORM: 1,
    COPY_DST: 2,
  };

  try {
    const fake = fakeDevice();
    const source = readFileSync(
      new URL(
        "../src/fields/plane-field.wgsl",
        import.meta.url
      ),
      "utf8"
    );
    const plane = new PlaneField({
      device: fake.device,
      shaderSource: source,
    });

    assert.equal(PLANE_FIELD_DEFAULT_HEIGHT, -0.5);
    assert.equal(plane.height, -0.5);
    assert.equal(fake.writes.at(-1).values[0], -0.5);
    assert.match(
      source,
      /p0\.y\s*-\s*fieldParameters\.control\.x/
    );
  } finally {
    globalThis.GPUBufferUsage = previousUsage;
  }
});

test("none field uses a clear-only implicit pipeline", () => {
  const previousUsage = globalThis.GPUBufferUsage;
  globalThis.GPUBufferUsage = {
    UNIFORM: 1,
    COPY_DST: 2,
  };

  try {
    const fake = fakeDevice();
    const template = readFileSync(
      new URL(
        "../src/render/implicit/implicit-surface.wgsl",
        import.meta.url
      ),
      "utf8"
    );
    const none = new NoneField();
    const pass = new ImplicitSurfacePass({
      device: fake.device,
      gbuffer: fakeGBuffer(),
      camera: camera(),
      field: none,
      shaderTemplate: template,
    });

    assert.equal(pass.field.id, "none");
    assert.equal(pass.field.empty, true);
    assert.equal(pass.fieldBindGroup, null);
    assert.match(pass.pipeline.descriptor.label, /none/);
    assert.equal(pass.pipelineCache.has("none"), false);
  } finally {
    globalThis.GPUBufferUsage = previousUsage;
  }
});


test("implicit intersections use pixel-footprint adaptive precision", () => {
  const source = readFileSync(
    new URL(
      "../src/render/implicit/implicit-surface.wgsl",
      import.meta.url
    ),
    "utf8"
  );

  assert.match(source, /fn hitEpsilon\(distance: f32, p: vec3<f32>\)/);
  assert.match(source, /fieldGlobals\.tracePrecision\.x/);
  assert.match(source, /let epsilon = hitEpsilon\(t, p\)/);
  assert.match(source, /var hasPrevious = false;/);
  assert.match(source, /let crossedSurface =/);
  assert.match(source, /abs\(sample\.distance\) <= epsilon/);
  assert.doesNotMatch(source, /dot\(normal, ray\) > 0\.0/);
  assert.match(source, /let normal = fieldNormal\(hit\.position, hit\.distance\)/);
  assert.match(source, /vec4<f32>\(normal, effort\)/);
});

test("implicit normals use continuous distance-adaptive probe radii", () => {
  const source = readFileSync(
    new URL(
      "../src/render/implicit/implicit-surface.wgsl",
      import.meta.url
    ),
    "utf8"
  );

  assert.match(source, /fn pixelFootprint\(distance: f32\)/);
  assert.match(source, /fn positionUlp\(p: vec3<f32>\)/);
  assert.match(source, /sqrt\(base \* base \+ footprint \* footprint\)/);
  assert.match(
    source,
    /fieldNormalWithEpsilon\(\s*p,\s*normalEpsilon\(p, distance\)\s*\)/
  );
  assert.doesNotMatch(source, /log2\(targetScale \/ base\)/);
  assert.doesNotMatch(source, /exp2\(levelFloor\)/);
  assert.match(source, /fieldNormal\(hit\.position, hit\.distance\)/);
});

test("hit distance scale is written to the implicit globals", () => {
  const previousUsage = globalThis.GPUBufferUsage;
  globalThis.GPUBufferUsage = {
    UNIFORM: 1,
    COPY_DST: 2,
  };

  try {
    const fake = fakeDevice();
    const field = new FractalField({
      device: fake.device,
      shaderSource: "fn evaluateField() {}",
    });
    const pass = new ImplicitSurfacePass({
      device: fake.device,
      gbuffer: fakeGBuffer(),
      camera: camera(),
      field,
      shaderTemplate:
        "// __FIELD_MODULE__\n@compute @workgroup_size(8,8,1) fn implicitSurfaceMain() {}",
    });

    pass.hitDistanceScale = 0.37;
    pass.updateGlobals([640, 360], 17);

    assert.ok(Math.abs(fake.writes.at(-1).values[32] - 0.37) < 1e-6);
  } finally {
    globalThis.GPUBufferUsage = previousUsage;
  }
});

test("normal distance scale is written to the implicit globals", () => {
  const previousUsage = globalThis.GPUBufferUsage;
  globalThis.GPUBufferUsage = {
    UNIFORM: 1,
    COPY_DST: 2,
  };

  try {
    const fake = fakeDevice();
    const field = new FractalField({
      device: fake.device,
      shaderSource: "fn evaluateField() {}",
    });
    const pass = new ImplicitSurfacePass({
      device: fake.device,
      gbuffer: fakeGBuffer(),
      camera: camera(),
      field,
      shaderTemplate:
        "// __FIELD_MODULE__\n@compute @workgroup_size(8,8,1) fn implicitSurfaceMain() {}",
    });

    pass.normalDistanceScale = 2.75;
    pass.updateGlobals([640, 360], 17);

    assert.equal(fake.writes.at(-1).values[27], 2.75);
  } finally {
    globalThis.GPUBufferUsage = previousUsage;
  }
});
