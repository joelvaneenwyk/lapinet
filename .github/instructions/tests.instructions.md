---
applyTo: "tests/**"
description: "How the Node test suite is structured"
---

# Tests

- Runner: `node --test tests/*.mjs` (`npm test`). Use `import test from 'node:test'` and `import assert from 'node:assert/strict'`. No third-party test libraries.
- No GPU is available in tests. Build minimal fake `device`, `queue`, `encoder`, and `pass` objects that record calls. Inject them through the factory hooks (`engineFactory`, `transportFactory`, `schedulerFactory`, `streamFactory`, `setTimer`, `now`). See `tests/scs-simulation.mjs` and `tests/gpu-foundation.mjs` for patterns.
- For reversible code, the canonical test is: evolve N ticks forward, then N ticks with `{ reverse: true }`, and assert the state equals the original (`assert.deepEqual` or `checksum()` from `springs-cpu.mjs`). Include ticks that cross a live-coefficient change when touching `springs-timeline.mjs`.
- `tests/public-demo-defaults.mjs` pins the published springs preset documented in `README.md`. Only change it together with the README and `springs.html`.
- `tests/persistence.mjs` asserts the version label from `src/version.js` and config migrations. Keep it in sync when bumping versions.
- Name each test as a behaviour statement (for example `'startup migrates the old 32-iteration fractal default to 40'`).
