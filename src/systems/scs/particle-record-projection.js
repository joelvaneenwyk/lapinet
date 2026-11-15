import {
  SCS_PARTICLE_RECORDS,
  SCS_PARTICLE_STABLE_IDS,
  SCS_PARTICLE_STATE,
  SCS_TOPOLOGY_STATE,
  PARTICLE_POSITION_PRECISION,
} from "./fixture-particles.js";

export function createParticleRecordProjectionSystem({
  id = "simulation.particle-record-projection-forward",
  after = ["simulation.particle-drift-forward"],
  reverse = false,
  count = 4096,
  cellShift = 17,
  fetchImpl = globalThis.fetch,
  shaderUrl = new URL("./particle-record-projection.wgsl", import.meta.url),
} = {}) {
  const state = {
    pipeline: null,
    bindGroup: null,
    uniform: null,
    frames: 0,
  };

  return {
    id,
    inputs: [
      SCS_PARTICLE_STATE,
      SCS_PARTICLE_STABLE_IDS,
      SCS_PARTICLE_RECORDS,
      SCS_TOPOLOGY_STATE,
    ],
    outputs: [],
    after,
    enabled(frame) {
      if (frame.positionsChanged === false) return false;
      return !!frame.reverse === !!reverse;
    },

    async initialize({ gpu, resources }) {
      const usage = globalThis.GPUBufferUsage;
      const response = await fetchImpl(shaderUrl, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(
          "Particle projection shader load failed: " + response.status
        );
      }
      const module = gpu.device.createShaderModule({
        label: "Lapinet particle state to spatial records",
        code: await response.text(),
      });
      const info = await module.getCompilationInfo?.();
      const errors = info?.messages?.filter((m) => m.type === "error") ?? [];
      if (errors.length) {
        throw new Error(errors.map((m) => m.message).join("; "));
      }
      state.pipeline = await gpu.device.createComputePipelineAsync({
        label: "Lapinet particle state to spatial records",
        layout: "auto",
        compute: { module, entryPoint: "projectParticleRecords" },
      });
      state.uniform = gpu.device.createBuffer({
        label: "Lapinet particle projection config",
        size: 32,
        usage: usage.UNIFORM | usage.COPY_DST,
      });
      state.bindGroup = gpu.device.createBindGroup({
        label: "Lapinet particle projection bindings",
        layout: state.pipeline.getBindGroupLayout(0),
        entries: [
          {
            binding: 0,
            resource: { buffer: resources.resource(SCS_PARTICLE_STATE) },
          },
          {
            binding: 1,
            resource: { buffer: resources.resource(SCS_PARTICLE_STABLE_IDS) },
          },
          {
            binding: 2,
            resource: { buffer: resources.resource(SCS_PARTICLE_RECORDS) },
          },
          {
            binding: 3,
            resource: { buffer: state.uniform },
          },
          {
            binding: 4,
            resource: { buffer: resources.resource(SCS_TOPOLOGY_STATE) },
          },
        ],
      });
      gpu.queue.writeBuffer(
        state.uniform,
        0,
        new Int32Array([
          count, 2048, 0, 4095,
          PARTICLE_POSITION_PRECISION, cellShift, 0, 0,
        ])
      );
    },

    encode({ encoder }) {
      const pass = encoder.beginComputePass({
        label: "Lapinet particle spatial projection",
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

    diagnostics: {
      kernelInfo() {
        return {
          id,
          label: reverse
            ? "Particle spatial projection (reverse)"
            : "Particle spatial projection",
          kind: "compute",
          stage: "simulation",
          active: !!state.pipeline,
          detail:
            count +
            " integer states -> packed spatial records | cellShift " +
            cellShift + " | frame " + state.frames,
        };
      },
    },
  };
}
