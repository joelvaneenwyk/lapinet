struct CentroidConfig {
  count: u32,
  blockSize: u32,
  reserved0: u32,
  reserved1: u32,
};

@group(0) @binding(0) var<storage, read> sortedValues: array<u32>;
@group(0) @binding(1) var<storage, read> records: array<vec4<u32>>;
@group(0) @binding(2) var<storage, read_write> centroids: array<vec4<i32>>;
@group(0) @binding(3) var<uniform> cfg: CentroidConfig;

var<workgroup> sx: array<i32, 64>;
var<workgroup> sy: array<i32, 64>;
var<workgroup> sz: array<i32, 64>;
var<workgroup> sw: array<i32, 64>;

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

@compute @workgroup_size(64)
fn computeFlockCentroids(
  @builtin(local_invocation_id) lid: vec3<u32>,
  @builtin(workgroup_id) wid: vec3<u32>
) {
  let lane = lid.x;
  let start = wid.x * cfg.blockSize;
  let sortedIndex = start + lane;

  var p = vec4<i32>(0);
  if (sortedIndex < cfg.count && lane < cfg.blockSize) {
    p = physicalWorld(sortedValues[sortedIndex]);
  }

  sx[lane] = p.x;
  sy[lane] = p.y;
  sz[lane] = p.z;
  sw[lane] = p.w;
  workgroupBarrier();

  var stride = 32u;
  loop {
    if (stride == 0u) { break; }
    if (lane < stride) {
      sx[lane] += sx[lane + stride];
      sy[lane] += sy[lane + stride];
      sz[lane] += sz[lane + stride];
      sw[lane] += sw[lane + stride];
    }
    workgroupBarrier();
    stride = stride / 2u;
  }

  if (lane == 0u) {
    let remaining = cfg.count - min(start, cfg.count);
    let n = i32(max(1u, min(cfg.blockSize, remaining)));
    centroids[wid.x] = vec4<i32>(
      sx[0] / n,
      sy[0] / n,
      sz[0] / n,
      sw[0] / n
    );
  }
}
