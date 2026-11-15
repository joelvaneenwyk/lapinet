import {
  R4_SCS_RESOURCES,
} from "../scs/r4-scs-system.js";
import {
  createH4DirectionTableQ10,
} from "./h4-directions.js";

export const SCHEDULED_FLOCK_STATE =
  "simulation.flock.scheduledState";
export const SCHEDULED_FLOCK_CENTROIDS =
  "simulation.flock.cohesionCentroids";

function usage() {
  return globalThis.GPUBufferUsage;
}

async function compile(device, shaderUrl, fetchImpl) {
  const response = await fetchImpl(shaderUrl, { cache: "no-store" });
  if (!response.ok) {
    throw new Error("scheduled flock WGSL HTTP " + response.status);
  }
  const module = device.createShaderModule({
    label: "Lapinet scheduled H4 flock",
    code: await response.text(),
  });
  const info = await module.getCompilationInfo?.();
  const errors =
    info?.messages?.filter((message) => message.type === "error") ?? [];
  if (errors.length) {
    throw new Error(
      errors.map((message) =>
        message.lineNum + ":" + message.linePos + " " + message.message
      ).join("; ")
    );
  }
  return module;
}

export function createScheduledFlockSystems({
  count = 4096,
  enabled = false,
  alignment = 12,
  coupling = 6,
  baseWeight = 4,
  cohesion = 16,
  separation = 1,
  restDistance = 2,
  positionGain = 64,
  fetchImpl = globalThis.fetch,
  shaderUrl = new URL("./scheduled-flock.wgsl", import.meta.url),
  centroidShaderUrl = new URL(
    "./scheduled-flock-centroids.wgsl",
    import.meta.url
  ),
  blockSize = 64,
} = {}) {
  const params = {
    enabled: !!enabled,
    alignment: Math.trunc(alignment),
    coupling: Math.trunc(coupling),
    baseWeight: Math.trunc(baseWeight),
    cohesion: Math.trunc(cohesion),
    separation: Math.trunc(separation),
    restDistance: Math.max(1, Math.trunc(restDistance)),
    positionGain: Math.trunc(positionGain),
    blockSize: Math.max(1, Math.min(64, Math.trunc(blockSize))),
  };

  const state = {
    pipeline: null,
    centroidPipeline: null,
    flockBuffer: null,
    centroidBuffer: null,
    centroidConfig: null,
    centroidGroup: null,
    directions: null,
    paramBuffers: [],
    groups: new Map(),
    forwardFrames: 0,
    reverseFrames: 0,
  };

  const stateSystem = {
    id: "simulation.scheduled-flock-state",
    outputs: [SCHEDULED_FLOCK_STATE, SCHEDULED_FLOCK_CENTROIDS],
    enabled: false,

    async initialize({ gpu, resources, system }) {
      const U = usage();
      const module = await compile(
        gpu.device,
        shaderUrl,
        fetchImpl
      );
      state.pipeline =
        await gpu.device.createComputePipelineAsync({
          label: "Lapinet scheduled H4 flock",
          layout: "auto",
          compute: {
            module,
            entryPoint: "flockShear",
          },
        });
      const centroidModule = await compile(
        gpu.device,
        centroidShaderUrl,
        fetchImpl
      );
      state.centroidPipeline =
        await gpu.device.createComputePipelineAsync({
          label: "Lapinet flock cohesion centroids",
          layout: "auto",
          compute: {
            module: centroidModule,
            entryPoint: "computeFlockCentroids",
          },
        });

      state.flockBuffer = gpu.device.createBuffer({
        label: "Lapinet scheduled flock steering state",
        size: Math.max(32, count * 32),
        usage:
          U.STORAGE |
          U.COPY_DST |
          U.COPY_SRC,
      });
      const centroidCount = Math.ceil(
        count / params.blockSize
      );
      state.centroidBuffer = gpu.device.createBuffer({
        label: "Lapinet flock cohesion centroids",
        size: Math.max(16, centroidCount * 16),
        usage:
          U.STORAGE |
          U.COPY_DST |
          U.COPY_SRC,
      });
      state.centroidConfig = gpu.device.createBuffer({
        label: "Lapinet flock centroid config",
        size: 16,
        usage: U.UNIFORM | U.COPY_DST,
      });
      gpu.queue.writeBuffer(
        state.centroidConfig,
        0,
        new Uint32Array([
          count,
          params.blockSize,
          0,
          0,
        ])
      );
      gpu.queue.writeBuffer(
        state.flockBuffer,
        0,
        new Int32Array(count * 8)
      );

      const directions = createH4DirectionTableQ10();
      state.directions = gpu.device.createBuffer({
        label: "Lapinet H4 direction table Q10",
        size: directions.byteLength,
        usage: U.STORAGE | U.COPY_DST,
      });
      gpu.queue.writeBuffer(
        state.directions,
        0,
        directions
      );


      state.paramBuffers = Array.from(
        { length: 4 },
        (_, operation) =>
          gpu.device.createBuffer({
            label:
              "Lapinet flock parameters op " + operation,
            size: 48,
            usage: U.UNIFORM | U.COPY_DST,
          })
      );
      updateUniforms(gpu.queue);

      resources.publish(SCHEDULED_FLOCK_STATE, {
        resource: state.flockBuffer,
        owner: system.id,
        owned: true,
        metadata: {
          count,
          stride: 32,
          format: "steer-i32x4-hidden-i32x4",
          role: "reversible-scheduled-flock-state",
        },
      });
      resources.publish(SCHEDULED_FLOCK_CENTROIDS, {
        resource: state.centroidBuffer,
        owner: system.id,
        owned: true,
        metadata: {
          count: Math.ceil(count / params.blockSize),
          stride: 16,
          blockSize: params.blockSize,
          format: "physical-h4-centroid-i32x4",
          role: "spatial-cohesion-centroids",
        },
      });
    },

    destroy() {
      state.directions?.destroy?.();
      state.centroidBuffer?.destroy?.();
      state.centroidConfig?.destroy?.();
      for (const buffer of state.paramBuffers) {
        buffer.destroy?.();
      }
      state.paramBuffers = [];
      state.groups.clear();
      state.pipeline = null;
    },

    encode() {},
  };

  function updateUniforms(queue) {
    if (!state.paramBuffers.length) return;
    for (
      let operation = 0;
      operation < state.paramBuffers.length;
      operation += 1
    ) {
      queue.writeBuffer(
        state.paramBuffers[operation],
        0,
        new Int32Array([
          count,
          operation,
          params.alignment,
          params.coupling,
          params.baseWeight,
          params.enabled ? 1 : 0,
          params.cohesion,
          params.separation,
          params.restDistance,
          params.positionGain,
          params.blockSize,
          0,
        ])
      );
    }
  }

  function encodeOperation({
    gpu,
    resources,
    encoder,
    operation,
  }) {
    const cacheKey = operation;
    let cached = state.groups.get(cacheKey);

    const buffers = [
      resources.resource(
        R4_SCS_RESOURCES.spatialOrder
      ),
      resources.resource(
        "simulation.particles.records"
      ),
      state.flockBuffer,
      state.directions,
      state.paramBuffers[operation],
      state.centroidBuffer,
    ];

    if (
      !cached ||
      !cached.buffers.every(
        (buffer, i) => buffer === buffers[i]
      )
    ) {
      const group = gpu.device.createBindGroup({
        label:
          "Lapinet scheduled flock bindings op " +
          operation,
        layout: state.pipeline.getBindGroupLayout(0),
        entries: buffers.map((buffer, binding) => ({
          binding,
          resource: { buffer },
        })),
      });
      cached = { buffers, group };
      state.groups.set(cacheKey, cached);
    }

    const pass = encoder.beginComputePass({
      label:
        "Lapinet scheduled flock op " + operation,
    });
    pass.setPipeline(state.pipeline);
    pass.setBindGroup(0, cached.group);
    pass.dispatchWorkgroups(Math.ceil(count / 128));
    pass.end();
  }

  const centroids = {
    id: "simulation.scheduled-flock-centroids",
    inputs: [
      SCHEDULED_FLOCK_STATE,
      SCHEDULED_FLOCK_CENTROIDS,
    ],
    after: ["simulation.r4-scs"],
    outputs: [],
    enabled(frame) {
      return (
        frame.forceSCS === true ||
        frame.positionsChanged !== false
      );
    },
    initialize() {},
    encode({ gpu, resources, encoder }) {
      const buffers = [
        resources.resource(
          R4_SCS_RESOURCES.spatialOrder
        ),
        resources.resource(
          "simulation.particles.records"
        ),
        state.centroidBuffer,
        state.centroidConfig,
      ];
      if (
        !state.centroidGroup ||
        !state.centroidGroup.buffers.every(
          (buffer, i) => buffer === buffers[i]
        )
      ) {
        state.centroidGroup = {
          buffers,
          group: gpu.device.createBindGroup({
            label: "Lapinet flock centroid bindings",
            layout:
              state.centroidPipeline.getBindGroupLayout(0),
            entries: buffers.map((buffer, binding) => ({
              binding,
              resource: { buffer },
            })),
          }),
        };
      }

      const pass = encoder.beginComputePass({
        label: "Lapinet flock cohesion centroids",
      });
      pass.setPipeline(state.centroidPipeline);
      pass.setBindGroup(0, state.centroidGroup.group);
      pass.dispatchWorkgroups(
        Math.ceil(count / params.blockSize)
      );
      pass.end();
    },
  };

  const reverse = {
    id: "simulation.scheduled-flock-reverse",
    inputs: [SCHEDULED_FLOCK_STATE],
    after: ["simulation.scheduled-flock-state"],
    outputs: [],
    enabled(frame) {
      return (
        params.enabled &&
        frame.positionsChanged !== false &&
        !!frame.reverse
      );
    },
    initialize() {},
    encode(context) {
      // Inverse visible shear, then inverse hidden shear.
      encodeOperation({ ...context, operation: 2 });
      encodeOperation({ ...context, operation: 3 });
      state.reverseFrames += 1;
    },
  };

  const forward = {
    id: "simulation.scheduled-flock-forward",
    inputs: [SCHEDULED_FLOCK_STATE],
    after: ["simulation.scheduled-flock-centroids"],
    outputs: [],
    enabled(frame) {
      return (
        params.enabled &&
        frame.positionsChanged !== false &&
        !frame.reverse
      );
    },
    initialize() {},
    encode(context) {
      // Hidden shear, then visible steering shear.
      encodeOperation({ ...context, operation: 0 });
      encodeOperation({ ...context, operation: 1 });
      state.forwardFrames += 1;
    },
  };

  const diagnostics = {
    kernelInfo() {
      return {
        id: "simulation.scheduled-flock",
        label: "Scheduled H4 flocking",
        kind: "compute",
        stage: "simulation",
        active: !!state.pipeline && params.enabled,
        detail:
          count + " particles | alignment " +
          params.alignment + " | coupling " +
          params.coupling + " | base " +
          params.baseWeight +
          " | cohesion " + params.cohesion +
          " | separation " + params.separation +
          " | centroid " + params.blockSize +
          " | fan 4" +
          " | forward " +
          state.forwardFrames + " | reverse " +
          state.reverseFrames,
      };
    },
  };

  return Object.freeze({
    stateSystem,
    centroids,
    reverse,
    forward,
    diagnostics,
    stateResource: SCHEDULED_FLOCK_STATE,

    setParameters(next = {}, queue = null) {
      if (next.enabled != null) {
        params.enabled = !!next.enabled;
      }
      for (const key of [
        "alignment",
        "coupling",
        "baseWeight",
        "cohesion",
        "separation",
        "positionGain",
      ]) {
        if (next[key] == null) continue;
        const value = Math.trunc(Number(next[key]));
        if (!Number.isFinite(value)) {
          throw new TypeError(
            "flock " + key + " must be finite"
          );
        }
        params[key] = value;
      }
      if (next.restDistance != null) {
        const value = Math.max(
          1,
          Math.trunc(Number(next.restDistance))
        );
        if (!Number.isFinite(value)) {
          throw new TypeError(
            "flock restDistance must be finite"
          );
        }
        params.restDistance = value;
      }
      if (queue) updateUniforms(queue);
      return Object.freeze({ ...params });
    },

    parameters() {
      return Object.freeze({ ...params });
    },

    reset(queue) {
      if (!state.flockBuffer) return false;
      queue.writeBuffer(
        state.flockBuffer,
        0,
        new Int32Array(count * 8)
      );
      return true;
    },
  });
}
