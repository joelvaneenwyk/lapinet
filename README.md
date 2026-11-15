# Lapinet — reversible lattice simulation

**A browser-native WebGPU research snapshot of reversible particle maps and scheduled E8/H4 lattice transport.**

This repository publishes two distinct implementations:

1. **[Reversible springs and boids](springs.html)** — integer-coordinate springs, ballistic travel, reflective walls, reversible alignment/cohesion/separation and waypoint steering, live coefficient histories, forward/reverse playback, trails, and 3D/8D-projection overlays.
2. **[Integrated scheduled lattice simulation](index.html)** — E8/H4 root-channel transport with an integer frame-indexed gate, exact-site scheduling, R4/SCS locality, and finite reversible flock reservoirs. This path has **no physical timestep in its transport equation**.

Both are static HTML/JavaScript/WGSL applications. No Python, external API, or cloud model is required. Run a local HTTP server or deploy over HTTPS; a WebGPU-capable browser is required.

## Run

```sh
git clone https://github.com/alleycatsphinx/lapinet.git
cd lapinet
node scripts/static-server.mjs
```

Open `http://127.0.0.1:1351/springs.html` for the compact demo and `http://127.0.0.1:1351/` for the integrated scheduled-transport runtime.

The 2026-11-14 photographed coefficient preset is the startup default and is applied when **Flock demo** launches: spring strength **20**, rest length **91%**, contact radius **210%**, alignment **0**, hidden coupling **0**, initial deformation **15**, and edge opacity **55%**. The three newer boids strengths not present in the photograph remain cohesion **2**, separation **6**, and goal steering **2**.

With alignment and hidden coupling at zero, the preset demonstrates position-dependent cohesion/separation/steering but disables velocity-alignment exchanges; raise those two sliders to re-enable the reversible alignment mechanism.

In the spring demo, select **Flock demo**, adjust the live coefficients, and use **Reverse** to rewind exact state. **Hide HUD** hides only the floating diagnostics. Blue Cartesian and amber E8→H3/H4 overlays are independent visual references—not the spring solver's transport graph.

## Why scheduled transport removes the fixed time-step requirement

The integrated engine stores discrete packed E8 lattice records. For an integer schedule index `n`, root channel `c`, and state `k`, it evaluates

$$
\theta_n(k,c)=\bigl(g(k,c)+n\,s+\mathrm{seed}\bigr)\bmod 4096.
$$

When `θ_n < threshold`, the corresponding root transition occurs; otherwise the record is unchanged. Exact-site collision operations and reversible flock updates compose in a prescribed order; running those inverse operations in reverse order restores the state.

**The state transition needs no numerical `Δt` and does not integrate velocity over arbitrary elapsed-time increments.** The schedule index still provides *ordered events*. One may add a mapping to physical time if a model needs one. This is an algorithmic property, **not proof that physical time ceases to exist**. Rendering refresh and scheduled event throughput are independent.

**[Read the mathematical explanation](docs/SCHEDULED_LATTICE_TRANSPORT_AND_TIME.md)**, including the distinction from the separate springs demo and the limits of these claims.

## Mechanisms

- **Scheduled E8:** 240 directed root channels; eight modular 12-bit coefficients packed with channel into a 16-byte GPU record; deterministic root transitions and exact-site collision scheduling.
- **Scheduled H4 steering:** a 120-direction alphabet over two radial shells, 17 sign-compatible direction candidates per orthant, and four-component steering/hidden reservoirs wrapped modulo `2^18`.
- **Locality:** symmetric ±4-neighbor fan in deterministic R4 Morton order, rather than all-pairs search for the integrated flock path.
- **Reversible springs/boids:** integer shears, position-dependent kicks, and invertible drift/reflection. Pairwise cohesion/separation conserve particle momentum under bounded arithmetic; optional externally imposed goal steering need not.
- **Visualization:** the E8→H3 six-axis golden projection and H4 quaternion/Hopf views are labeled separately. Their 3D overlays do not define the simulation collision metric.

## Reproducibility

```sh
npm test
npm run check
# Optional native GPU checks with WebGPU-enabled Deno
deno run --allow-read --unstable-webgpu scripts/validate-scheduled-transport-webgpu.mjs
deno run --allow-read --unstable-webgpu src/systems/reversible-springs/validate-flock-webgpu.mjs
deno run --allow-read --unstable-webgpu src/systems/reversible-springs/validate-demo-webgpu.mjs
```

Check bytes using `shasum -a 256 -c SHA256SUMS` (or GNU `sha256sum -c SHA256SUMS`), and identify the exact Git tree with `git rev-parse HEAD`. The manifest excludes itself to avoid a self-referential hash.

**[Source, validation and authorship record](docs/REPRODUCIBILITY_AND_ATTRIBUTION.md)** explains what Git and SHA-256 do—and do not—prove.

## Scope and limitations

The spring demo **does not itself run the lattice-scheduled E8 engine**; both implementations are included so claims can be reproduced and compared. Neither exact rewind nor the absence of a numerical timestep establishes energy conservation or a physical theory of timelessness. The integrated simulation uses finite modular state and an ordered event index. The compact boids demo has an all-pairs contact cost, and GPU workloads remain hardware-dependent.

Earlier `docs/REVERSIBLE_*` and `docs/SCHEDULED_*` reports are dated development checkpoints; this README and the new technical note describe this public release.

## Attribution and terms

Published by **[@alleycatsphinx](https://github.com/alleycatsphinx)** as a technical research snapshot, with AI-assisted development. Publication and hash evidence establish **file identity and a GitHub record**, not exclusive authorship, patent priority, or legal ownership.

**No license grant is asserted in this snapshot.** Public access does not by itself confer permission to reuse the code. Licensing and contributor rights remain to be resolved.

2026-11-14.
