import {
  SCS_TOPOLOGY_DISPATCH,
  SCS_TOPOLOGY_STATE,
} from "./fixture-particles.js";

export function createTopologyGateSystems({
  count = 4096,
  coarseBuckets = 1 << 20,
  fetchImpl = globalThis.fetch,
  shaderUrl = new URL("./topology-gate.wgsl", import.meta.url),
} = {}) {
  const state = {
    preparePipeline: null,
    clearPipeline: null,
    prepareGroup: null,
    clearGroup: null,
    uniform: null,
    preparedFrames: 0,
    clearedFrames: 0,
  };

  const gate = {
    id: "simulation.topology-gate",
    inputs: [
      SCS_TOPOLOGY_STATE,
      SCS_TOPOLOGY_DISPATCH,
    ],
    outputs: [],
    after: ["simulation.scheduled-transport"],
    enabled(frame) {
      return frame.forceSCS === true || frame.positionsChanged !== false;
    },

    async initialize({ gpu, resources }) {
      const usage = globalThis.GPUBufferUsage;
      const response = await fetchImpl(shaderUrl, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(
          "Topology gate shader load failed: " + response.status
        );
      }
      const module = gpu.device.createShaderModule({
        label: "Lapinet topology gate",
        code: await response.text(),
      });
      const info = await module.getCompilationInfo?.();
      const errors = info?.messages?.filter((m) => m.type === "error") ?? [];
      if (errors.length) {
        throw new Error(errors.map((m) => m.message).join("; "));
      }

      state.preparePipeline = await gpu.device.createComputePipelineAsync({
        label: "Lapinet topology dispatch prepare",
        layout: "auto",
        compute: {
          module,
          entryPoint: "prepareTopologyDispatch",
        },
      });
      state.clearPipeline = await gpu.device.createComputePipelineAsync({
        label: "Lapinet topology dirty clear",
        layout: "auto",
        compute: {
          module,
          entryPoint: "clearTopologyDirty",
        },
      });
      state.uniform = gpu.device.createBuffer({
        label: "Lapinet topology gate config",
        size: 16,
        usage: usage.UNIFORM | usage.COPY_DST,
      });
      gpu.queue.writeBuffer(
        state.uniform,
        0,
        new Uint32Array([count, coarseBuckets, 0, 0])
      );

      const topology = resources.resource(SCS_TOPOLOGY_STATE);
      const dispatch = resources.resource(SCS_TOPOLOGY_DISPATCH);
      state.prepareGroup = gpu.device.createBindGroup({
        label: "Lapinet topology prepare bindings",
        layout: state.preparePipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: topology } },
          { binding: 1, resource: { buffer: dispatch } },
          { binding: 2, resource: { buffer: state.uniform } },
        ],
      });
      state.clearGroup = gpu.device.createBindGroup({
        label: "Lapinet topology clear bindings",
        layout: state.clearPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: topology } },
        ],
      });
    },

    encode({ encoder }) {
      const pass = encoder.beginComputePass({
        label: "Lapinet topology dispatch prepare",
      });
      pass.setPipeline(state.preparePipeline);
      pass.setBindGroup(0, state.prepareGroup);
      pass.dispatchWorkgroups(1);
      pass.end();
      state.preparedFrames += 1;
    },

    destroy() {
      state.uniform?.destroy?.();
    },
  };

  const clear = {
    id: "simulation.topology-clear",
    inputs: [
      SCS_TOPOLOGY_STATE,
      SCS_TOPOLOGY_DISPATCH,
    ],
    outputs: [],
    after: ["simulation.r4-scs"],
    enabled(frame) {
      return frame.forceSCS === true || frame.positionsChanged !== false;
    },

    initialize() {},

    encode({ encoder }) {
      const pass = encoder.beginComputePass({
        label: "Lapinet topology dirty clear",
      });
      pass.setPipeline(state.clearPipeline);
      pass.setBindGroup(0, state.clearGroup);
      pass.dispatchWorkgroups(1);
      pass.end();
      state.clearedFrames += 1;
    },
  };

  return Object.freeze({
    gate,
    clear,
    diagnostics: {
      kernelInfo() {
        return {
          id: "simulation.topology-gate",
          label: "Topology invalidation",
          kind: "compute",
          stage: "simulation",
          active: !!state.preparePipeline,
          detail:
            count + " particles | prepared " +
            state.preparedFrames + " | cleared " + state.clearedFrames,
        };
      },
    },
  });
}
