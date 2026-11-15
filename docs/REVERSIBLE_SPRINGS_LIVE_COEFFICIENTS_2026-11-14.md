# Reversible Springs — live coefficients and next flocking milestone

Date: 2026-11-14
Owner: Noether
Demo: http://127.0.0.1:1351/springs.html?v=live4

## Implemented

The standalone Lapinet reversible-springs experiment now updates three force coefficients while the GPU simulation is running, without replacing the spring graph or resetting the particle storage buffers.

- Spring strength: integer range 0–64, now a per-event uniform used in both bonded and dynamic modes.
- Rest-length scale: integer factor 64–512 over 256; UI exposes 50%–180%. The target squared rest length is computed with two bounded integer divisions, identically in WGSL and JS.
- Contact radius: integer world-space radius, exposed as 75%–240% of initial lattice spacing, used in both dynamic-contact force computation and GPU line visibility.

Grid size, source shape, precision and initial deformation remain reset-time structural/initial-condition controls.

## Exact replay contract

The solver maintains an immutable sorted list of coefficient events, each identifying the first tick for which those coefficients apply. Slider input at current tick T records a replacement event at T and preserves particle positions, momenta and T. Re-editing the same tick replaces the previous event. Editing while rewound truncates future events, creating a new trajectory branch.

Every event owns immutable GPU uniform buffers and bind groups for all four kernel stages (kick, drift, inverse drift, inverse kick). Previously queued compute work does not have its active coefficient buffer rewritten by a later UI event. Forward tick T uses the event applicable at T. The inverse of tick T uses that same event after undoing drift; a reverse operation crossing event boundaries switches to the historical GPU bind groups.

The CPU reference independently reproduces the timeline using the same event schedule, and the interactive Verify button checks a fresh 64-tick forward/reverse excursion from the current state.

## Tests

The real Apple WebGPU validation added three changes during an active trajectory: strength, rest scale and contact radius. It then traversed all three change boundaries backwards and replayed the original forward trajectory.

- 108 bonded particles: CPU mismatches 0, reverse mismatches 0, replay mismatches 0.
- 256 dynamic-contact particles: CPU mismatches 0, reverse mismatches 0, replay mismatches 0.
- 6,912 bonded particles: CPU mismatches 0, reverse mismatches 0, replay mismatches 0.

The same script also validates the GPU rendered spring lines. All nine standard GPU/CPU spring certificates continue to pass. The full Lapinet Node test suite passes 113/113, including a CPU timeline branch/reversal test. HTTP requests for all updated live viewer modules returned 200.

The connected in-app browser was not automatically inspected pixel by pixel; GPU rendering was checked by Apple WebGPU offscreen render/readback.

## Limitations

Each slider adjustment retains the needed immutable GPU coefficient snapshot until the solver is destroyed, so very long continuous tuning sessions will require event/buffer compaction or a configurable history budget. The current event policy prioritizes exact rewind over bounded history. Coefficients alone are not part of the eight-word particle record; exact external replay must retain the event timeline alongside the initial state.

Numerical reversibility remains distinct from exact energy conservation. Spring forces remain integer-quantized and bounded by the 32-bit representation. Dynamic all-pairs contacts remain capped at 512 particles until the spatial hierarchy is connected.

## Next: reversible flocking

Start with a coherent moving spherical group, using the proven pair-central cohesion and separation operators. Add an explicit local alignment mechanism only after specifying where lost relative-velocity information is stored: ordinary dissipative boids averaging is many-to-one and cannot be rewound bit-for-bit from particle velocities alone. Candidate designs are reversible local momentum shears with auxiliary angular/relative-motion state, or an extended reservoir that captures the alignment residual.

Evaluate radial cohesion, heading alignment, collective turning, velocity variance, linear momentum, angular momentum, exact rewind, and GPU frame time independently. Integrate into main Lapinet only after agreeing on the 16-byte packed SCS particle representation versus this prototype's 32-byte position/momentum state.

## Files changed

- Lapinet/src/systems/reversible-springs/springs-cpu.mjs
- Lapinet/src/systems/reversible-springs/springs.wgsl
- Lapinet/src/systems/reversible-springs/springs-timeline.mjs
- Lapinet/src/systems/reversible-springs/springs-gpu.js
- Lapinet/src/systems/reversible-springs/springs-view.js
- Lapinet/springs.html
- Lapinet/src/systems/reversible-springs/validate-springs-webgpu.mjs
- Lapinet/src/systems/reversible-springs/validate-spring-render-webgpu.mjs
- Lapinet/tests/reversible-springs.mjs
