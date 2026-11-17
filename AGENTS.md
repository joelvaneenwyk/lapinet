# AGENTS.md — Lapinet

Guidance for AI coding agents (GitHub Copilot, Claude Code, Codex, etc.) and humans working in this repository.

## What this repo is

Lapinet is a **static, browser-native WebGPU research snapshot** of *reversible* particle simulation. There is no build step, no bundler, and no npm dependencies: HTML + ES modules + WGSL shaders are served as-is.

It contains **two independent simulation architectures**. Keep them separate. A change, test, or claim about one does not carry over to the other.

| | Reversible springs & boids | Integrated scheduled E8/H4 lattice |
|---|---|---|
| Entry page | `springs.html` | `index.html` |
| Entry module | `src/systems/reversible-springs/springs-view.js` | `src/main.js` |
| State | Integer position + integer momentum (+ optional hidden velocity), `PARTICLE_STRIDE = 8` | Packed `vec4<u32>` per particle: eight 12-bit modular E8 coefficients + a root channel (0..239); separate stable IDs; `i32×4` steer/hidden reservoirs wrapped mod `2^18` |
| Step | Invertible integer **kick / shear / drift** stages with reflective walls, indexed by tick | Integer **schedule index** `n`: exact-site collision → scheduled E8 root stream → R4/SCS locality refresh → reversible flock shears. **No numerical Δt** |
| Neighbours | All-pairs (O(N²), capped grid) | R4 Morton order, symmetric ±4 fan, GPU radix sort / prefix scan |
| CPU oracle | `springs-cpu.mjs`, `flock-cpu.mjs`, `springs-timeline.mjs` | `noether/icosian-e8.mjs`, `e8-physical.js`, `h4-directions.js` |
| GPU validators (Deno) | `src/systems/reversible-springs/validate-*-webgpu.mjs` | `scripts/validate-scheduled-*-webgpu.mjs`, `scripts/validate-scs-webgpu.mjs` |

The E8→H3 / H4 overlays in `springs.html` are **visual references only**. They are not the springs solver's transport graph.

The central invariant everywhere is **exact reversibility**. Running the inverse operations in reverse order must restore the state bit-for-bit. See `docs/SCHEDULED_LATTICE_TRANSPORT_AND_TIME.md` (the main technical note) for the math.

## Commands

