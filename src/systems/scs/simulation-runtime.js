import {
  GpuScheduler,
} from "../../gpu/scheduler.js";
import {
  createScsFixtureData,
  createScsFixtureSystem,
  SCS_PARTICLE_RECORDS,
  SCS_PARTICLE_STABLE_IDS,
  SCS_PARTICLE_STATE,
  SCS_TOPOLOGY_STATE,
} from "./fixture-particles.js";
import {
  createR4ScsSystem,
} from "./r4-scs-system.js";
import {
  createTopologyGateSystems,
} from "./topology-gate.js";
import {
  createScheduledTransportSystem,
} from "../scheduled-transport/scheduled-transport-system.js";
import {
  createScheduledFlockSystems,
} from "../scheduled-transport/scheduled-flock.js";
import {
  createParticleTrailSystem,
} from "./particle-trails.js";

export async function createScsSimulationRuntime({
  gpu,
  count = 4096,
  cellShift = 17,
  neighborRadius = 1,
  prefixBits = [20, 40, 60, 80],
  playbackHz = 30,
  engineFactory,
  transportFactory = createScheduledTransportSystem,
  flockFactory = createScheduledFlockSystems,
  trailFactory = createParticleTrailSystem,
  topologyFactory = createTopologyGateSystems,
  transport = {},
  flock = {},
  setTimer = globalThis.setTimeout,
  clearTimer = globalThis.clearTimeout,
  now = () => globalThis.performance?.now?.() ?? Date.now(),
} = {}) {
  if (!gpu) {
    throw new TypeError("SCS simulation runtime requires GpuContext");
  }

  const scheduler = new GpuScheduler({ gpu });
  const locality = createR4ScsSystem({
    count,
    cellShift,
    neighborRadius,
    prefixBits,
    engineFactory,
  });
  const scheduledFlock = flockFactory({
    count,
    ...flock,
  });
  const flockParams = scheduledFlock.parameters?.() ?? flock;
  const scheduledTransport = transportFactory({
    count,
    cellShift,
    ...transport,
    flockEnabled: !!flockParams.enabled,
    flockBaseWeight: flockParams.baseWeight ?? 8,
  });
  const topology = topologyFactory({ count });
  const particleTrails = trailFactory({ count });

  scheduler.register(createScsFixtureSystem({ count }));
  scheduler.register(scheduledFlock.stateSystem);
  scheduler.register(scheduledFlock.reverse);
  scheduler.register(
    scheduledTransport.definition ?? scheduledTransport
  );
  scheduler.register(topology.gate);
  scheduler.register(locality.definition);
  scheduler.register(scheduledFlock.centroids);
  scheduler.register(topology.clear);
  scheduler.register(scheduledFlock.forward);
  scheduler.register(
    particleTrails.definition ?? particleTrails
  );

  try {
    await scheduler.initialize();
  } catch (error) {
    await scheduler.destroy().catch(() => {});
    throw error;
  }

  scheduler.tick({
    transportFrame: 0,
    reverse: false,
    positionsChanged: false,
    forceSCS: true,
    positionVersion: 0,
    source: "initial-index",
  });
  await gpu.queue.onSubmittedWorkDone?.();

  let running = false;
  let paused = false;
  let timer = null;
  let lastError = null;
  let positionVersion = 0;
  let transportFrame = 0;
  let direction = 1;

  let playbackRate = Math.max(
    Number(playbackHz) || 30,
    0.001
  );
  let intervalMs = 1000 / playbackRate;

  const step = ({ reverse = direction < 0 } = {}) => {
    const backwards = !!reverse;
    if (backwards && transportFrame === 0) {
      return null;
    }

    const frame = backwards
      ? transportFrame - 1
      : transportFrame;

    positionVersion += 1;
    const submitted = scheduler.tick({
      transportFrame: frame,
      reverse: backwards,
      positionsChanged: true,
      positionVersion,
      source: backwards
        ? "scheduled-reverse"
        : "scheduled-forward",
    });

    transportFrame += backwards ? -1 : 1;
    return submitted;
  };

  const tick = (frame = {}) =>
    step({
      reverse:
        frame.reverse == null
          ? direction < 0
          : !!frame.reverse,
    });

  const schedule = (delayMs = intervalMs) => {
    if (!running || timer != null) return;

    timer = setTimer(async () => {
      timer = null;
      if (!running) return;

      const startedAt = now();
      try {
        if (!paused) {
          const submitted = tick();
          if (submitted) {
            await gpu.queue.onSubmittedWorkDone?.();
          }
        }
      } catch (error) {
        lastError = error;
        running = false;
        return;
      }

      const workMs = Math.max(0, now() - startedAt);
      schedule(Math.max(0, intervalMs - workMs));
    }, Math.max(0, delayMs));
  };

  const runtime = {
    gpu,
    scheduler,
    resources: scheduler.resources,
    diagnostics: locality.diagnostics,
    transportDiagnostics:
      scheduledTransport.diagnostics ?? null,
    topologyDiagnostics: topology.diagnostics ?? null,
    flockDiagnostics: scheduledFlock.diagnostics ?? null,
    trailDiagnostics: particleTrails.diagnostics ?? null,
    trailHistory: particleTrails,

    get running() {
      return running;
    },

    get paused() {
      return paused;
    },

    get lastError() {
      return lastError;
    },

    get positionVersion() {
      return positionVersion;
    },

    get transportFrame() {
      return transportFrame;
    },

    get direction() {
      return direction > 0 ? "forward" : "reverse";
    },

    get playbackHz() {
      return playbackRate;
    },

    tick,
    stepForward() {
      return step({ reverse: false });
    },
    stepReverse() {
      return step({ reverse: true });
    },

    start() {
      if (running) return false;
      running = true;
      schedule();
      return true;
    },

    stop() {
      if (!running && timer == null) return false;
      running = false;
      if (timer != null) {
        clearTimer(timer);
        timer = null;
      }
      return true;
    },

    setPaused(value) {
      paused = !!value;
      return paused;
    },

    setPlaybackHz(value) {
      const next = Number(value);
      if (!Number.isFinite(next) || next <= 0) {
        throw new RangeError(
          "playback rate must be a positive finite number"
        );
      }
      playbackRate = next;
      intervalMs = 1000 / playbackRate;
      return playbackRate;
    },

    setDirection(value) {
      if (
        value === "forward" ||
        value === 1 ||
        value === true
      ) {
        direction = 1;
      } else if (
        value === "reverse" ||
        value === -1
      ) {
        direction = -1;
      } else {
        throw new TypeError(
          "simulation direction must be forward or reverse"
        );
      }
      return runtime.direction;
    },

    setTransportParameters(parameters) {
      return scheduledTransport.setParameters?.(parameters) ?? null;
    },

    setFlockParameters(parameters) {
      const values = scheduledFlock.setParameters?.(
        parameters,
        gpu.queue
      ) ?? null;
      if (values) {
        scheduledTransport.setParameters?.({
          flockEnabled: values.enabled,
          flockBaseWeight: values.baseWeight,
        });
      }
      return values;
    },

    reset() {
      const resume = running;
      runtime.stop();

      const fixture = createScsFixtureData(count);
      gpu.queue.writeBuffer(
        runtime.resources.resource(SCS_PARTICLE_RECORDS),
        0,
        fixture.records
      );
      gpu.queue.writeBuffer(
        runtime.resources.resource(SCS_PARTICLE_STABLE_IDS),
        0,
        fixture.stableIds
      );

      const legacyState =
        runtime.resources.get(SCS_PARTICLE_STATE)?.resource;
      if (legacyState && fixture.state) {
        gpu.queue.writeBuffer(
          legacyState,
          0,
          fixture.state
        );
      }

      scheduledFlock.reset?.(gpu.queue);
      particleTrails.reset?.();

      const topology =
        runtime.resources.get(SCS_TOPOLOGY_STATE)?.resource;
      if (topology) {
        gpu.queue.writeBuffer(
          topology,
          0,
          new Uint32Array([1, 0, 0, 0])
        );
      }

      scheduler.frameIndex = 0;
      transportFrame = 0;
      positionVersion += 1;
      lastError = null;

      scheduler.tick({
        transportFrame: 0,
        reverse: false,
        positionsChanged: false,
        forceSCS: true,
        positionVersion,
        source: "reset",
      });

      if (resume) runtime.start();
      return true;
    },

    async destroy() {
      runtime.stop();
      await scheduler.destroy();
    },
  };

  return Object.freeze(runtime);
}
