import {
  SCS_PARTICLE_STATE,
  PARTICLE_POSITION_PRECISION,
} from "./fixture-particles.js";
import {
  R4_SCS_RESOURCES,
} from "./r4-scs-system.js";

export function createParticleContactKickSystem({
  count = 4096,
  gravityY = 32,
  groundY = -25,
  groundStiffness = 48,
  contactStiffness = 18,
  contactCutoffSquared = 3,
  contactRestSquared = 1,
  maxPairScalar = 3,
  fetchImpl = globalThis.fetch,
  shaderUrl = new URL("./particle-contact-kick.wgsl", import.meta.url),
} = {}) {
  const params = {
    gravityY,
    groundY,
    groundStiffness,
    contactStiffness,
    contactCutoffSquared,
    contactRestSquared,
    maxPairScalar,
  };
  const state = {
    pipeline: null,
    bindGroup: null,
    uniform: null,
    frames: 0,
  };

  const writeParams = (gpu) => {
    gpu.queue.writeBuffer(
      state.uniform,
      0,
      new Int32Array([
        count,
        PARTICLE_POSITION_PRECISION,
        params.contactCutoffSquared,
        params.contactRestSquared,
        params.contactStiffness,
        params.gravityY,
        params.groundY * PARTICLE_POSITION_PRECISION,
        params.groundStiffness,
        params.maxPairScalar,
        0, 0, 0,
      ])
    );
  };

  const definition = {
    id: "simulation.particle-contact-kick",
    inputs: [
      SCS_PARTICLE_STATE,
      R4_SCS_RESOURCES.spatialKeys,
      R4_SCS_RESOURCES.spatialOrder,
      R4_SCS_RESOURCES.quantizedCells,
      R4_SCS_RESOURCES.occupiedCellStarts,
      R4_SCS_RESOURCES.occupiedCellMetadata,
      R4_SCS_RESOURCES.coarseLookup,
      R4_SCS_RESOURCES.neighborConfig,
    ],
    outputs: [],
    after: ["simulation.r4-scs"],
    enabled(frame) {
      return frame.positionsChanged !== false;
    },

    async initialize({ gpu, resources }) {
      const usage = globalThis.GPUBufferUsage;
      const response = await fetchImpl(shaderUrl, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(
          "Particle contact shader load failed: " + response.status
        );
      }
      const module = gpu.device.createShaderModule({
        label: "Lapinet SCS integer contact kick",
        code: await response.text(),
      });
      const info = await module.getCompilationInfo?.();
      const errors = info?.messages?.filter((m) => m.type === "error") ?? [];
      if (errors.length) {
        throw new Error(errors.map((m) => m.message).join("; "));
      }
      state.pipeline = await gpu.device.createComputePipelineAsync({
        label: "Lapinet SCS integer contact kick",
        layout: "auto",
        compute: { module, entryPoint: "kickParticles" },
      });
      state.uniform = gpu.device.createBuffer({
        label: "Lapinet contact physics config",
        size: 48,
        usage: usage.UNIFORM | usage.COPY_DST,
      });
      const ids = [
        [0, SCS_PARTICLE_STATE],
        [1, R4_SCS_RESOURCES.spatialKeys],
        [2, R4_SCS_RESOURCES.spatialOrder],
        [3, R4_SCS_RESOURCES.quantizedCells],
        [4, R4_SCS_RESOURCES.occupiedCellStarts],
        [5, R4_SCS_RESOURCES.occupiedCellMetadata],
        [6, R4_SCS_RESOURCES.coarseLookup],
        [7, R4_SCS_RESOURCES.neighborConfig],
      ];
      state.bindGroup = gpu.device.createBindGroup({
        label: "Lapinet SCS integer contact bindings",
        layout: state.pipeline.getBindGroupLayout(0),
        entries: ids.map(([binding, id]) => ({
          binding,
          resource: { buffer: resources.resource(id) },
        })).concat([{
          binding: 8,
          resource: { buffer: state.uniform },
        }]),
      });
      writeParams(gpu);
    },

    encode({ gpu, encoder }) {
      writeParams(gpu);
      const pass = encoder.beginComputePass({
        label: "Lapinet SCS integer contact kick",
      });
      pass.setPipeline(state.pipeline);
      pass.setBindGroup(0, state.bindGroup);
      pass.dispatchWorkgroups(Math.ceil(count / 256));
      pass.end();
      state.frames += 1;
    },

    destroy() {
      state.uniform?.destroy?.();
    },
  };

  const diagnostics = {
    kernelInfo() {
      return {
        id: "simulation.particle-contact-kick",
        label: "SCS integer contacts",
        kind: "compute",
        stage: "simulation",
        active: !!state.pipeline,
        detail:
          count + " particles | cutoff2 " +
          params.contactCutoffSquared +
          " | gravity " + params.gravityY +
          " | ground y " + params.groundY +
          " | frame " + state.frames,
      };
    },
  };

  return Object.freeze({
    definition,
    diagnostics,
    setParameters(next = {}) {
      for (const key of Object.keys(params)) {
        if (next[key] != null && Number.isFinite(Number(next[key]))) {
          params[key] = Math.trunc(Number(next[key]));
        }
      }
      return Object.freeze({ ...params });
    },
    parameters() {
      return Object.freeze({ ...params });
    },
  });
}
