---
mode: agent
description: "Add or modify a reversible state operation with CPU oracle, GPU kernel, and round-trip tests"
---

Implement this change to Lapinet's reversible simulation: **${input:change:describe the new or modified operation}**

Target simulation: **${input:target:springs (springs.html) or scheduled (index.html)}**

Follow `AGENTS.md` and `.github/instructions/simulation.instructions.md`. Work in this order:

1. **Design the inverse first.** Write down the forward map and its exact inverse in integer/modular arithmetic. State the domain where the inverse is exact (wrap moduli, intermediate overflow bounds). If no exact inverse exists, stop and explain why instead of approximating.
2. **CPU oracle:** implement it in the matching reference module (`springs-cpu.mjs` / `flock-cpu.mjs` / `springs-timeline.mjs`, or `scheduled-transport/noether` / `e8-physical.js` / `h4-directions.js`). Support `{ reverse: true }`.
3. **Round-trip test** in `tests/`: forward N ticks, reverse N ticks, then assert exact equality with the initial state. Add an edge-case test near wrap boundaries.
4. **GPU kernel + host:** update the WGSL and JS host together (bindings, struct layout, dispatch). For the integrated runtime, wire it as a `defineGpuSystem` with correct `inputs`/`outputs`/`after`, and register it in the right place in `simulation-runtime.js` for both forward and reverse.
5. **UI/config**, if needed: `config-schema.js` (integrated) or `springs.html` + `springs-view.js` (demo). Bump the relevant `?v=` cache-bust tokens.
6. **Verify:** run `npm test` and `npm run check` (use the Git Bash script shell on Windows). List the Deno GPU validator command the user should run if no GPU is available here. Don't claim it passed.
7. **Docs:** update `README.md` / the technical note only if behaviour or claims changed, following `.github/instructions/docs.instructions.md`.
