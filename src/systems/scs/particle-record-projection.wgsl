struct Particle {
  x: vec4<i32>,
  p: vec4<i32>,
};

struct ProjectionConfig {
  count: u32,
  center: i32,
  minCoord: i32,
  maxCoord: i32,
  positionPrecision: i32,
  cellShift: u32,
  reserved0: i32,
  reserved1: i32,
};

struct TopologyState {
  dirty: atomic<u32>,
  generation: atomic<u32>,
  rebuilds: atomic<u32>,
  reserved: atomic<u32>,
};

@group(0) @binding(0) var<storage, read> particles: array<Particle>;
@group(0) @binding(1) var<storage, read> stableIds: array<u32>;
@group(0) @binding(2) var<storage, read_write> records: array<vec4<u32>>;
@group(0) @binding(3) var<uniform> cfg: ProjectionConfig;
@group(0) @binding(4) var<storage, read_write> topology: TopologyState;

fn pack8(c: array<u32, 8>, channel: u32) -> vec4<u32> {
  let lo =
    (c[0] & 4095u) |
    ((c[1] & 4095u) << 12u) |
    ((c[2] & 255u) << 24u);
  let mid =
    ((c[2] >> 8u) & 15u) |
    ((c[3] & 4095u) << 4u) |
    ((c[4] & 4095u) << 16u) |
    ((c[5] & 15u) << 28u);
  let hi =
    ((c[5] >> 4u) & 255u) |
    ((c[6] & 4095u) << 8u) |
    ((c[7] & 4095u) << 20u);
  return vec4<u32>(lo, mid, hi, channel);
}

fn extract8(r: vec4<u32>) -> array<u32, 8> {
  let lo = r.x;
  let mid = r.y;
  let hi = r.z;
  var c: array<u32, 8>;
  c[0] = lo & 4095u;
  c[1] = (lo >> 12u) & 4095u;
  c[2] = ((lo >> 24u) | (mid << 8u)) & 4095u;
  c[3] = (mid >> 4u) & 4095u;
  c[4] = (mid >> 16u) & 4095u;
  c[5] = ((mid >> 28u) | (hi << 4u)) & 4095u;
  c[6] = (hi >> 8u) & 4095u;
  c[7] = (hi >> 20u) & 4095u;
  return c;
}

fn latticeCoordinate(value: i32) -> i32 {
  if (value < 0i) {
    return -((-value + cfg.positionPrecision - 1i) / cfg.positionPrecision);
  }
  return value / cfg.positionPrecision;
}

fn encoded(value: i32) -> u32 {
  return u32(clamp(
    cfg.center + latticeCoordinate(value),
    cfg.minCoord,
    cfg.maxCoord
  ));
}

fn topologyCell(coord: u32) -> i32 {
  let a2 = 2i * i32(coord) - 4095i;
  let physical = a2 * 65536i + 106039i;
  return physical >> cfg.cellShift;
}

fn topologyChanged(
  oldCoords: array<u32, 8>,
  newCoords: array<u32, 8>
) -> bool {
  return
    topologyCell(oldCoords[0]) != topologyCell(newCoords[0]) ||
    topologyCell(oldCoords[2]) != topologyCell(newCoords[2]) ||
    topologyCell(oldCoords[4]) != topologyCell(newCoords[4]) ||
    topologyCell(oldCoords[6]) != topologyCell(newCoords[6]);
}

@compute @workgroup_size(256)
fn projectParticleRecords(@builtin(global_invocation_id) gid: vec3<u32>) {
  let id = gid.x;
  if (id >= cfg.count) { return; }

  let x = particles[id].x;
  var c: array<u32, 8>;
  c[0] = encoded(x.x);
  c[1] = u32(cfg.center);
  c[2] = encoded(x.y);
  c[3] = u32(cfg.center);
  c[4] = encoded(x.z);
  c[5] = u32(cfg.center);
  c[6] = encoded(x.w);
  c[7] = u32(cfg.center);

  let oldRecord = records[id];
  let oldCoords = extract8(oldRecord);
  if (topologyChanged(oldCoords, c)) {
    atomicStore(&topology.dirty, 1u);
  }

  records[id] = pack8(c, stableIds[id] % 240u);
}
