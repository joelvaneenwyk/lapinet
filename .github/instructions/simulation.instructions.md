---
applyTo: "src/systems/**,src/gpu/**"
description: "Rules for reversible simulation state, GPU systems, and CPU oracles"
---

# Simulation and GPU-system code

- Authoritative state is **integer-exact**. Use `Math.imul`, `>>> 0`, `| 0`, and explicit modular wrap (`& 4095` for E8 coefficients, signed wrap mod `2^18` for flock reservoirs). Never add float accumulation, rounding, clamping, saturation, or damping to a state update. Floats belong only in rendering and projections.
- Every forward operation must have an exact inverse, reachable with `{ reverse: true }` or through the paired reverse system. The inverse must use the **same** schedule index, coefficients, and neighbourhood as the forward step. Composition order matters: the reverse of `F ∘ T ∘ C` is `C⁻¹ ∘ T⁻¹ ∘ F⁻¹`.
- The integrated runtime advances an integer `transportFrame`. Do not make state transitions depend on elapsed seconds or `playbackHz`. Those control wall-clock cadence only.
- Register GPU work with `defineGpuSystem({ id, inputs, outputs, after, enabled, initialize, encode, destroy })`. Use the exported resource-ID constants (`SCS_PARTICLE_RECORDS`, `SCHEDULED_FLOCK_STATE`, …). A resource may have only one producer. System order is defined in `src/systems/scs/simulation-runtime.js`.
- Keep factories injectable (`schedulerFactory`, `streamFactory`, `engineFactory`, `shaderUrl`, timers). Tests depend on these hooks to substitute fake GPU objects.
- When you change a WGSL kernel, update the matching CPU oracle (`springs-cpu.mjs`, `flock-cpu.mjs`, `noether/icosian-e8.mjs`, `e8-physical.js`, `h4-directions.js`) and add or extend a Node round-trip test in `tests/`. If a GPU is available, run the matching Deno `validate-*-webgpu.mjs` and report the result honestly.
- `src/gpu/scs/` and `src/systems/scheduled-transport/` contain parallel copies of the radix-sort, prefix-scan, and run-range modules. Some have diverged. Edit the copy that the caller actually imports.
- `springs.html` (reversible-springs) and `index.html` (scs + scheduled-transport) are separate architectures. Don't share state code between them implicitly.
