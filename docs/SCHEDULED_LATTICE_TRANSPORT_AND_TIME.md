# Scheduled E8/H4 lattice transport: events without a fixed Δt

**Lapinet research note · 2026-11-14 · code-backed description**

## The claim, precisely

A classical explicit integrator computes a new state with a user-chosen time increment, such as `x_(n+1) = x_n + v_n Δt`. Its approximation and stability can depend on the size of `Δt`. Lapinet's **integrated scheduled lattice transport** defines transitions over a discrete finite state directly from root channels and a deterministic schedule. This removes a *numerical time step* from the transport rule.

It does **not** remove event order, an integer schedule index, wall-clock playback cadence, or the option to assign physical durations. The software models a discrete ordered dynamics, not an empirical demonstration of timeless physics.

## 1. Authoritative state

See `src/systems/scheduled-transport/gpu-scheduled-e8-stream.wgsl`, `gpu-exact-site-scheduler.js`, `src/systems/scs/simulation-runtime.js`, and `src/systems/scheduled-transport/noether/icosian-e8.mjs`.

For each particle the GPU holds a packed `vec4<u32>` record (16 bytes):

- Eight signed/modular coefficients in `(Z / 4096 Z)^8`, encoded as eight 12-bit values in the first three words.
- The fourth word is a directed E8 root channel in a 240-channel alphabet.
- Stable identity is carried separately so sorting/collision scheduling does not redefine the particle.

A channel chooses one lattice root `r_c`. Coordinates change by exact modular integer addition/subtraction, not floating-point integration. Different E8/H4 geometric embeddings are for locality and rendering, not replacements for the authoritative eight-coordinate state.

## 2. The lattice schedule

The WGSL kernel defines an integer gate invariant `g(k,c)` from the current modular coordinates `k`, E8 Gram matrix, and chosen root, and evaluates:

\[
\theta_n(k,c)
= \bigl(g(k,c)+n\,s+\mathrm{seed}\bigr)\bmod 4096 .
\]

With threshold `h` (configured in the range `0..4096`):

\[
T_n(k,c)=
\begin{cases}
(k+r_c \pmod{4096},\,c),&\theta_n(k,c)<h\\
(k,c),&\text{otherwise}.
\end{cases}
\]

Inverse transport uses the **same event index** and corresponding inverse root operation, with the gate designed to agree across that transition. The actual GPU shader has extra steering-dependent channel selection and checks whether the projected locality cell changed.

The default scheduler depends on the integer `transportFrame`; it does not sample elapsed seconds to decide whether a particle hops. The gate contains `frame * E8_STRIDE`, which defines a discrete modular phase. The scheduler itself can be paused, run at any chosen playback rate, or reversed through prior frame indices.

**This is not a continuous-time solution.** It does not imply one hop equals one second or that lattice positions reconstruct physical trajectories without an interpretation.

## 3. Reversible composition

Let `C_n` denote exact-site scatter/collision scheduling, `T_n` the scheduled root transport, and `F_n` the reversible flock update evaluated with the corresponding post-transport locality. Composition acts on the *full* state (`E8 records, channel, stable identity, steering/hidden reservoir`).

One logical forward frame applies these operations in the documented sequence:

```text
exact-site collision schedule
  → scheduled E8 root stream
  → physical H4/R4 locality refresh and spatial centroids
  → reversible hidden/visible flock shears
  → state at next schedule index
```

Backward execution is the inverse composition:

```text
inverse flock shears, using the same post-stream neighborhood
  → inverse scheduled root stream
  → inverse exact-site collision schedule
  → rebuild locality for restored positions
```

At the group-theoretic level, if `U_n = F_n ∘ T_n ∘ C_n`, then

\[
U_n^{-1}=C_n^{-1}\circ T_n^{-1}\circ F_n^{-1}.
\]

The ordering is essential. A reverse button that simply negated a floating velocity while retaining a dissipative alignment pass would **not** satisfy this contract.

## 4. Flocking without irreversible averaging

`src/systems/scheduled-transport/scheduled-flock.wgsl` uses a finite auxiliary state per particle:

```text
steer  : i32 × 4
hidden : i32 × 4
```

Each vector is canonically wrapped modulo `2^18` to the signed range `[-131072, 131071]`. This is not clipping: modular addition and subtraction remain exact permutations, subject to bounded intermediate arithmetic.

