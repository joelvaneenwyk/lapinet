# Reproducibility, integrity, and attribution

**Publication scope:** standalone public Lapinet research snapshot curated by GitHub account [@alleycatsphinx](https://github.com/alleycatsphinx), 2026-11-14 (Pacific time).

## Source publication record

The public repository is a **separate export** from an actively developed local/private Lapin working tree. It includes the Lapinet HTML frontends, modules, WGSL shaders, scheduled transport, CPU reference, Deno GPU checks, and Node tests. It intentionally excludes local runtime state, temporary developer diagnostics, and private browser-bridge setup documentation. It does not expose or overwrite the larger private Lapin repository.

The public source contains **two** distinct implementations: the compact reversible spring/flock demo in `springs.html` and the integrated event-scheduled E8/H4 engine launched from `index.html`. Their architectures are documented in `SCHEDULED_LATTICE_TRANSPORT_AND_TIME.md`.

The code references prior Cycles research artifacts in mathematical source comments and local historical notes. Selected H4 root directions and the E8→H3 golden projection were adapted from the user's Cycles research. Paths in older notes under `Cycles/work/...` document origin but are **not required at runtime** and are not automatically included by reference.

## Integrity record

A Git commit object has a content-derived hash identifying a particular versioned tree, parentage, and commit metadata. The tag references that commit. Its displayed Git SHA is the version identifier; it is **not** an independent timestamp attestation.

`SHA256SUMS` lists **SHA-256 hashes of the exact bytes of every released regular file except the hash list itself**. A verifier can check:

```sh
shasum -a 256 -c SHA256SUMS
# or
sha256sum -c SHA256SUMS
git rev-parse HEAD
git show --stat --oneline HEAD
```

Use the GitHub commit URL and release tag to locate this snapshot. The manifest is produced over the release directory, excludes local `.git` state, and is sorted by relative path. Hashes detect accidental or deliberate byte changes when compared against a trusted record; they do not identify who independently authored those bytes.

## Tests and scope

The curated standalone snapshot was tested with:

```sh
npm test
npm run check
```

At publication preparation: **137/137 Node tests passed** after updating the fake-GPU simulation test harness to account for the current GPU particle-trail copy pass. The harness change records a mock buffer-copy command but does not change simulation kernels.

GPU-specific checks are separate and require an available adapter:

```sh
deno run --allow-read --unstable-webgpu scripts/validate-scheduled-transport-webgpu.mjs
deno run --allow-read --unstable-webgpu src/systems/reversible-springs/validate-flock-webgpu.mjs
deno run --allow-read --unstable-webgpu src/systems/reversible-springs/validate-demo-webgpu.mjs
```

Any dated 262,144-particle benchmarks in historical documents are measurements from the original integrated system and need not be reproducible on every machine or the published preset. A browser deployment requires HTTPS for general remote origin WebGPU use, or localhost for local testing.

## Authorship versus identity versus legal ownership

The repository establishes a **publicly inspectable record** of source bytes associated with a GitHub account at a particular GitHub commit/release. It does **not**, by itself, prove that the account holder first conceived the underlying mathematics, owned every contribution, secured assignments, or has enforceable exclusive rights. AI assistance and collaborative development are part of this project's history. Commit timestamps are not equivalent to a signed trusted timestamp.

A stronger documentary chain should include the original source history, dated records, contributors' consent/assignments where applicable, signed tags or commits from keys tied to their actual publishers, independently verifiable publication timestamps, and explicit rights/licensing decisions.

**No software license is granted merely by publishing this snapshot.** No claim is made here that the included mathematical constructions are patentable, novel in the legal sense, or a validated fundamental physical law.

## Mathematical claim boundaries

The scheduled E8/H4 implementation advances by an **ordered integer lattice-event index without a numerical integration `Δt`**. This eliminates an integrator parameter, not time as an observable or chronology as a concept. The spring demo instead uses its own reversible integer tick map. Exact inverse checks apply to the tested finite-state algorithms, not to all arbitrary possible values or to energy conservation. Published geometry overlays are finite samples and may be many-to-one.

## Snapshot preparation / exclusions

The export intentionally omits:

- `.runtime/`: local runtime and ephemeral state
- Developer-only scratch utilities (`.perf-audit.mjs` and `.precision-final-validate.mjs`)
- `docs/LAPINET_BROWSER_BRIDGE.md`: private local browser-bridge setup
- Any files outside the `Lapinet/` project directory, particularly the unrelated private parent repository's ongoing work

Project author/maintainer identification: **@alleycatsphinx**, as the GitHub account submitting this publication. AI-assisted code and peer research are acknowledged without inventing names or assigning legal rights.
