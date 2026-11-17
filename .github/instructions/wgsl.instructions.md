---
applyTo: "**/*.wgsl"
description: "Conventions for WGSL shaders"
---

# WGSL shaders

- Each shader sits next to the JS module that loads it via `new URL("./name.wgsl", import.meta.url)`. Keep file names paired (`foo.js` ↔ `foo.wgsl`). If you rename one, rename the other and update the `shaderUrl` default.
- Bind group layouts, struct layouts, and workgroup sizes are mirrored in the JS host (buffer sizes, `dispatchWorkgroups` counts, uniform packing). Change both sides together. Particle records in the scheduled path are `vec4<u32>` (16 bytes): eight 12-bit E8 coefficients in words 0–2 and the root channel in word 3.
- **`layout: "auto"` drops bindings that an entry point never reads.** Passing such an entry to `createBindGroup` makes the bind group invalid, and with it the whole frame's command buffer. On the integrated page that meant a solid black screen. Give each auto-layout pipeline only the bindings its entry points use (see `ParticleDebugPass.TRAIL_BINDINGS`/`EDGE_BINDINGS`), or create an explicit `GPUBindGroupLayout`. Check the browser console for `binding index N not present in the bind group layout`.
- Simulation kernels must stay integer-exact and invertible. Use `u32`/`i32` arithmetic with explicit wrap, no `f32` in authoritative state updates, and the same gate/neighbourhood evaluation for forward and inverse passes.
- Some Node tests read WGSL as text and regex-match specific lines (for example `tests/cursor.mjs`). Run `npm test` after shader edits.
- Node tests do not execute WGSL. For real execution, use the Deno validators (`deno run --allow-read --unstable-webgpu ...`) on a machine with a GPU, or load the page in a WebGPU browser via `node scripts/static-server.mjs`.
- If the browser must pick up the change, bump the importing module's `?v=` cache-bust token.