The preferred entry point is [Task](https://taskfile.dev) via `taskfile.yaml`. It runs the same way on Windows, macOS, and Linux:

```sh
task                 # list tasks
task serve           # (aliases: start, server) static server on :1351; PORT=8080 task serve
task test            # Node test suite
task check           # node --check on every tracked .js/.mjs (broader than npm run check)
task validate        # check + test + version:check — run before finishing any change
task gpu             # all Deno WebGPU validators (needs deno + GPU); also gpu:scheduled, gpu:springs, ...
task sums            # regenerate SHA256SUMS (release step); task sums:verify to check
```

The equivalent raw commands:

```sh
node scripts/static-server.mjs     # serves repo root at http://127.0.0.1:1351 (PORT env overrides)
#   http://127.0.0.1:1351/springs.html   compact springs/boids demo
#   http://127.0.0.1:1351/               integrated scheduled-transport runtime
npm test                           # node --test tests/*.mjs  (139 tests, no GPU needed, uses fakes)
npm run check                      # node --check syntax pass over most modules (POSIX shell syntax)
```

**Windows:** `npm run check` uses a POSIX `for` loop and fails under cmd.exe (`f was unexpected at this time`). Run it with Git Bash as the script shell:

```powershell
npm run check --script-shell="C:\Program Files\Git\bin\bash.exe"
```

**Optional real-GPU validation** needs a WebGPU-enabled Deno and a GPU adapter. These checks do not run on ordinary CI runners:

```sh
deno run --allow-read --unstable-webgpu scripts/validate-scheduled-stream-webgpu.mjs 256 4
deno run --allow-read --unstable-webgpu scripts/validate-scheduled-transport-webgpu.mjs
deno run --allow-read --unstable-webgpu src/systems/reversible-springs/validate-flock-webgpu.mjs
deno run --allow-read --unstable-webgpu src/systems/reversible-springs/validate-demo-webgpu.mjs
npm run validate:scs | validate:implicit | validate:particles
```

**In the integrated page:**
- A bottom-centre bar switches between the two pages and picks the render **View** (final image or a G-buffer target) and the implicit **Field**.
- The **Stats** panel shows render FPS and frame time, renderer and simulation state, transport frame `n`, measured event rate against `playbackHz`, the GPU adapter, and the build version.
- Hotkeys:
  - `` ` `` toggles Stats.
  - `V` / `Shift+V` cycles the View; `G` / `Shift+G` cycles the Field.
  - `P` pauses rendering, `T` pauses the simulation, `R` restarts it.
  - `Ctrl/Cmd+Shift+C` / `Ctrl/Cmd+Shift+D` toggle the Config / Displays panels.
- Rendering pauses while the window is unfocused (Stats shows this).

In `springs.html`, the HUD shows FPS, frame time, playback direction and ticks/s.

**Debugging a blank or black canvas:** open the browser console first. WebGPU validation errors appear there as warnings, and one invalid bind group discards the entire frame.

WebGPU in a browser requires `localhost` or HTTPS. The GitHub Pages deployment lives at `https://alleycatsphinx.github.io/lapinet/`.

## Source map

```
index.html, springs.html      Entry pages (springs.html holds its own inline UI/CSS)
src/main.js                   Integrated runtime bootstrap: config, displays, GPU, simulation, renderer (~1.2k lines)
src/version.js                LAPINET_BUILD_VERSION (shown in config UI; tested in tests/persistence.mjs)
src/config/                   Config schema, store, localStorage persistence, config panel UI
src/display/                  Dockable panel layout system; view-switcher.js (page/view bar)
src/diagnostics/              Diagnostics registry, kernel/render-target/connection/stats panels, RateMeter, frame capture
src/gpu/                      GpuContext, resource registry, GpuScheduler (dependency-ordered GPU systems)
src/gpu/scs/                  R4 space-filling-curve keys, hierarchy, radix sort, prefix scan, run ranges, neighbour lookup
src/systems/system-contract.js defineGpuSystem({ id, inputs, outputs, after, enabled, initialize, encode, destroy })
src/systems/scs/              Integrated runtime: simulation-runtime.js wires all systems; fixtures, topology gate, trails
src/systems/scheduled-transport/  E8 stream, exact-site scheduler, scheduled flock, H4 directions, icosian/E8 oracle
src/systems/reversible-springs/   Springs/boids demo: CPU oracle (.mjs), GPU solver (.js), WGSL, view, validators
src/render/                   Camera, G-buffer, implicit surface, deferred lighting, particles, cursor, debug passes
src/fields/                   Implicit SDF fields (fractal, comet, plane, none) — each JS + WGSL pair
tests/                        node:test suites (*.mjs), pure Node with fake GPU objects
scripts/                      Static server, capture server, Deno WebGPU validators and benchmarks
docs/                         Technical note, release validation, provenance, dated development reports
SHA256SUMS                    Byte-identity manifest of every tracked file except itself
```

## Architecture of the integrated runtime (`index.html`)

1. `src/main.js` builds `ConfigSystem` (schema in `config-schema.js`, persisted to `localStorage` key `lapinet.config.v1`), `DisplaySystem`, and `DiagnosticsRegistry`, then starts `GpuContext.create()`.
2. `startSimulation()` calls `createScsSimulationRuntime()` (`src/systems/scs/simulation-runtime.js`). It registers GPU systems on a `GpuScheduler` in this order: fixture → scheduled-flock state → **flock reverse** → **scheduled transport** → topology gate → R4/SCS locality → flock centroids → topology clear → **flock forward** → particle trails.
3. `GpuScheduler.compile()` topologically orders systems from their declared `inputs`/`outputs`/`after`. Each resource may have **exactly one producer**. Resource IDs are exported string constants such as `SCS_PARTICLE_RECORDS` and `SCHEDULED_FLOCK_STATE`. Import them; do not retype the strings.
4. The runtime advances an integer `transportFrame`. `playbackHz` controls only wall-clock cadence and never changes the state reached after a given event sequence. Reverse runs the inverse composition `C⁻¹ ∘ T⁻¹ ∘ F⁻¹` using the same frame index.
5. `startRenderer()` runs the deferred pipeline: G-buffer → implicit surface → deferred lighting → primitives/particles/cursor → optional debug passes.

Factories accept injectable dependencies (`engineFactory`, `transportFactory`, `schedulerFactory`, `setTimer`, `now`, …). The tests replace GPU objects through these hooks, so keep new code injectable the same way.

## Conventions

- **Plain ES modules, zero dependencies.** Do not add npm packages, a bundler, TypeScript, or a framework without the maintainer's explicit approval. `package.json` is `"type": "module"`.
- **WGSL loading:** shaders sit next to their JS module and load via `new URL("./x.wgsl", import.meta.url)` passed as an overridable `shaderUrl` option. Keep JS/WGSL pairs co-located and identically named.
- **Cache-busting query strings:** pages and `springs-view.js` import with `?v=...` suffixes (for example `src/main.js?v=0.1.0-dev.20261114.26` and `springs-gpu.js?v=live4`). When you change a module the browser must re-fetch, bump the relevant `?v=` token. For the integrated runtime, bump `src/version.js` and the two `?v=` strings in `index.html` together.
- **Integer-exact simulation code:** state math uses integers, `Math.imul`, `>>> 0`, `| 0`, and explicit modular wrap. Never introduce floating-point accumulation, rounding, clamping, or "damping" into an authoritative state update. Floats are fine in rendering and visual projections.
- **Every forward operation needs an exact inverse** and must be reachable with `{ reverse: true }`, or through the corresponding reverse system. The inverse must use the *same* parameters and neighbourhood as the forward step. That is why live coefficients are recorded per tick in `springs-timeline.mjs`.
- **CPU oracle first:** when changing a GPU kernel, update or add the matching CPU reference (`*-cpu.mjs` or the `noether/` oracle). Add a Node test for forward→reverse round-trip (compare with `checksum()` or deep equality). Then, if a GPU is available, run the matching Deno validator.
- **Code style follows the file.** The `src/main.js`, `src/config`, `src/display`, and `src/render` modules use 2-space indentation and double quotes. The `reversible-springs` and `gpu/scs` modules use a compact one-space/single-quote style. Match the surrounding file; there is no formatter or linter configured.
- **Duplicated GPU primitives:** `src/gpu/scs/` and `src/systems/scheduled-transport/` each have `gpu-prefix-scan`, `gpu-radix-*`, and `gpu-run-ranges`. Some are byte-identical. `gpu-radix-sort.js` and `gpu-run-ranges.js` have diverged: the `gpu/scs` copy supports indirect dispatch and `digitCount`. Check which copy a caller imports before editing, and do not "deduplicate" without running all tests.
- `npm run check` lists files explicitly and does **not** cover `src/systems/scheduled-transport/` or `src/systems/reversible-springs/`. Those are exercised through `npm test` imports instead. Add new top-level modules to the `check` script.

## Testing

- `node --test tests/*.mjs` with `node:assert/strict`. No GPU is needed. Tests construct fake devices and encoders. For example, `tests/scs-simulation.mjs` fakes `copyBufferToBuffer`, and `tests/gpu-foundation.mjs` covers scheduler ordering.
- Some tests read WGSL source as text and assert on specific lines with regex (for example `tests/cursor.mjs`). Shader edits can break these on purpose; update the assertion only when the change is intentional.
- `tests/public-demo-defaults.mjs` pins the published springs preset: stiffness 20, rest 91%, contact 210%, alignment 0, hidden 0, deformation 15, edge opacity 55%, cohesion 2, separation 6, goal 2. These values are documented in `README.md`. Change the test, the README, and the HTML together, or not at all.
- `tests/persistence.mjs` checks config migration and the version label. Keep `LAPINET_BUILD_VERSION` in sync.

## Docs and claims discipline

This is a research publication. The docs carefully state what is and isn't claimed. When editing `README.md` or `docs/`:

- Do not claim energy conservation, a physical theory of timelessness, novelty, patentability, or ownership. "No numerical Δt" means only that the transport map has no integrator time-step parameter.
- Keep the two implementations distinct in prose: `springs.html` does **not** run the scheduled E8 engine.
- Files under `docs/REVERSIBLE_*_2026-11-14.md` and `docs/SCHEDULED_*_2026-11-14.md` are **dated historical checkpoints**. Do not rewrite their results. Add new dated notes instead.
- Performance figures (for example 262,144 particles) are hardware observations, not guarantees.
- `README.md` math uses `$$ ... $$` blocks that render on GitHub. Preserve that form.

## Release integrity and licensing

- `SHA256SUMS` covers **every git-tracked file except itself**, sorted in C locale. Adding, removing, or editing any tracked file makes it stale. Regenerate it as a deliberate release step, not in every commit:

  ```sh
  task sums            # cross-platform; identical output to:
  git ls-files | grep -vx SHA256SUMS | LC_ALL=C sort | xargs sha256sum > SHA256SUMS
  sha256sum -c SHA256SUMS
  ```

- **No license is granted** in this snapshot (see README "Attribution and terms"). Do not add a LICENSE file, license headers, or a `"license"` field unless the maintainer asks.
- Do not commit `.runtime/`, `.env*`, logs, or private browser-bridge material (see `.gitignore` and `docs/REPRODUCIBILITY_AND_ATTRIBUTION.md`).

## Checklist before finishing a change

1. `task validate` passes. Without Task, run `npm test` plus `npm run check`; on Windows, run the check with the Git Bash script shell.
2. New files are tracked by git, so `task check` and `task sums` include them.
3. Reversibility: any new or modified state operation has a round-trip test.
4. `?v=` cache-bust tokens are bumped for changed browser-loaded modules.
5. README/docs updated if user-visible behaviour, defaults, or claims changed.
6. Mention whether GPU validators were run. Do not report them as passed if they weren't.
