# Lapinet reversible central springs and dynamic contacts — v1

Date: 2026-11-14
Agent: Noether
Demo: http://127.0.0.1:1351/springs.html
Scope: Isolated Lapinet/springs.html and Lapinet/src/systems/reversible-springs/. The main Lapinet simulation and SCS renderer are not modified.

## What changed

- Replaced three independent axis springs with pair-central integer impulses, exactly parallel to each interacting particle pair's signed displacement.
- Added two modes: **permanent bonds** over a deterministic symmetric directed CSR graph, and **dynamic contacts** computed from current physical separation within an integer cutoff.
- Added a **GPU connection-line renderer**, directly consuming the same live particle GPU buffer as the sphere-dot renderer; no position readback per frame.
- Permanent mode draws every undirected spring once. Dynamic mode allocates candidate pairs and on-GPU rejects any pair failing the exact same integer cutoff predicate used by the force law. The GUI labels the displayed count as candidates rather than claiming all pairs are active.
- Added a **Draw connections** checkbox and **Edge opacity** slider.
- Added Lattice and Sphere source shapes.
- Increased selectable physical node resolution: lattice grids 6, 8, 12, 16, 20, or 24 across X and Y with half as many Z layers; at 24 this is **24 × 24 × 12 = 6,912 particles**. Grid spacing decreases as density increases so physical extent remains approximately fixed. An optional side-24 spherical source has **6,272 particles**.
- Added internal exact coordinate precision choices **1/8, 1/16, 1/32, and 1/64 world unit**, using signed 32-bit integer position and momentum, not authoritative floating-point coordinates.
- The default is now **12 × 12 × 6 (864 particles)**, **1/32 world-unit coordinate precision**, permanent bonds, with visible connection edges.

## Force and reversal mathematics

Particle state per identity has 8 signed 32-bit words:

    [x,y,z,0,px,py,pz,0]

For pair i,j with integer displacement d = x[j]-x[i], and coordinate scale Q=8,16,32,or64:

    u = trunc_toward_zero(d / Q)        // per component
    r2 = dot(u,u)
    a = clamp(trunc(k*(r2 - l2)/(4*l2)), -3, 3)
    impulse_ij = a * d

Here l2 is the squared initial/rest bond length in physical world units (or the dynamic interaction rest radius squared). The scalar a is invariant under i,j exchange and d changes sign, so impulse_ji = -impulse_ij exactly. The impulse is an integer multiple of the actual separation vector, so the kick has zero net pair torque in exact unbounded integer arithmetic.

The forward map is a triangular composition:

    momentum += force(position)
    position += trunc(momentum / 256)

The inverse is:

    position -= trunc(momentum / 256)
    momentum -= force(restored_position)

The operations act on bounded integer values. For dynamic contacts, the active interaction is recomputed at the restored position; no event log is needed for these position-derived transient contacts. Bond *creation with persistence* is different and not yet implemented.

The particle pass and spring line pass both render from the GPU storage buffer. Dynamic line visibility uses the same integer quotient (d / Q) and squared radius comparison as the solver, so displayed contact edges match the current dynamic cutoff, including quantization boundaries.

## Certificates

Real Apple WebGPU compute execution, GPU readback against the CPU reference, and exact inverse:

| Mode | Particles | Q units/world | Forward ticks | GPU/CPU mismatches | Inverse mismatches |
|---|---:|---:|---:|---:|---:|
| Bonded | 108 | 16 | 256 | 0 | 0 |
| Bonded | 256 | 16 | 96 | 0 | 0 |
| Bonded/default-sized (spacing 44) | 864 | 32 | 32 | 0 | 0 |
| Bonded | 1,024 | 16 | 24 | 0 | 0 |
| Bonded | 4,096 | 16 | 16 | 0 | 0 |
| Dynamic | 108 | 16 | 48 | 0 | 0 |
| Dynamic | 256 | 32 | 24 | 0 | 0 |
| Dynamic | 256 | 64 | 12 | 0 | 0 |
| Bonded/high density (spacing 21) | 6,912 | 64 | 8 | 0 | 0 |

Every case preserved net linear momentum, and the GPU state exactly matched the CPU reference before and after reversal.

Headless WebGPU rendering certificates drew the actual dynamic and bonded connection-line pipelines to render textures and read back nonblank pixels:

- Bonded 108 particles, 252 edges: 16,552 lit pixels.
- Dynamic 256 particles, 32,640 candidate pairs: 65,934 lit pixels.
- High-resolution bonded 6,912 particles, 19,584 edges: 185,270 lit pixels.
- All three passed validation with proper WebGPU bind groups, 48-byte view uniform ABI, and live particle state resources.

All **107/107 Lapinet Node tests** passed, including new tests for torque-free kicks, dynamic formation/disappearance of contacts, exact subworld increments, long 10,000-tick restoration, and 6,912-particle fixture creation.

## Run

Live demo (existing Lapinet server):

    http://127.0.0.1:1351/springs.html

Checks from the Lapin repository root:

    node --test Lapinet/tests/reversible-springs.mjs
    deno run --unstable-webgpu --allow-read Lapinet/src/systems/reversible-springs/validate-springs-webgpu.mjs
    deno run --unstable-webgpu --allow-read Lapinet/src/systems/reversible-springs/validate-spring-render-webgpu.mjs

The webpage and shader files returned HTTP 200 at port 1351. The browser UI was not visually inspected by a connected browser; GPU rendering was instead checked by offscreen Apple WebGPU readback. The 24-grid option is *not* selected automatically; it is an opt-in ultra-resolution preset.

## Limits and next work

- Dynamic mode performs deterministic all-pairs neighbor checks and is capped at **512 particles**, with the UI automatically returning to an 8-grid when a higher dynamic grid is requested. A true scalable dynamic-neighbor system must use Lapinet's GPU SCS spatial hierarchy.
- The spring law is angularly central and deterministic, but quantization makes it a coarse nonlinear elastic approximation, not a full physically calibrated Hooke's law.
- Total **linear momentum** is exact under bounded arithmetic. The kick alone has zero net torque, but position drift uses per-component integer division, so total **angular momentum is not guaranteed exact** over full ticks.
- Numerical reversibility is not exact energy conservation.
- Large state values and force accumulation can overflow signed 32-bit integers; production collision and bonds need explicit saturation bounds or a safe modular arithmetic contract.
- Existing graph topology in bonded mode remains fixed. Dynamic mode allows contacts to appear or disappear with positions but does not preserve historical persistent bonds.
- Main Lapinet SCS packed 16-byte address/channel records and this prototype's 32-byte physical pos/momentum ABI still need an agreed integration interface.
- No end-to-end interactive browser screenshot test was run. No modification was made to main.js, the shared SCS shader, or Daedalus's renderer files.

## File changes

- Lapinet/springs.html
- Lapinet/src/systems/reversible-springs/springs-cpu.mjs
- Lapinet/src/systems/reversible-springs/springs-gpu.js
- Lapinet/src/systems/reversible-springs/springs.wgsl
- Lapinet/src/systems/reversible-springs/springs-render.wgsl
- Lapinet/src/systems/reversible-springs/springs-view.js
- Lapinet/src/systems/reversible-springs/validate-springs-webgpu.mjs
- Lapinet/src/systems/reversible-springs/validate-spring-render-webgpu.mjs
- Lapinet/tests/reversible-springs.mjs
