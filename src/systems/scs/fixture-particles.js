import {
  E8_H4_CHANNELS,
  E8_ROOT_STEPS,
} from "../scheduled-transport/noether/icosian-e8.mjs";

export const SCS_PARTICLE_RECORDS = "simulation.particles.records";
export const SCS_PARTICLE_STABLE_IDS = "simulation.particles.stableIds";
export const SCS_PARTICLE_STATE = "simulation.particles.state";
export const SCS_TOPOLOGY_STATE = "simulation.topology.state";
export const SCS_TOPOLOGY_DISPATCH = "simulation.topology.dispatch";

export const PARTICLE_STATE_STRIDE_BYTES = 32;
export const PARTICLE_DRIFT_DENOM = 256;
export const PARTICLE_POSITION_PRECISION = 32;
export const FIXTURE_ROOT_STEPS = 4;
export const FIXTURE_ROOT_SCALE = 32;

function packE8(coords, channel = 0) {
  const k = coords;
  return [
    (
      k[0] |
      (k[1] << 12) |
      ((k[2] & 255) << 24)
    ) >>> 0,
    (
      (k[2] >>> 8) |
      (k[3] << 4) |
      (k[4] << 16) |
      ((k[5] & 15) << 28)
    ) >>> 0,
    (
      (k[5] >>> 4) |
      (k[6] << 8) |
      (k[7] << 20)
    ) >>> 0,
    channel >>> 0,
  ];
}

function stableId(index) {
  return (
    Math.imul(index + 1, 2654435761) ^ 0xa5a5a5a5
  ) >>> 0;
}

function mix32(value) {
  let y = value >>> 0;
  y ^= y >>> 16;
  y = Math.imul(y, 0x7feb352d);
  y ^= y >>> 15;
  y = Math.imul(y, 0x846ca68b);
  return (y ^ (y >>> 16)) >>> 0;
}

export function createIsotropicE8Seed(index) {
  const id = stableId(index);
  let h = (id ^ 0x9e3779b9) >>> 0;
  const k = new Int32Array(8);

  for (
    let step = 0;
    step < FIXTURE_ROOT_STEPS;
    step += 1
  ) {
    h = mix32(
      h ^ Math.imul(step + 1, 0x85ebca6b)
    );
    const root = E8_ROOT_STEPS[h % E8_H4_CHANNELS];

    for (let axis = 0; axis < 8; axis += 1) {
      k[axis] += root[axis];
    }
  }

  for (let axis = 0; axis < 8; axis += 1) {
    k[axis] *= FIXTURE_ROOT_SCALE;
  }

  return k;
}

export function createScsFixtureData(count) {
  if (!Number.isInteger(count) || count < 1) {
    throw new TypeError(
      "SCS fixture count must be a positive integer"
    );
  }

  const records = new Uint32Array(count * 4);
  const stableIds = new Uint32Array(count);
  const state = new Int32Array(count * 8);

  for (let i = 0; i < count; i += 1) {
    const id = stableId(i);
    const signed = createIsotropicE8Seed(i);
    const coords = Array.from(
      signed,
      (value) => value & 4095
    );
    const channel =
      mix32(id ^ 0xc2b2ae35) % 240;

    state.set([
      signed[0] * PARTICLE_POSITION_PRECISION,
      signed[1] * PARTICLE_POSITION_PRECISION,
      signed[2] * PARTICLE_POSITION_PRECISION,
      signed[3] * PARTICLE_POSITION_PRECISION,
      0, 0, 0, 0,
    ], i * 8);

    records.set(
      packE8(coords, channel),
      i * 4
    );
    stableIds[i] = id;
  }

  return Object.freeze({
    count,
    records,
    stableIds,
    state,
  });
}

export function createScsFixtureSystem({
  count = 4096,
} = {}) {
  const data = createScsFixtureData(count);

  return {
    id: "simulation.fixture-particles",
    enabled: false,
    outputs: [
      SCS_PARTICLE_RECORDS,
      SCS_PARTICLE_STABLE_IDS,
      SCS_PARTICLE_STATE,
      SCS_TOPOLOGY_STATE,
      SCS_TOPOLOGY_DISPATCH,
    ],

    initialize({ gpu, resources, system }) {
      const usage = globalThis.GPUBufferUsage;
      if (!usage) {
        throw new Error("GPUBufferUsage is unavailable");
      }

      const records = gpu.device.createBuffer({
        label: "Lapinet SCS particle records",
        size: data.records.byteLength,
        usage:
          usage.STORAGE |
          usage.COPY_DST |
          usage.COPY_SRC,
      });
      const stableIds = gpu.device.createBuffer({
        label: "Lapinet stable particle IDs",
        size: data.stableIds.byteLength,
        usage:
          usage.STORAGE |
          usage.COPY_DST |
          usage.COPY_SRC,
      });
      const state = gpu.device.createBuffer({
        label: "Lapinet integer particle state",
        size: data.state.byteLength,
        usage:
          usage.STORAGE |
          usage.COPY_DST |
          usage.COPY_SRC,
      });
      const topologyState = gpu.device.createBuffer({
        label: "Lapinet topology dirty state",
        size: 16,
        usage:
          usage.STORAGE |
          usage.COPY_DST |
          usage.COPY_SRC,
      });
      const topologyDispatch = gpu.device.createBuffer({
        label: "Lapinet topology indirect dispatch",
        size: 6 * 16,
        usage:
          usage.STORAGE |
          usage.INDIRECT |
          usage.COPY_DST |
          usage.COPY_SRC,
      });

      gpu.queue.writeBuffer(records, 0, data.records);
      gpu.queue.writeBuffer(
        stableIds,
        0,
        data.stableIds
      );
      gpu.queue.writeBuffer(state, 0, data.state);
      gpu.queue.writeBuffer(
        topologyState,
        0,
        new Uint32Array([1, 0, 0, 0])
      );

      resources.publish(SCS_PARTICLE_RECORDS, {
        resource: records,
        owner: system.id,
        owned: true,
        metadata: {
          count,
          stride: 16,
          format: "packed-e8-site-channel-u32x4",
          role: "canonical-scheduled-e8-state",
        },
      });
      resources.publish(SCS_PARTICLE_STABLE_IDS, {
        resource: stableIds,
        owner: system.id,
        owned: true,
        metadata: {
          count,
          stride: 4,
          format: "stable-id-u32",
        },
      });
      resources.publish(SCS_PARTICLE_STATE, {
        resource: state,
        owner: system.id,
        owned: true,
        metadata: {
          count,
          stride: PARTICLE_STATE_STRIDE_BYTES,
          format:
            "legacy-position-i32x4-momentum-i32x4",
          driftDenom: PARTICLE_DRIFT_DENOM,
          positionPrecision:
            PARTICLE_POSITION_PRECISION,
          role:
            "inactive-kick-drift-prototype-state",
        },
      });
      resources.publish(SCS_TOPOLOGY_STATE, {
        resource: topologyState,
        owner: system.id,
        owned: true,
        metadata: {
          format: "dirty-generation-atomic-u32x4",
        },
      });
      resources.publish(SCS_TOPOLOGY_DISPATCH, {
        resource: topologyDispatch,
        owner: system.id,
        owned: true,
        metadata: {
          slots: 6,
          stride: 16,
          format: "dispatch-indirect-u32x4",
        },
      });
    },

    encode() {},
  };
}
