struct StreamConfig {
  count: u32,
  frame: u32,
  seed: u32,
  threshold: u32,
  reverse: u32,
  cellShift: u32,
  stride: u32,
  flockEnabled: u32,
  baseWeight: i32,
  reserved0: i32,
  reserved1: i32,
  reserved2: i32,
};

struct FlockState {
  steer: vec4<i32>,
  hidden: vec4<i32>,
};

struct TopologyState {
  dirty: atomic<u32>,
  generation: atomic<u32>,
  rebuilds: atomic<u32>,
  reserved: atomic<u32>,
};

@group(0) @binding(0) var<storage, read_write> records: array<vec4<u32>>;
@group(0) @binding(1) var<storage, read> roots: array<i32>;
@group(0) @binding(2) var<storage, read> gram: array<i32>;
@group(0) @binding(3) var<storage, read_write> topology: TopologyState;
@group(0) @binding(4) var<uniform> cfg: StreamConfig;
@group(0) @binding(5) var<storage, read> flock: array<FlockState>;
@group(0) @binding(6) var<storage, read> directions: array<vec4<i32>>;
@group(0) @binding(7) var<storage, read> exactCandidates: array<u32>;

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

fn gateInvariant(k: array<u32, 8>, channel: u32) -> u32 {
  var p = 0i;
  var q = 0i;
  for (var i = 0u; i < 8u; i = i + 1u) {
    let ki = i32(k[i]);
    for (var j = 0u; j < 8u; j = j + 1u) {
      let gij = gram[i * 8u + j];
      let kj = i32(k[j]);
      let rj = roots[channel * 8u + j];
      p = (p + ki * gij * rj) & 4095i;
      q = (q + ki * gij * kj) & 4095i;
    }
  }
  return u32((2i * q - p * p) & 4095i);
}

fn phase(k: array<u32, 8>, channel: u32) -> u32 {
  return (
    gateInvariant(k, channel) +
    cfg.frame * cfg.stride +
    cfg.seed
  ) & 4095u;
}

fn signed12(value: u32) -> i32 {
  let v = i32(value & 4095u);
  return select(v, v - 4096i, v >= 2048i);
}

fn icosianNumerator(c: array<u32, 8>) -> array<i32, 8> {
  var k: array<i32, 8>;
  for (var i = 0u; i < 8u; i = i + 1u) {
    k[i] = signed12(c[i]);
  }
  var z: array<i32, 8>;
  z[0] = k[0];
  z[1] = k[1];
  z[2] = k[2];
  z[3] = k[3];
  z[4] = k[0] + k[1] + k[3] + 2i * k[4];
  z[5] = k[0] + k[2] + k[3] + 2i * k[5];
  z[6] = k[1] + k[2] + k[3] + 2i * k[6];
  z[7] = k[0] + k[1] + k[2] + 2i * k[7];
  return z;
}

fn topologyCell(c: array<u32, 8>) -> vec4<i32> {
  let z = icosianNumerator(c);
  let one = 65536i;
  let phi = 106039i;
  let p = vec4<i32>(
    (z[0] * one + z[1] * phi) / 2i,
    (z[2] * one + z[3] * phi) / 2i,
    (z[4] * one + z[5] * phi) / 2i,
    (z[6] * one + z[7] * phi) / 2i
  );
  return p >> vec4<u32>(cfg.cellShift);
}

fn effectiveChannel(recordId: u32, channel: u32) -> u32 {
  if (cfg.flockEnabled == 0u) {
    return channel;
  }

  let base = channel % 120u;
  let shell = select(0u, 120u, channel >= 120u);
  let desired =
    directions[base] * cfg.baseWeight +
    flock[recordId].steer;

  var mask = 0u;
  if (desired.x >= 0i) { mask = mask | 1u; }
  if (desired.y >= 0i) { mask = mask | 2u; }
  if (desired.z >= 0i) { mask = mask | 4u; }
  if (desired.w >= 0i) { mask = mask | 8u; }

  let candidateBase = mask * 17u;
  var best = exactCandidates[candidateBase];
  var bestDot = -2147483647i;

  for (var i = 0u; i < 17u; i = i + 1u) {
    let candidate = exactCandidates[candidateBase + i];
    let d = directions[candidate];
    let score =
      d.x * desired.x +
      d.y * desired.y +
      d.z * desired.z +
      d.w * desired.w;
    if (score > bestDot) {
      bestDot = score;
      best = candidate;
    }
  }
  return best + shell;
}

@compute @workgroup_size(256)
fn scheduledStream(@builtin(global_invocation_id) gid: vec3<u32>) {
  let id = gid.x;
  if (id >= cfg.count) { return; }

  let record = records[id];
  let channel = record.w;
  let transportChannel = effectiveChannel(id, channel);
  var c = extract8(record);

  if (phase(c, transportChannel) >= cfg.threshold) {
    return;
  }

  let oldCell = topologyCell(c);
  let direction = select(1i, -1i, cfg.reverse != 0u);
  for (var axis = 0u; axis < 8u; axis = axis + 1u) {
    let root = roots[transportChannel * 8u + axis];
    c[axis] = u32((i32(c[axis]) + direction * root) & 4095i);
  }

  let newCell = topologyCell(c);
  if (any(oldCell != newCell)) {
    atomicStore(&topology.dirty, 1u);
    atomicAdd(&topology.reserved, 1u);
  }

  records[id] = pack8(c, channel);
}
