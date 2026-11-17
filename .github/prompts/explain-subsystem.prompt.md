---
mode: ask
description: "Walk through a Lapinet subsystem: data flow, state layout, and how reversibility is achieved"
---

Explain the Lapinet subsystem **${input:subsystem:e.g. scheduled-flock, gpu-exact-site-scheduler, springs-timeline, GpuScheduler, R4 SCS locality}** to someone who knows JavaScript but is new to this codebase.

Use `AGENTS.md` and `docs/SCHEDULED_LATTICE_TRANSPORT_AND_TIME.md` for context, then read the actual source files. Cover:

1. **Which simulation it belongs to:** `springs.html` (reversible-springs) or `index.html` (integrated scheduled E8/H4). Name the entry path that reaches it.
2. **State it reads and writes:** buffer and resource IDs, byte layout, and integer ranges and wrap rules.
3. **Forward step**, as a short ordered list. Cite `file:line` for the JS host and the WGSL kernel.
4. **Inverse step**, and why it exactly undoes the forward step (same parameters, same neighbourhood, order of composition).
5. **Where it sits in the frame order** (`src/systems/scs/simulation-runtime.js` registration order, `after:` constraints).
6. **Tests and validators** that exercise it (`tests/*.mjs`, Deno `validate-*-webgpu.mjs`), and any gaps.
7. **Gotchas:** duplicated modules, cache-bust tokens, claims the docs explicitly do *not* make.

Keep claims grounded in the code. Say so when something is inferred rather than read.
