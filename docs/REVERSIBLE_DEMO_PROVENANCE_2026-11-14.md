> Historical development checkpoint. For the released architecture and validation, see README.md, docs/SCHEDULED_LATTICE_TRANSPORT_AND_TIME.md and docs/RELEASE_VALIDATION.md. Earlier uncommitted-state notes below refer to the snapshot before public publication.

# Lapinet reversible transport demo — geometry and release provenance

Development checkpoint: 2026-11-14. This note documents the implemented demo; it is not a legal determination of authorship or ownership.

## Corrected 8D-to-3D geometry (Noether audit)

The earlier demo incorrectly presented an **H4 golden-coefficient quaternion slice**
and an optional nonlinear Hopf map as the intended E8-to-H3 downprojection.
Those are legitimate alternative H4 visualizations, but **not** the E8/H3
golden map used by the Cycles Q6 transport research. The updated selector
defaults to **E8 -> H3, Q6 scaffold**, with a full E8 root-shell and the
separate H4 comparison views available.

The source is the Cycles golden-six-axis projection in
`Cycles/work/Crystals/src/camera-presets.js` and the exact Q24 matrix in
`Cycles/work/Crystals/Q24_TABLE_FREE_ALGEBRA.md`.

Let `phi=(1+sqrt(5))/2`. For an eight-coordinate E8 vector
`x=(x0,...,x7)`, the two invisible axes are `x0,x4`; the visible
coordinates are `(x1,x2,x3,x5,x6,x7)`. The six columns are

```text
(1,phi,0) (phi,0,1) (0,1,phi)
(-1,phi,0) (phi,0,-1) (0,-1,phi)
```

The displayed map is the six-column sum divided by
`sqrt(2*(1+phi*phi))`, making the 3x8 projection's rows orthonormal.
The orientation/axes agree with Cycles; the row-orthonormal factor differs
by a global `sqrt(2)` from Q24's per-step normalization, not a change
of geometry.

- **Default Q6 scaffold**: 64 projected half-integer E8 spinor sites,
  connected by the 192 original combinatorial 6-cube sign-flip edges.
  These edges are NOT asserted to be E8 root adjacency.
- **Full E8 shell**: 112 signed two-axis integral roots plus 128
  even-parity half-integer roots = 240 exact roots in R8.
  Their images have 137 distinct sites, with projected fiber counts
  `{1:60,2:64,4:13}`. The 8D root-adjacency predicate
  `x dot y = +1` produces 6720 original edges; 112 collapse to
  points and repeated visible segments deduplicate to 2752 unique
  projected edges. They are NOT automatically nearest neighbors in R3.
- **H4 comparison views**: a different 8D integer-coefficient module
  `(a0,b0,...,a3,b3)` with `qj=(aj+phi*bj)/2`.
  Orthographic `(q1,q2,q3)` and nonlinear Hopf R3 maps are retained
  but explicitly labeled separately. The finite sample uses an
  L1 coefficient ball and H4 root steps; it is not the E8 shell.

The full infinite E8 image is dense without an acceptance window, so
this finite 240-root shell and Q6 scaffold **must not** be represented
as the complete infinite 3D quasicrystal. The simulation's present
springs/flocking/straight-line particles do NOT yet execute Cycles'
E8/Q96 transport on these higher-dimensional sites. Both overlays are
pure visual references.

The independent Cycles H4 sources remain
`Cycles/work/noether-h4-62/h4-8d-core.mjs` and
`Cycles/work/noether-h4-62/baseline/noether024-sandbox/src/noether-h4-exact.js`.

## Remaining demo visualizations

- **Moving particles (GPU)**: integer reversible spring, flock, or independent straight-line transport, with optional exact half-cell reflections.
- **Blue Cartesian reference grid**: an optional downsampled grid of the spring fixture's original 3D sites, independent of the projected E8/H3/H4 overlay.
- **Golden projected lattice**: selectable E8/H3 or H4 geometry, both display-only.
- **Trails**: GPU screen-space afterimages from a two-texture fade/composite. They are display-only and not authoritative spacetime trajectories. Their history clears when the camera moves or the simulation resets.

## Cubic demo lattice correction

The earlier demo unintentionally used a rectangular 3D fixture with
`(nx,ny,nz)=(N,N,floor(N/2))`, which visually squashed the blue grid.
The live fixture and reference-grid geometry now use **`(N,N,N)`**
for all six UI grid sizes (`N=6,8,12,16,20,24`). At the largest
setting this is `24^3=13,824` simulation particles and `39,744`
undirected central spring bonds. The display-only reference lattice
can independently sample just `4^3`, `6^3`, or `8^3` sites
without changing the simulation or its physical cube extents.

Cubic-coordinate, edge-count, and exact inversion tests now cover all
six sizes; the native 24³ GPU/CPU certificate verifies 8 forward and
8 reverse ticks with no mismatches. This change does not alter the
distinct 8D-to-3D E8/H3 projection or the separate H4 views.

## Visible reversible flocking demo

The `Flock demo` button selects a 160-particle sphere with a deterministic
counterflow seed: the two halves initially move in opposing directions
(`speed=2`, `scatter=0.28`, 1/32 coordinate units). It selects
local alignment 16/256 and hidden coupling 8/256, zero direct
spring stiffness, and a contact radius of 170% of initial lattice spacing.
The demo enables reflective walls, GPU screen-space trails, and
sampled velocity arrows (one in three particles, cyan for +X and
orange for -X). The Cartesian and higher-dimensional grid overlays
are hidden for legibility but remain available in their selectors.
The same preset is invoked when the operator selects Flocking
from the Connections dropdown.

