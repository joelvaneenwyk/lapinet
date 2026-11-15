# Lapinet reversible springs v0 — 2026-11-14

## Implemented

The experimental WebGPU reversible integer spring network runs in Lapinet/springs.html, independently of the main SCS particle runtime.

Each particle has eight signed 32-bit fields: position XYZ, zero pad, momentum XYZ, zero pad. The static symmetric directed-CSR spring graph stores neighbor IDs, signed rest displacements, and integer stiffness. Directed pairs hold opposite rest displacements and identical stiffness. Each GPU invocation gathers its neighbors in a fixed order, so no unordered atomics are needed.

Each forward tick is an exact triangular map: kick momentum by the current position-dependent spring impulse, then drift position by the updated momentum. Reverse ticks first undo drift, then undo the kick with the restored positions. The force is componentwise truncation toward zero of stiffness times relative displacement from rest, divided by 256. Equal/opposite directed impulses conserve total momentum exactly in the bounded non-overflow regime.

The same GPU state buffer feeds a separate instanced billboard renderer, without CPU position readback during normal animation. Controls: Play/Pause, +1/-1, +64/-64, Reset, grid size, stiffness, deformation, orbit, zoom, GPU-versus-CPU verification and forward/reverse certificate.

## Hardware evidence

Apple WebGPU compute and render pipelines both compile. Four real GPU-to-CPU tests:

| Particles | Undirected springs | Forward ticks | GPU/CPU mismatches | Reverse mismatches |
|---:|---:|---:|---:|---:|
| 108 | 252 | 256 | 0 | 0 |
| 256 | 640 | 96 | 0 | 0 |
| 1024 | 2688 | 24 | 0 | 0 |
| 4096 | 11520 | 16 | 0 | 0 |

Momentum remained (0,0,0) after each run. All 97 Lapinet Node tests passed, including four new spring tests. One new CPU test performed a 10,000-tick forward/reverse spring-network certificate and restored every state word. Separately, the H4 hidden-phase transport was certified at 10,000 ticks and 120 channels under modular and R3 spherical boundaries.

## How to inspect

Open http://127.0.0.1:1351/springs.html while the existing Lapinet server is running.

Run Apple WebGPU hardware tests from the Lapin repository root:

    deno run --unstable-webgpu --allow-read Lapinet/src/systems/reversible-springs/validate-springs-webgpu.mjs

Run CPU tests:

    node --test Lapinet/tests/reversible-springs.mjs

## Files and ownership

- Lapinet/springs.html — interactive prototype
- Lapinet/src/systems/reversible-springs/springs-cpu.mjs — CPU oracle, fixtures, graph validator
- Lapinet/src/systems/reversible-springs/springs.wgsl — integer GPU compute
- Lapinet/src/systems/reversible-springs/springs-gpu.js — standalone GPU controller and check
- Lapinet/src/systems/reversible-springs/springs-render.wgsl — direct GPU particle rendering
- Lapinet/src/systems/reversible-springs/springs-view.js — controls and orbit view
- Lapinet/src/systems/reversible-springs/validate-springs-webgpu.mjs — hardware checks
- Lapinet/tests/reversible-springs.mjs — CPU regression suite

No changes to Helios's SCS particle-motion shader, shared packed-record format, main simulation runtime, Daedalus's renderer or main.js. The isolated prototype avoids collisions with their active work.

## What remains

This is an isolated working physics prototype inside the Lapinet repository, not yet an integrated simulation mode on the main Lapinet page. The main SCS state is packed u32x4 (16 bytes, H4/E8-like site and channel). The spring state is signed i32x8 (32 bytes: position and momentum). They must not be reinterpreted as the same ABI. Integration requires agreement on a shared particle state, deterministic neighborhood graph construction, and a position-buffer input or packing adapter for the main renderer.

The current springs are componentwise displacement-rest forces, not rotationally invariant central-force springs. Bond topology is static. Energy is not exactly conserved just because the integrator is reversible; quantization introduces differences. Overflow must be explicitly guarded in a production implementation. Damping would require auxiliary reservoir state or a deliberately irreversible law. SDF contacts, dynamic bonds, true inertial flocking, broadphase performance, and 65K-scale benchmarks remain future work. Benchmark GPU times are end-to-end certificate times rather than steady-state isolated kernel measurements.

Live HTML and module assets returned HTTP 200; GPU shader and pipeline creation passed on the Apple hardware. A browser pixel-level visual inspection has not been completed.

## Suggested next engineering step

Agree with Helios on the SCS ABI and integrate physical R3 position plus momentum in a way that keeps the H4 transport channels and exact replay meaningful. Then add a deterministic nearby-pair graph, visualize the spring network through the main renderer, and benchmark sustained 4K-to-65K workloads.
