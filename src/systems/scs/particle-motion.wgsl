struct MotionConfig {
  count: u32,
  frameIndex: u32,
  cadence: u32,
  reserved: u32,
};

@group(0) @binding(0) var<storage, read_write> records: array<vec4<u32>>;
@group(0) @binding(1) var<storage, read> stableIds: array<u32>;
@group(0) @binding(2) var<uniform> cfg: MotionConfig;

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

@compute @workgroup_size(256)
fn integrateFixtureMotion(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= cfg.count || cfg.cadence == 0u) {
    return;
  }
  if ((cfg.frameIndex % cfg.cadence) != 0u) {
    return;
  }

  let stable = stableIds[i];
  let axis = stable % 3u;
  let coordIndex = axis * 2u;
  let phase = ((cfg.frameIndex / cfg.cadence) + ((stable >> 8u) % 120u)) % 120u;
  let direction = select(-1i, 1i, phase < 60u);

  var c = extract8(records[i]);
  let current = i32(c[coordIndex]);
  c[coordIndex] = u32(clamp(current + direction, 1984i, 2176i));
  records[i] = pack8(c, records[i].w);
}
