import {
  SCS_PARTICLE_RECORDS,
} from "./fixture-particles.js";

export const PARTICLE_TRAIL_HISTORY =
  "simulation.particles.trailHistory";

export const PARTICLE_TRAIL_HISTORY_LENGTH = 8;

export function createParticleTrailSystem({
  count = 4096,
  historyLength = PARTICLE_TRAIL_HISTORY_LENGTH,
} = {}) {
  const length = Math.max(
    2,
    Math.trunc(Number(historyLength) || PARTICLE_TRAIL_HISTORY_LENGTH)
  );

  const state = {
    buffer: null,
    records: null,
    head: -1,
    valid: 0,
    captures: 0,
  };

  const definition = {
    id: "simulation.particle-trails",
    inputs: [SCS_PARTICLE_RECORDS],
    outputs: [PARTICLE_TRAIL_HISTORY],
    after: ["simulation.scheduled-flock-forward"],
    enabled(frame) {
      return (
        frame.forceSCS === true ||
        frame.positionsChanged !== false
      );
    },

    initialize({ gpu, resources, system }) {
      const U = globalThis.GPUBufferUsage;
      if (!U) {
        throw new Error("GPUBufferUsage is unavailable");
      }

      state.records = resources.resource(
        SCS_PARTICLE_RECORDS
      );
      state.buffer = gpu.device.createBuffer({
        label: "Lapinet scheduled particle trail history",
        size: Math.max(16, count * 16 * length),
        usage:
          U.STORAGE |
          U.COPY_DST |
          U.COPY_SRC,
      });

      resources.publish(PARTICLE_TRAIL_HISTORY, {
        resource: state.buffer,
        owner: system.id,
        owned: true,
        metadata: {
          count,
          stride: 16,
          historyLength: length,
          format: "packed-e8-site-channel-u32x4-ring",
          role: "render-only-scheduled-trajectory-history",
        },
      });
    },

    encode({ encoder }) {
      state.head = (state.head + 1) % length;
      state.valid = Math.min(state.valid + 1, length);
      state.captures += 1;

      encoder.copyBufferToBuffer(
        state.records,
        0,
        state.buffer,
        state.head * count * 16,
        count * 16
      );
    },

    destroy() {
      state.buffer = null;
      state.records = null;
    },
  };

  return Object.freeze({
    definition,

    get buffer() {
      return state.buffer;
    },

    get head() {
      return state.head;
    },

    get valid() {
      return state.valid;
    },

    get historyLength() {
      return length;
    },

    get count() {
      return count;
    },

    reset() {
      state.head = -1;
      state.valid = 0;
      state.captures = 0;
      return true;
    },

    diagnostics: {
      kernelInfo() {
        return {
          id: definition.id,
          label: "Scheduled particle trails",
          kind: "copy",
          stage: "simulation",
          active: !!state.buffer,
          detail:
            count + " particles | " +
            state.valid + "/" + length +
            " history states | captures " +
            state.captures,
        };
      },
    },
  });
}
