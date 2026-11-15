struct Particle {
  x: vec4<i32>,
  p: vec4<i32>,
};
struct CoarseEntry {
  start: atomic<u32>,
  end: atomic<u32>,
  stamp: atomic<u32>,
  reserved: atomic<u32>,
};
struct NeighborConfig {
  count: u32,
  generation: u32,
  radius: u32,
  reserved: u32,
};
struct PhysicsConfig {
  count: u32,
  unitScale: i32,
  cutoff2: i32,
  rest2: i32,
  contactStiffness: i32,
  gravityY: i32,
  groundY: i32,
  groundStiffness: i32,
  maxPairScalar: i32,
  reserved0: i32,
  reserved1: i32,
  reserved2: i32,
};

@group(0) @binding(0) var<storage, read_write> particles: array<Particle>;
@group(0) @binding(1) var<storage, read> sortedKeys: array<vec4<u32>>;
@group(0) @binding(2) var<storage, read> sortedValues: array<u32>;
@group(0) @binding(3) var<storage, read> cellsByRecord: array<vec4<u32>>;
@group(0) @binding(4) var<storage, read> starts: array<u32>;
@group(0) @binding(5) var<storage, read> metadata: array<u32>;
@group(0) @binding(6) var<storage, read_write> coarse: array<CoarseEntry>;
@group(0) @binding(7) var<uniform> neighborCfg: NeighborConfig;
@group(0) @binding(8) var<uniform> physics: PhysicsConfig;

fn morton80(c: vec4<u32>) -> vec3<u32> {
  var lo = 0u;
  var mid = 0u;
  var hi = 0u;
  for (var bit = 19i; bit >= 0i; bit = bit - 1i) {
    let b = u32(bit);
    let nibble =
      (((c.x >> b) & 1u) << 3u) |
      (((c.y >> b) & 1u) << 2u) |
      (((c.z >> b) & 1u) << 1u) |
      ((c.w >> b) & 1u);
    hi = (hi << 4u) | (mid >> 28u);
    mid = (mid << 4u) | (lo >> 28u);
    lo = (lo << 4u) | nibble;
  }
  return vec3<u32>(lo, mid, hi);
}

fn compareSpatial(a: vec3<u32>, b: vec3<u32>) -> i32 {
  if (a.z != b.z) { return select(1, -1, a.z < b.z); }
  if (a.y != b.y) { return select(1, -1, a.y < b.y); }
  if (a.x != b.x) { return select(1, -1, a.x < b.x); }
  return 0;
}

fn keyAtCell(cell: u32) -> vec3<u32> {
  let key = sortedKeys[starts[cell]];
  return vec3<u32>(key.x, key.y, key.z);
}

fn coarseIndex(key: vec3<u32>) -> u32 {
  return (((key.z & 0xffffu) << 4u) | (key.y >> 28u)) & 0xfffffu;
}

fn findOccupiedCell(queryKey: vec3<u32>) -> u32 {
  let coarseId = coarseIndex(queryKey);
  if (atomicLoad(&coarse[coarseId].stamp) != neighborCfg.generation) {
    return 0xffffffffu;
  }
  var lo = atomicLoad(&coarse[coarseId].start);
  var hi = atomicLoad(&coarse[coarseId].end);
  loop {
    if (lo >= hi) { break; }
    let mid = lo + (hi - lo) / 2u;
    let cmp = compareSpatial(keyAtCell(mid), queryKey);
    if (cmp < 0) { lo = mid + 1u; } else { hi = mid; }
  }
  let occupied = metadata[0];
  if (lo < occupied && compareSpatial(keyAtCell(lo), queryKey) == 0) {
    return lo;
  }
  return 0xffffffffu;
}

fn pairScalar(delta: vec3<i32>) -> i32 {
  let latticeDelta = delta / physics.unitScale;
  let r2 = dot(latticeDelta, latticeDelta);
  if (r2 >= physics.rest2 || r2 > physics.cutoff2) { return 0i; }
  let denom = max(1i, 4i * physics.rest2);
  return clamp(
    ((r2 - physics.rest2) * physics.contactStiffness) / denom,
    -physics.maxPairScalar,
    0i
  );
}

@compute @workgroup_size(256)
fn kickParticles(@builtin(global_invocation_id) gid: vec3<u32>) {
  let id = gid.x;
  if (id >= physics.count) { return; }

  let particle = particles[id];
  let cell = cellsByRecord[id];
  let radius = i32(neighborCfg.radius);
  var force = vec3<i32>(0i);

  for (var d0 = -radius; d0 <= radius; d0 = d0 + 1) {
    for (var d1 = -radius; d1 <= radius; d1 = d1 + 1) {
      for (var d2 = -radius; d2 <= radius; d2 = d2 + 1) {
        for (var d3 = -radius; d3 <= radius; d3 = d3 + 1) {
          let t = vec4<i32>(
            i32(cell.x) + d0,
            i32(cell.y) + d1,
            i32(cell.z) + d2,
            i32(cell.w) + d3
          );
          if (any(t < vec4<i32>(0i)) || any(t >= vec4<i32>(1048576i))) {
            continue;
          }
          let found = findOccupiedCell(morton80(vec4<u32>(t)));
          if (found == 0xffffffffu) { continue; }

          let begin = starts[found];
          let end = starts[found + 1u];
          for (var j = begin; j < end; j = j + 1u) {
            let otherId = sortedValues[j];
            if (otherId == id) { continue; }
            let delta = particles[otherId].x.xyz - particle.x.xyz;
            force += pairScalar(delta) * delta;
          }
        }
      }
    }
  }

  force.y -= physics.gravityY;
  if (particle.x.y < physics.groundY) {
    let penetration = physics.groundY - particle.x.y;
    force.y +=
      (penetration * physics.groundStiffness) /
      max(1i, physics.unitScale);
  }

  particles[id].p = vec4<i32>(particle.p.xyz + force, particle.p.w);
}