The flocking demo advances one simulated tick per rendered frame to make\ncoordination easier to observe; the other modes retain two ticks per frame.\n\nThe flock phase consists of two antisymmetric integer shears on
visible and auxiliary hidden momenta followed by the existing
central-force and exact drift stages. Here central-force stiffness
is zero, isolating **reversible velocity alignment**. It is
NOT a dissipative Reynolds-style boids simulation with all three
alignment/cohesion/separation forces. In particular its velocity
variance is not guaranteed to decrease monotonically; the hidden
degrees of freedom retain information so reverse evolution is exact.

The deterministic demo starts with 1,044 active local pairs
among 160 particles. At tick 60 its velocity variance is about
0.1007 times the initial variance. The native GPU certificate
confirms zero GPU/CPU mismatches and zero inverse mismatches over
60 ticks; both the lattice renderer and the heading-arrow renderer
compile and draw on WebGPU. These demonstrate temporary coordination
in this initial condition, not global flocking convergence.

## Reversible full-boids extension and canvas HUD (2026-11-14)

The flocking demonstration now has **three additional live coefficients**:
cohesion, separation, and **goal steering (+X)**, alongside the existing
reversible alignment and hidden coupling. Their defaults in the
Flock demo preset are 2, 6, and 2, respectively.

The added local force stage is an exact integer **position-dependent
kick** of particle momentum: cohesion attracts pairs inside the contact
cutoff, separation repels them inside two-thirds of the cutoff, and
steering attracts each particle toward a fixed positive-X waypoint
at `round(spacing * (side-1) * 0.4)` world units. The goal has zero
Y/Z coordinates. Cohesion and separation have equal-and-opposite
pair impulses, whereas steering is an external force and thus
**does not generally conserve total particle-only momentum**.

Each kick depends on positions, which remain unchanged during this
stage. Forward evolution applies hidden shear, visible shear, boids
kick, spring kick, then reversible drift. Reverse evolution performs
the corresponding inverse stages in reverse order. This is not a
dissipative boids integrator: speed/variance need not converge
monotonically. Each live coefficient edit is recorded on the existing
timeline, so backward and forward replay use the appropriate values.

The `Hide HUD` button controls only the floating in-canvas diagnostics
panel. It does not hide the canvas, overlays, particle sprites, trails,
or underlying physical state.

Verification: twenty focused CPU tests pass, including force direction,
pairwise momentum conservation, an external-steering momentum exception,
exact 25-tick forward/reverse inversion across live edits; the native
WebGPU test additionally certifies 160 particles, thirty ticks with
two live coefficient edits, GPU/CPU parity, exact inverse, and
deterministic replay (zero mismatches). The full regression suite
passes 137/137. This validation is a technical reproducibility
record, not a legal authorship certificate.

## Standalone publishing

The demo consists of HTML, JavaScript modules, and WGSL shaders only. There is no Python, network API, model service, or backend simulation dependency. A WebGPU-capable browser is required. File-module imports should be served over HTTP on localhost or HTTPS in production, rather than opening `springs.html` as a `file://` URL.

To serve it locally using the project's bundled Node server:

```sh
cd Lapinet
node scripts/static-server.mjs
# open http://127.0.0.1:1351/springs.html
```

For public release, deploy the entire `Lapinet` directory to any HTTPS static-file host, preserving the `src/` paths and `.wgsl` files. The Node server itself binds only to localhost and is for development; it is not a public hosting service.

## Current unsigned/uncommitted state

At this checkpoint, the Lapinet directory and the two Cycles root-generation source files are not tracked in their respective Git repositories. The local SHA-256 manifest at `docs/DEMO_SHA256_MANIFEST_2026-11-14.json` fingerprints the current source/test files, but has no signature or independent timestamp. **Do not publish an authorship or ownership claim as verified based on this fingerprint alone.** Commit both projects, secure the relevant rights and contribution attribution, then sign and independently timestamp the release before using it as evidence.

## Reproducibility and evidence

1. Preserve the Cycles E8/H3 golden projection sources, the alternative H4 root sources, the bundled modules, simulation kernels, and test sources together in version control.
2. Publish a repository commit that identifies both the Lapinet and Cycles source revisions. Record the SHA-256 manifest of demo sources. A hash demonstrates file identity only, **not** authorship.
3. For a stronger, externally checkable record, sign the release commit/tag using a cryptographically verifiable developer key and publish it with a trusted timestamp or independently archived copy.
4. Label all named contributors and their contributions according to actual agreements and evidence. Verify licensing/assignment before asserting exclusive rights. No code comment, web page, hash, or autogenerated claim alone proves ownership.
5. Capture dated screenshots and keep the hardware parity certificates, plus the reproducible test commands below.

## Test commands

```sh
cd Lapinet
node --test tests/reversible-springs.mjs
deno run --allow-read --unstable-webgpu src/systems/reversible-springs/validate-flock-webgpu.mjs
deno run --allow-read --unstable-webgpu src/systems/reversible-springs/validate-demo-webgpu.mjs
```

The GPU validation is optional for static deployment, but requires a WebGPU-enabled Deno runtime when run headlessly.
