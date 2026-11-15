struct TopologyState {
  dirty: atomic<u32>,
  generation: atomic<u32>,
  rebuilds: atomic<u32>,
  reserved: atomic<u32>,
};

struct GateConfig {
  count: u32,
  coarseBuckets: u32,
  reserved0: u32,
  reserved1: u32,
};

@group(0) @binding(0) var<storage, read_write> topology: TopologyState;
@group(0) @binding(1) var<storage, read_write> dispatchArgs: array<u32>;
@group(0) @binding(2) var<uniform> cfg: GateConfig;

fn writeSlot(slot: u32, x: u32, y: u32, z: u32) {
  let base = slot * 4u;
  dispatchArgs[base] = x;
  dispatchArgs[base + 1u] = y;
  dispatchArgs[base + 2u] = z;
  dispatchArgs[base + 3u] = 0u;
}

@compute @workgroup_size(1)
fn prepareTopologyDispatch() {
  let dirty = atomicLoad(&topology.dirty);
  if (dirty == 0u) {
    for (var slot = 0u; slot < 6u; slot = slot + 1u) {
      writeSlot(slot, 0u, 1u, 1u);
    }
    return;
  }

  atomicAdd(&topology.generation, 1u);
  atomicAdd(&topology.rebuilds, 1u);

  let groups = (cfg.count + 255u) / 256u;
  let histogramBlocks = (groups + 511u) / 512u;
  let offsetGroups = (groups + 255u) / 256u;
  let coarseGroups = (cfg.coarseBuckets + 255u) / 256u;

  // 0: particle-sized topology passes.
  writeSlot(0u, groups, 1u, 1u);
  // 1: radix histogram blocks x 256 bins.
  writeSlot(1u, histogramBlocks, 256u, 1u);
  // 2: one workgroup x 256 bins.
  writeSlot(2u, 1u, 256u, 1u);
  // 3: radix block-offset pass x 256 bins.
  writeSlot(3u, offsetGroups, 256u, 1u);
  // 4: one workgroup.
  writeSlot(4u, 1u, 1u, 1u);
  // 5: coarse lookup clear.
  writeSlot(5u, coarseGroups, 1u, 1u);
}

@compute @workgroup_size(1)
fn clearTopologyDirty() {
  atomicStore(&topology.dirty, 0u);
}
