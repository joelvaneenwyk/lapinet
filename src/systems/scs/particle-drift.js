import {
  PARTICLE_DRIFT_DENOM,
  SCS_PARTICLE_STATE,
} from "./fixture-particles.js";

export function createParticleDriftSystem({
  id = "simulation.particle-drift-forward",
  after = ["simulation.fixture-particles"],
  reverse = false,
  count = 4096,
  fetchImpl = globalThis.fetch,
  shaderUrl = new URL("./particle-drift.wgsl", import.meta.url),
} = {}) {
  const state = {
    pipeline: null,
    bindGroup: null,
    uniform: null,
    frames: 0,
  };

  return {
    id,
    inputs: [SCS_PARTICLE_STATE],
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
        throw new Error("Particle drift shader load failed: " + response.status);
      }
      const module = gpu.device.createShaderModule({
        label: "Lapinet reversible particle drift",
        code: await response.text(),
      });
      const info = await module.getCompilationInfo?.();
      const errors = info?.messages?.filter((m) => m.type === "error") ?? [];
      if (errors.length) {
        throw new Error(errors.map((m) => m.message).join("; "));
      }
      state.pipeline = await gpu.device.createComputePipelineAsync({
        label: "Lapinet reversible particle drift",
        layout: "auto",
        compute: { module, entryPoint: "driftParticles" },
      });
      state.uniform = gpu.device.createBuffer({
        label: "Lapinet particle drift config",
        size: 16,
        usage: usage.UNIFORM | usage.COPY_DST,
      });
      state.bindGroup = gpu.device.createBindGroup({
        label: "Lapinet particle drift bindings",
        layout: state.pipeline.getBindGroupLayout(0),
        entries: [
          {
            binding: 0,
            resource: { buffer: resources.resource(SCS_PARTICLE_STATE) },
          },
          {
            binding: 1,
            resource: { buffer: state.uniform },
          },
        ],
      });
    },

    encode({ gpu, encoder, frame }) {
      gpu.queue.writeBuffer(
        state.uniform,
        0,
        new Int32Array([
          count,
          PARTICLE_DRIFT_DENOM,
          reverse ? 1 : 0,
          0,
        ])
      );
      const pass = encoder.beginComputePass({
        label: "Lapinet reversible particle drift",
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
          label: reverse ? "Integer particle undrift" : "Integer particle drift",
          kind: "compute",
          stage: "simulation",
          active: !!state.pipeline,
          detail:
            count + " particles | denominator " +
            PARTICLE_DRIFT_DENOM + " | frame " + state.frames,
        };
      },
    },
  };
}
