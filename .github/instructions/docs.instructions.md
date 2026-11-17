---
applyTo: "docs/**,README.md"
description: "Claims discipline and history rules for research docs"
---

# Research documentation

- This is a research publication with careful claim boundaries. Do not assert energy conservation, a physical theory of timelessness, relativistic invariance, novelty, patentability, exclusive authorship, or legal ownership. "No numerical Δt" means only that the transport map has no integrator time-step parameter. Event order and a schedule index remain.
- Always distinguish the two implementations: `springs.html` (compact reversible springs/boids) does **not** run the scheduled E8/H4 engine in `index.html`.
- `docs/REVERSIBLE_*_2026-11-14.md` and `docs/SCHEDULED_*_2026-11-14.md` are dated historical checkpoints. Don't rewrite their findings. Add a new dated document instead and link it.
- Report only validation that was actually run. Mark GPU checks as inconclusive or not run when that is the case (see the style of `docs/RELEASE_VALIDATION.md`).
- Math uses `$$ ... $$` display blocks and inline `` `code` `` for symbols so it renders on GitHub. Keep that style.
- No license is granted. Do not add license language beyond what README "Attribution and terms" already states.
- Any edit changes file bytes and makes `SHA256SUMS` stale. Regenerate it only as part of an explicit release step.
