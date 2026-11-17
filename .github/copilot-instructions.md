# Copilot instructions — Lapinet

The full agent guide is in [`AGENTS.md`](../AGENTS.md). Read it first. This file keeps the essentials short.

## Project in one paragraph

Lapinet is a static WebGPU research app with **no build step and no npm dependencies**. It is plain HTML + ES modules + WGSL, served directly. It has two **separate** reversible simulations:

- `springs.html`: integer springs/boids demo (`src/systems/reversible-springs/`).
- `index.html`: the integrated scheduled E8/H4 lattice runtime (`src/main.js` → `src/systems/scs/simulation-runtime.js` → `src/systems/scheduled-transport/`). Its transport advances by an integer schedule index with no numerical Δt.

## Commands

Use `task` (`taskfile.yaml`; works the same on all platforms). `task serve`, `task test`, `task check`, `task validate` (run before finishing), `task gpu`, `task sums`. Raw equivalents:

- Serve: `node scripts/static-server.mjs` → http://127.0.0.1:1351/
- Test: `npm test` (Node `node:test`, fake GPU, no adapter needed)
- Syntax check: `npm run check`. It needs a POSIX shell; on Windows add `--script-shell="C:\Program Files\Git\bin\bash.exe"`.
- Real-GPU validators: `deno run --allow-read --unstable-webgpu <validator>.mjs`. These are optional and need a GPU.

## Rules that matter most

1. **Exact reversibility is the core invariant.** Authoritative state updates are integer/modular only: no float accumulation, clamping, or damping. Every forward op has an exact inverse that uses the same parameters and neighbourhood. Add a forward→reverse round-trip test for any state change.
2. **Keep the two simulations distinct** in code and prose. The springs demo does not run the E8 engine.
3. **GPU systems** go through `defineGpuSystem` (`src/systems/system-contract.js`) and `GpuScheduler`. Declare `inputs`/`outputs`/`after` using exported resource-ID constants. Each resource has exactly one producer.
4. **Shaders** live next to their JS module and load via `new URL("./x.wgsl", import.meta.url)`. Keep the pairs co-located.
5. **Cache-busting:** bump `?v=` query tokens when you change browser-loaded modules. For `index.html`, keep `src/version.js` and both `?v=` strings in sync.
6. **Match the local file's style.** There is no formatter. Some modules use 2-space/double quotes; the springs and `gpu/scs` modules use a compact single-quote style.
7. **No new dependencies, bundlers, TypeScript, or LICENSE** without the maintainer's explicit request.
8. **Claims discipline in docs:** no assertions of energy conservation, physical timelessness, novelty, or ownership. Dated `docs/*_2026-11-14.md` reports are historical records; don't rewrite them.
9. `SHA256SUMS` is a release manifest of every tracked file. It goes stale on any change. Regenerate it only as an explicit release step (command in AGENTS.md).
