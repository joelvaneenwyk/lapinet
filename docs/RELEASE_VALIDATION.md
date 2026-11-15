# Validation record — Lapinet public snapshot

Date of local preparation: **2026-11-14** (America/Los_Angeles).

## Reproducible checks performed on the curated standalone publication tree

| Check | Scope | Result |
|---|---|---|
| `npm test` | Complete Node source/test suite | **137 passed, 0 failed** |
| `npm run check` | Project JavaScript syntax and module checks | **Passed** |
| `deno run --allow-read --unstable-webgpu scripts/validate-scheduled-stream-webgpu.mjs 256 4` | Scheduled E8 GPU root stream, CPU oracle, exact inverse | **Passed**, 256 particles × 4 frames |
| `deno run --allow-read --unstable-webgpu scripts/validate-scheduled-transport-webgpu.mjs 4096 4` | Combined exact-site collision + E8 transport | **Inconclusive:** execution limit reached; not claimed as passed in this new snapshot |

Additional reversible spring/flock WebGPU results were recorded in the dated `docs/REVERSIBLE_*` reports and scripts. The integrated scheduled-flock `262,144`-particle performance and reversibility results appear in dated `docs/SCHEDULED_FLOCKING_*` reports; these are historical observations, not a freshly rerun release certificate.

The two simulation architectures are **distinct**. In particular, `springs.html` is a compact reversible integer model; `index.html` integrates scheduled E8/H4 root transport. Passing a test for one does not automatically certify the other.

## One staged test-harness compatibility correction

The release snapshot's `tests/scs-simulation.mjs` fake GPU encoder implements the `copyBufferToBuffer` method required by the existing render-only trail history. The reset assertion accounts for that captured mock copy. This is a **test-harness correction only**, not a change to simulation, renderer or scheduled transport kernels.

## Limits

Test results are hardware-specific and version-specific; Node tests alone do not establish correct WebGPU rendering in every browser. Integer inverses are certified for exercised state domains; this does not establish unconstrained absence of intermediate overflow. A GitHub release hash establishes byte identity and provenance as described in [reproducibility and attribution](REPRODUCIBILITY_AND_ATTRIBUTION.md), but does not establish exclusive ownership or a law of nature.

## Public preset regression

Two additional Node assertions verify the photographed seven coefficients, removal of the two header phrases, exact Flock demo setter values, and automatic playback. The new public-demo-defaults.mjs suite is included in the **139/139** result.
