import {
  SCS_PARTICLE_RECORDS,
  SCS_PARTICLE_STABLE_IDS,
  SCS_TOPOLOGY_STATE,
} from "../scs/fixture-particles.js";
import {
  GPUExactSiteScheduler,
} from "./gpu-exact-site-scheduler.js";
import {
  GPUScheduledE8Stream,
} from "./gpu-scheduled-e8-stream.js";
import {
  SCHEDULED_FLOCK_STATE,
} from "./scheduled-flock.js";

export function createScheduledTransportSystem({
  count = 4096,
  seed = 17,
  threshold = 3072,
  cellShift = 17,
  flockEnabled = false,
  flockBaseWeight = 8,
  schedulerFactory = GPUExactSiteScheduler.create,
  streamFactory = GPUScheduledE8Stream.create,
} = {}) {
  const params = {
    seed: seed >>> 0,
    threshold: Math.trunc(threshold),
    flockEnabled: !!flockEnabled,
    flockBaseWeight: Math.trunc(flockBaseWeight),
  };
  const state = {
    scheduler: null,
    stream: null,
    frames: 0,
    forwardFrames: 0,
    reverseFrames: 0,
    lastFrame: null,
    lastReverse: false,
  };

  const definition = {
    id: "simulation.scheduled-transport",
    inputs: [
      SCS_PARTICLE_RECORDS,
      SCS_PARTICLE_STABLE_IDS,
      SCS_TOPOLOGY_STATE,
      SCHEDULED_FLOCK_STATE,
    ],
    outputs: [],
    after: ["simulation.scheduled-flock-reverse"],
    enabled(frame) {
      return frame.positionsChanged !== false;
    },

    async initialize({ gpu, resources }) {
      state.scheduler = await schedulerFactory(gpu.device);
      state.stream = await streamFactory(gpu.device);
      state.records = resources.resource(SCS_PARTICLE_RECORDS);
      state.stableIds = resources.resource(SCS_PARTICLE_STABLE_IDS);
      state.topology = resources.resource(SCS_TOPOLOGY_STATE);
      state.flockState = resources.resource(SCHEDULED_FLOCK_STATE);
    },

    encode({ encoder, frame }) {
      const transportFrame = Number(frame.transportFrame);
      if (
        !Number.isSafeInteger(transportFrame) ||
        transportFrame < 0
      ) {
        throw new Error(
          "scheduled transport requires nonnegative transportFrame"
        );
      }
      const reverse = !!frame.reverse;

      const streamOptions = {
        records: state.records,
        topology: state.topology,
        count,
        frame: transportFrame,
        seed: params.seed,
        threshold: params.threshold,
        cellShift,
        flockState: state.flockState,
        flockEnabled: params.flockEnabled,
        flockBaseWeight: params.flockBaseWeight,
      };

      if (reverse) {
        state.stream.encode(encoder, {
          ...streamOptions,
          reverse: true,
        });
        state.scheduler.encode(encoder, {
          records: state.records,
          stableIDs: state.stableIds,
          count,
          frame: transportFrame,
          applyCollisions: true,
        });
        state.reverseFrames += 1;
      } else {
        state.scheduler.encode(encoder, {
          records: state.records,
          stableIDs: state.stableIds,
          count,
          frame: transportFrame,
          applyCollisions: true,
        });
        state.stream.encode(encoder, streamOptions);
        state.forwardFrames += 1;
      }

      state.frames += 1;
      state.lastFrame = transportFrame;
      state.lastReverse = reverse;
    },

    async destroy() {
      state.stream?.destroy?.();
      state.scheduler?.destroy?.();
      state.stream = null;
      state.scheduler = null;
    },
  };

  const diagnostics = {
    kernelInfo() {
      const direction = state.lastReverse ? "reverse" : "forward";
      return {
        id: "simulation.scheduled-transport",
        label: "Scheduled E8 transport",
        kind: "compute",
        stage: "simulation",
        active: !!state.stream && !!state.scheduler,
        detail:
          count + " particles | frame " +
          (state.lastFrame ?? 0) + " | " + direction +
          " | threshold " + params.threshold +
          " | seed " + params.seed +
          " | flock " +
          (params.flockEnabled ? "on" : "off"),
      };
    },
  };

  return Object.freeze({
    definition,
    diagnostics,

    setParameters(next = {}) {
      if (next.seed != null) {
        const value = Number(next.seed);
        if (!Number.isSafeInteger(value)) {
          throw new TypeError("transport seed must be an integer");
        }
        params.seed = value >>> 0;
      }
      if (next.threshold != null) {
        const value = Math.trunc(Number(next.threshold));
        if (
          !Number.isFinite(value) ||
          value < 0 ||
          value > 4096
        ) {
          throw new RangeError(
            "transport threshold must be 0..4096"
          );
        }
        params.threshold = value;
      }
      if (next.flockEnabled != null) {
        params.flockEnabled = !!next.flockEnabled;
      }
      if (next.flockBaseWeight != null) {
        const value = Math.trunc(
          Number(next.flockBaseWeight)
        );
        if (!Number.isFinite(value)) {
          throw new TypeError(
            "flock base weight must be finite"
          );
        }
        params.flockBaseWeight = value;
      }
      return Object.freeze({ ...params });
    },

    parameters() {
      return Object.freeze({ ...params });
    },
  });
}
