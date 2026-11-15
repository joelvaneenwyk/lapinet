struct FlockState {
  steer: vec4<i32>,
  hidden: vec4<i32>,
};

struct FlockParams {
  count: u32,
  operation: u32,
  alignment: i32,
  coupling: i32,
  baseWeight: i32,
  enabled: u32,
  cohesion: i32,
  separation: i32,
  restDistance: i32,
  positionGain: i32,
  blockSize: u32,
  reserved1: u32,
};

@group(0) @binding(0) var<storage, read> sortedValues: array<u32>;
@group(0) @binding(1) var<storage, read> records: array<vec4<u32>>;
@group(0) @binding(2) var<storage, read_write> flock: array<FlockState>;
@group(0) @binding(3) var<storage, read> directions: array<vec4<i32>>;
@group(0) @binding(4) var<uniform> options: FlockParams;
@group(0) @binding(5) var<storage, read> centroids: array<vec4<i32>>;

const FAN: i32 = 4i;

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

fn signed12(value: u32) -> i32 {
  let v = i32(value & 4095u);
  return select(v, v - 4096i, v >= 2048i);
}

fn physicalWorld(record: u32) -> vec4<i32> {
  let c = extract8(records[record]);
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

  let one = 65536i;
  let phi = 106039i;
  return vec4<i32>(
    ((z[0] * one + z[1] * phi) / 2i) / one,
    ((z[2] * one + z[3] * phi) / 2i) / one,
    ((z[4] * one + z[5] * phi) / 2i) / one,
    ((z[6] * one + z[7] * phi) / 2i) / one
  );
}

fn heading(record: u32) -> vec4<i32> {
  let channel = records[record].w % 120u;
  return directions[channel] * options.baseWeight + flock[record].steer;
}

fn wrapReservoirScalar(value: i32) -> i32 {
  let u = bitcast<u32>(value) & 0x3ffffu;
  return select(i32(u), i32(u) - 262144i, u >= 131072u);
}

fn wrapReservoir(value: vec4<i32>) -> vec4<i32> {
  return vec4<i32>(
    wrapReservoirScalar(value.x),
    wrapReservoirScalar(value.y),
    wrapReservoirScalar(value.z),
    wrapReservoirScalar(value.w)
  );
}

fn addPairDelta(
  accumulator: vec4<i32>,
  delta: vec4<i32>,
  strength: i32
) -> vec4<i32> {
  return accumulator + (delta * strength) / 256i;
}

fn maxAbs4(value: vec4<i32>) -> i32 {
  return max(
    max(abs(value.x), abs(value.y)),
    max(abs(value.z), abs(value.w))
  );
}

fn normalizedPairDirection(delta: vec4<i32>) -> vec4<i32> {
  let scale = max(1i, maxAbs4(delta));
  return (delta * 256i) / scale;
}

fn cohesionImpulse(
  selfPosition: vec4<i32>,
  centroid: vec4<i32>
) -> vec4<i32> {
  if (options.cohesion == 0i) {
    return vec4<i32>(0);
  }
  let delta = centroid - selfPosition;
  if (maxAbs4(delta) == 0i) {
    return vec4<i32>(0);
  }
  return (
    normalizedPairDirection(delta) *
    options.cohesion *
    options.positionGain
  ) / 512i;
}

fn separationImpulse(delta: vec4<i32>) -> vec4<i32> {
  if (options.separation == 0i) {
    return vec4<i32>(0);
  }
  let rest = max(1i, options.restDistance);
  if (dot(delta, delta) >= rest * rest) {
    return vec4<i32>(0);
  }
  return -(
    normalizedPairDirection(delta) *
    options.separation *
    options.positionGain
  ) / 2048i;
}

fn accumulateNeighbor(
  record: u32,
  other: u32,
  hiddenStage: bool,
  selfValue: vec4<i32>,
  selfPosition: vec4<i32>,
  alignmentDelta: ptr<function, vec4<i32>>,
  separationDelta: ptr<function, vec4<i32>>
) {
  let otherValue = select(
    flock[other].hidden,
    heading(other),
    hiddenStage
  );
  let strength = select(
    options.coupling,
    options.alignment,
    hiddenStage
  );
  *alignmentDelta = addPairDelta(
    *alignmentDelta,
    otherValue - selfValue,
    strength
  );

  if (!hiddenStage && options.separation != 0i) {
    let displacement =
      physicalWorld(other) - selfPosition;
    *separationDelta += separationImpulse(displacement);
  }
}

@compute @workgroup_size(128)
fn flockShear(@builtin(global_invocation_id) gid: vec3<u32>) {
  let sortedIndex = i32(gid.x);
  if (
    sortedIndex < 0 ||
    sortedIndex >= i32(options.count) ||
    options.enabled == 0u
  ) { return; }

  let record = sortedValues[u32(sortedIndex)];
  let op = options.operation;
  let hiddenStage = op == 0u || op == 3u;
  let reverseStage = op == 2u || op == 3u;
  let selfValue = select(
    flock[record].hidden,
    heading(record),
    hiddenStage
  );
  let selfPosition = physicalWorld(record);

  var alignmentDelta = vec4<i32>(0);
  var separationDelta = vec4<i32>(0);
  var cohesionDelta = vec4<i32>(0);
  if (!hiddenStage && options.cohesion != 0i) {
    let block = u32(sortedIndex) / max(1u, options.blockSize);
    cohesionDelta = cohesionImpulse(
      selfPosition,
      centroids[block]
    );
  }

  for (var offset = 1i; offset <= FAN; offset = offset + 1i) {
    let left = sortedIndex - offset;
    if (left >= 0i) {
      accumulateNeighbor(
        record,
        sortedValues[u32(left)],
        hiddenStage,
        selfValue,
        selfPosition,
        &alignmentDelta,
        &separationDelta
      );
    }

    let right = sortedIndex + offset;
    if (right < i32(options.count)) {
      accumulateNeighbor(
        record,
        sortedValues[u32(right)],
        hiddenStage,
        selfValue,
        selfPosition,
        &alignmentDelta,
        &separationDelta
      );
    }
  }

  let sign = select(1i, -1i, reverseStage);
  if (hiddenStage) {
    flock[record].hidden = wrapReservoir(
      flock[record].hidden + sign * alignmentDelta
    );
  } else {
    flock[record].steer = wrapReservoir(
      flock[record].steer + sign *
        (cohesionDelta + separationDelta - alignmentDelta)
    );
  }
}
