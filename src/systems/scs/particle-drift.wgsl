struct Particle {
  x: vec4<i32>,
  p: vec4<i32>,
};
struct DriftConfig {
  count: u32,
  denominator: i32,
  reverse: u32,
  reserved: u32,
};
@group(0) @binding(0) var<storage, read_write> particles: array<Particle>;
@group(0) @binding(1) var<uniform> cfg: DriftConfig;

@compute @workgroup_size(256)
fn driftParticles(@builtin(global_invocation_id) gid: vec3<u32>) {
  let id = gid.x;
  if (id >= cfg.count) { return; }
  var p = particles[id];
  let direction = select(1i, -1i, cfg.reverse != 0u);
  p.x = vec4<i32>(
    p.x.xyz + direction * (p.p.xyz / cfg.denominator),
    p.x.w
  );
  particles[id].x = p.x;
}
