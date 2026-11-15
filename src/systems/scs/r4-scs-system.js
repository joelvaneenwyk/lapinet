import {
  GPUR4ScanCurveSpectrum,
} from "../../gpu/scs/gpu-r4-scs.js";
import {
  SCS_PARTICLE_RECORDS,
  SCS_PARTICLE_STABLE_IDS,
  SCS_TOPOLOGY_DISPATCH,
} from "./fixture-particles.js";

export const R4_SCS_RESOURCES = Object.freeze({
  spatialKeys: "simulation.r4.spatialKeys",
  spatialOrder: "simulation.r4.spatialOrder",
  quantizedCells: "simulation.r4.quantizedCells",
  occupiedCellStarts: "simulation.r4.occupiedCellStarts",
  occupiedCellMetadata: "simulation.r4.occupiedCellMetadata",
  localMoments: "simulation.r4.localMoments",
  coarseLookup: "simulation.r4.coarseLookup",
  neighborConfig: "simulation.r4.neighborConfig",
});

export function r4FrequencyResourceId(bits, kind) {
  if (!Number.isInteger(bits) || bits < 1 || bits > 80) {
    throw new TypeError("R4 frequency bits must be 1..80");
  }
  if (kind !== "moments" && kind !== "particleNodeIds") {
    throw new TypeError("Unknown R4 frequency resource kind");
  }
  return `simulation.r4.frequency.${bits}.${kind}`;
}

function outputIds(prefixBits) {
  return Object.freeze([
    ...Object.values(R4_SCS_RESOURCES),
    ...prefixBits.flatMap((bits) => [
      r4FrequencyResourceId(bits, "moments"),
      r4FrequencyResourceId(bits, "particleNodeIds"),
    ]),
  ]);
}

function publishBuffer(resources, id, resource, owner, metadata) {
  resources.publish(id, {
    resource,
    owner,
    owned: false,
    metadata,
  });
}

export function createR4ScsSystem({
  count = 4096,
  cellShift = 16,
  neighborRadius = 1,
  prefixBits = [20, 40, 60, 80],
  engineFactory = (device, levelCount) =>
    GPUR4ScanCurveSpectrum.create(device, {
      maxHierarchyLevels: levelCount,
    }),
} = {}) {
  const bands = Object.freeze([...prefixBits]);
  const state = {
    engine: null,
    prepared: null,
    latest: null,
    frames: 0,
    indexedPositionVersion: -1,
  };

  const definition = {
    id: "simulation.r4-scs",
    inputs: [
      SCS_PARTICLE_RECORDS,
      SCS_PARTICLE_STABLE_IDS,
      SCS_TOPOLOGY_DISPATCH,
    ],
    after: ["simulation.topology-gate"],
    outputs: outputIds(bands),

    enabled(frame) {
      const positionVersion = Number(frame.positionVersion ?? 0);
      return (
        frame.forceSCS === true ||
        state.frames === 0 ||
        positionVersion !== state.indexedPositionVersion
      );
    },

    async initialize({ gpu, resources, system }) {
      state.engine = await engineFactory(
        gpu.device,
        bands.length
      );
      state.prepared = state.engine.prepare(count, {
        prefixBits: bands,
      });

      publishBuffer(
        resources,
        R4_SCS_RESOURCES.spatialKeys,
        state.prepared.spatialKeys,
        system.id,
        { count, format: "morton4d-80-in-u32x4" }
      );
      publishBuffer(
        resources,
        R4_SCS_RESOURCES.spatialOrder,
        state.prepared.spatialOrder,
        system.id,
        { count, format: "record-index-u32" }
      );
      publishBuffer(
        resources,
        R4_SCS_RESOURCES.quantizedCells,
        state.prepared.quantizedCells,
        system.id,
        { count, format: "r4-cell-u32x4" }
      );
      publishBuffer(
        resources,
        R4_SCS_RESOURCES.occupiedCellStarts,
        state.prepared.occupiedCellStarts,
        system.id,
        { count, format: "csr-start-u32" }
      );
      publishBuffer(
        resources,
        R4_SCS_RESOURCES.occupiedCellMetadata,
        state.prepared.occupiedCellMetadata,
        system.id,
        { format: "count-metadata-u32x4" }
      );
      publishBuffer(
        resources,
        R4_SCS_RESOURCES.localMoments,
        state.prepared.localMoments,
        system.id,
        {
          count,
          radius: neighborRadius,
          format: "neighbor-count-plus-4xi64-q16",
        }
      );

      publishBuffer(
        resources,
        R4_SCS_RESOURCES.coarseLookup,
        state.prepared.coarseLookup,
        system.id,
        {
          buckets: 1 << 20,
          format: "r4-coarse-range-atomic-u32x4",
        }
      );
      publishBuffer(
        resources,
        R4_SCS_RESOURCES.neighborConfig,
        state.prepared.neighborConfig,
        system.id,
        {
          format: "count-generation-radius-u32x4",
        }
      );

      for (const level of state.prepared.frequencyLevels) {
        publishBuffer(
          resources,
          r4FrequencyResourceId(level.prefixBits, "moments"),
          level.moments,
          system.id,
          {
            prefixBits: level.prefixBits,
            format: "count-range-plus-4xi64-q16",
          }
        );
        publishBuffer(
          resources,
          r4FrequencyResourceId(
            level.prefixBits,
            "particleNodeIds"
          ),
          level.particleNodeIDs,
          system.id,
          {
            count,
            prefixBits: level.prefixBits,
            format: "node-id-u32",
          }
        );
      }
    },

    encode({ encoder, resources, frame }) {
      state.latest = state.engine.encode(encoder, {
        records: resources.resource(SCS_PARTICLE_RECORDS),
        stableIDs: resources.resource(SCS_PARTICLE_STABLE_IDS),
        count,
        cellShift,
        neighborRadius,
        prefixBits: bands,
        topologyDispatch: resources.resource(
          SCS_TOPOLOGY_DISPATCH
        ),
      });
      state.frames += 1;
      state.indexedPositionVersion = Number(
        frame.positionVersion ?? state.frames
      );
    },

    destroy() {
      state.engine?.destroy();
      state.engine = null;
    },
  };

  const diagnostics = {
    kernelInfo() {
      return {
        id: "simulation.r4-scs",
        label: "R4 Scan-Curve-Spectrum",
        kind: "compute",
        stage: "simulation",
        active: !!state.engine,
        detail:
          `${count} particles | radius ${neighborRadius} | ` +
          `cellShift ${cellShift} | bands ${bands.join("/")}` +
          ` | frame ${state.frames}` +
          ` | position v${state.indexedPositionVersion}`,
      };
    },
  };

  return Object.freeze({
    definition,
    diagnostics,
    state,
  });
}