Reversible hidden and visible shears exchange information between these reservoirs. The symmetric locality fan is determined by deterministic R4 Morton-sort order: for a sorted particle, visit up to four records on either side. The current integrated implementation computes **block centroids** for the cohesion term and uses near-field neighbor separation; it does not simply copy the standalone spring-demo pair-force law. The finite reservoir supports exact rewind even when headings seem to align temporarily.

H4 steering chooses from a 120-direction 600-cell alphabet (two radial shells give 240 transport channels). A precomputed 17-candidate list per sign orthant yields the same maximum dot-product choice as a full 120-direction search in the audited candidate-selection tests.

The integrated scheduled flock has an explicit frame-based progression and a render-only trailing particle-history buffer. Display history is not authoritative simulation state.

## 5. Distinct: the springs.html prototype

The compact springs/boids page was developed as an independently reversible GPU reference. Its state is integer position, integer momentum, and optional hidden velocity state. It advances via invertible integer **kick / shear / drift** stages and optional half-cell wall folds. It is still a *tick-indexed* dynamics; its unit drift operation is not the E8 scheduled root gate.

Cohesion and separation use equal-and-opposite pair kicks at currently sensed positions; external fixed-goal steering need not conserve particle-only momentum. Live coefficient changes are stored in a history indexed by tick, so replay and inverse cross each coefficient boundary with the correct parameters.

The golden E8→H3 and H4 quaternion/Hopf visual overlays in this page are **not connected to this solver's particle transport**, nor do they establish 3D Euclidean nearest-neighbor relations for E8. The integrated main Lapinet runtime, not this compact demo, contains the scheduled E8 engine.

## 6. What happened to “time”?

A mathematically honest replacement for `Δt` is a **transition order** `n`, with state

\[
S_{n+1}=U_n(S_n),\qquad S_n=U_n^{-1}(S_{n+1}).
\]

No numerical time interval is required by `U_n`. A separate application may choose an increasing map `t=\tau(n)` that assigns event timestamps or rates; it is *not part of the lattice transport map*. In the app, `playbackHz` chooses how quickly the host submits scheduled events; changing that affects wall-clock progress, not the exact state reached after the same sequence of events.

This permits a state-first or event-first interpretation of simulation. It does **not** alone establish a fundamental law of nature, relativistic invariance, a conserved physical energy, or a unique correspondence to laboratory seconds. Those are separate scientific questions.

## 7. Limits and certificates

- The current finite 12-bit modular coefficients and signed 18-bit reservoir have domain and wraparound boundaries. Integer overflow in intermediates must be accounted for explicitly; exact forward/inverse behavior is demonstrated within tested states.
- The compact demo's all-pairs interactions scale quadratically; its prototype cap is separate from the integrated Morton/SCS path.
- The scheduled flock's centroid cohesion need not conserve particle-only momentum; it is a different force model from pair-central isolated springs.
- Dated development reports (`docs/SCHEDULED_FLOCKING_V0_2026-11-14.md`, `SCHEDULED_FLOCKING_FAST_PATH_2026-11-14.md`, `SCHEDULED_FLOCKING_COHESION_FIX_2026-11-14.md`) record observed 262,144-particle GPU behavior and exact rewind. Their performance figures are configuration/hardware observations, not portable guarantees.
- The release's Node tests and optional WebGPU certificates supply executable evidence; hashes establish byte identity, not mathematical novelty or rights.

## 8. Source locations

- `src/systems/scheduled-transport/gpu-exact-site-scheduler.js` and `gpu-exact-site-scheduler.wgsl` — exact-site schedule/collision layer
- `src/systems/scheduled-transport/gpu-scheduled-e8-stream.js` and `gpu-scheduled-e8-stream.wgsl` — root gate and modular stream
- `src/systems/scheduled-transport/scheduled-flock.js` and `scheduled-flock.wgsl` — 18-bit reservoir and reversible steering
- `src/systems/scheduled-transport/h4-directions.js` — 120 directions / exact 17-candidate selection
- `src/systems/scs/simulation-runtime.js` — schedule-frame advancement, inversion, playback rate (outside the state map)
- `src/systems/reversible-springs/` — alternative spring/boids dynamics with its own tests
- `tests/scheduled-flock.mjs`, `tests/scs-simulation.mjs`, `tests/reversible-springs.mjs` — structure and inverse assertions

**The distinction to preserve in public claims: no fixed integration time step ≠ no ordered events ≠ no physical time.**
