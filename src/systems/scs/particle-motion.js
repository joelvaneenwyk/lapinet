import {
  SCS_PARTICLE_RECORDS,
  SCS_PARTICLE_STABLE_IDS,
} from "./fixture-particles.js";

export function createParticleMotionSystem({
  count = 4096,
  cadence = 1,
  fetchImpl = globalThis.fetch,
  shaderUrl = new URL("./particle-motion.wgsl", import.meta.url),
} = {}) {
  const state = {
    pipeline: null,
    bindGroup: null,
    uniform: null,
    frames: 0,
  };

  return {
    id: "simulation.particle-motion",
    inputs: [
      SCS_PARTICLE_RECORDS,
      SCS_PARTICLE_STABLE_IDS,
    ],
    outputs: [],
    after: ["simulation.fixture-particles"],
    enabled(frame) {
      if (frame.positionsChanged === false) return false;
      return (frame.frameIndex % Math.max(Math.floor(cadence), 1)) === 0;
    },

    async initialize({ gpu, resources }) {
      const usage = globalThis.GPUBufferUsage;
      if (!usage) {
        throw new Error("GPUBufferUsage is unavailable");
      }

      const response = await fetchImpl(shaderUrl);
      if (!response.ok) {
        throw new Error(
          `Particle motion shader load failed: ${response.status}`
        );
      }

      const module = gpu.device.createShaderModule({
        label: "Lapinet particle motion",
        code: await response.text(),
      });

      state.pipeline = gpu.device.createComputePipeline({
        label: "Lapinet particle motion",
        layout: "auto",
        compute: {
          module,
          entryPoint: "integrateFixtureMotion",
        },
      });
      state.uniform = gpu.device.createBuffer({
        label: "Lapinet particle motion config",
        size: 16,
        usage: usage.UNIFORM | usage.COPY_DST,
      });
      state.bindGroup = gpu.device.createBindGroup({
        label: "Lapinet particle motion bindings",
        layout: state.pipeline.getBindGroupLayout(0),
        entries: [
          {
            binding: 0,
            resource: {
              buffer: resources.resource(SCS_PARTICLE_RECORDS),
            },
          },
          {
            binding: 1,
            resource: {
              buffer: resources.resource(SCS_PARTICLE_STABLE_IDS),
            },
          },
          {
            binding: 2,
            resource: { buffer: state.uniform },
          },
        ],
      });
    },

    encode({ gpu, encoder, frame }) {
      gpu.queue.writeBuffer(
        state.uniform,
        0,
        new Uint32Array([
          count >>> 0,
          frame.frameIndex >>> 0,
          Math.max(Math.floor(cadence), 1) >>> 0,
          0,
        ])
      );

      const pass = encoder.beginComputePass({
        label: "Lapinet particle motion",
      });
      pass.setPipeline(state.pipeline);
      pass.setBindGroup(0, state.bindGroup);
      pass.dispatchWorkgroups(Math.ceil(count / 256));
      pass.end();
      state.frames += 1;
    },

    destroy() {
      state.uniform?.destroy?.();
      state.uniform = null;
      state.bindGroup = null;
      state.pipeline = null;
    },

    diagnostics: {
      kernelInfo() {
        return {
          id: "simulation.particle-motion",
          label: "Particle motion",
          kind: "compute",
          stage: "simulation",
          active: !!state.pipeline,
          detail:
            `${count} particles | cadence ${cadence} | frame ${state.frames}`,
        };
      },
    },
  };
}
