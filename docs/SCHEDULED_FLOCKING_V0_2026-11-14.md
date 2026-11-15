# Scheduled H4 flocking v0  2026-11-14

## Summary

Lapinet now has a reversible flocking layer on top of the exact
frame-scheduled E8/H4 transport. It does not reintroduce a physical
time step, floating velocity integration, or dissipative boid averaging.

The authoritative transport state remains the packed E8 lattice record.
Flocking adds one finite auxiliary state per particle:

```
steer  : i32x4
hidden : i32x4
```

Both vectors live in an explicit signed 18-bit modular state space. The
finite reservoir stores the information ordinary alignment would discard.

## Frame ordering

Forward frame t:

1. exact-site channel scatter
2. scheduled E8 stream using the current steering state
3. rebuild / refresh physical-H4 SCS locality
4. snapshot the SCS coarse-generation uniform
5. hidden alignment shear
6. visible steering shear containing:
   - reversible alignment coupling
   - pair-central cohesion
   - pair-central separation

Reverse frame t:

1. inverse visible steering shear
2. inverse hidden alignment shear
3. inverse scheduled E8 stream using the restored steering state
4. inverse exact-site channel scatter
5. rebuild SCS for the restored position

This ordering means reverse flocking sees exactly the same physical
neighborhood that forward flocking used. No mid-frame SCS reconstruction
is required.

## H4 direction semantics

The 240 transport channels are two radial shells over the same 120 H4
directions. Scheduled flocking steers over the 120-direction alphabet
while preserving the channel shell.

The stream chooses the nearest allowed H4 direction to

```
baseDirection(channel % 120) * baseWeight + steer
```

and then applies the root from the particle's original shell.

The gate invariant is evaluated with that effective transport root, so
forward and inverse streaming select the same scheduled event.

## Locality

The flock kernel consumes the corrected physical-H4 R4/SCS index.

The current v0 neighborhood is the symmetric R4 cell stencil already
published by SCS (default radius 1). Every pair is therefore visited from
both endpoints. Integer pair terms are odd under endpoint exchange.

Alignment uses the Noether reversible two-shear construction:

```
hidden += alignment * (neighborHeading - selfHeading)
steer  -= coupling  * (neighborHidden  - selfHidden)
```

with integer /256 scaling.

Cohesion and separation are folded into the visible shear rather than
adding a third neighbor traversal. The position term is pair-central and
therefore equal/opposite for the two endpoints in unbounded integer
arithmetic.

## Finite reversible reservoir

An unconstrained prototype reached approximately 2.14e9 in the auxiliary
state after 64 frames at 262,144 particles. Exact rewind still passed, but
the state was too close to the signed-i32 boundary.

v0 therefore canonicalizes both auxiliary vectors after every shear into
signed 18-bit modular form:

```
[-131072, 131071]
```

This is a reversible finite-state operation, not a clamp. The inverse
shear subtracts the same update modulo 2^18.

It also keeps the subsequent H4 direction dot products safely inside i32.

## Default coefficients

The v0 authored defaults are:

```
alignment      12
coupling        6
baseWeight      8
cohesion       16
separation      1
restDistance    2
positionGain   64
```

Scheduled flocking itself remains disabled by default so large existing
saved particle-count configurations do not unexpectedly become more
expensive on reload.

## Certificates

### Existing Noether prototype

`validate-flock-webgpu.mjs` still passes 6/6 GPU certificates:
GPU/CPU parity, exact rewind/replay, momentum conservation in the old
momentum model, reflective enclosure, and ballistic modes.

### Scheduled flock

Real Chrome/WebGPU certificates on the integrated Lapinet runtime:

- 4,096 particles, 1 frame:
  - E8 record mismatches after forward/reverse: 0
  - flock-state mismatches: 0
- 4,096 particles, 64 alignment frames before finite-reservoir conversion:
  - record mismatches: 0
  - flock-state mismatches: 0
- 262,144 particles, 4 full alignment+cohesion+separation frames:
  - record mismatches: 0
  - flock-state mismatches: 0
- 262,144 particles, 8 full frames with the 18-bit reservoir:
  - record mismatches: 0
  - flock-state mismatches: 0
  - maximum auxiliary magnitude: 131071

### Alignment behavior

On a frozen 4,096-particle SCS neighborhood, 8 reversible alignment
shears reduced mean squared local heading disagreement from

```
130410443.1 -> 76302574.5
```

ratio: 0.5851.

### Cohesion A/B at 262,144

Same deterministic initial state, 24 frames:

Transport only:

```
occupied cells        241203
average neighbors       2.9399
neighbor fraction        0.7006
```

Full scheduled flock with finite reservoir:

```
occupied cells        240835
average neighbors       5.1266
neighbor fraction        0.7052
```

The flock therefore forms materially denser local groups without globally
collapsing the occupied-cell count.

### Performance

Continuous full-page benchmark at 262,144 particles with flocking active:

```
render                 ~60.10 FPS
scheduled flock/transport ~14.40 frames/s
simulationError        null
rendererError          null
```

Render remains independently at display refresh while scheduled transport
runs at its achievable discrete-frame rate.

## Files

Core v0 files:

- `src/systems/scheduled-transport/scheduled-flock.js`
- `src/systems/scheduled-transport/scheduled-flock.wgsl`
- `src/systems/scheduled-transport/h4-directions.js`
- `src/systems/scheduled-transport/gpu-scheduled-e8-stream.js`
- `src/systems/scheduled-transport/gpu-scheduled-e8-stream.wgsl`
- `src/systems/scheduled-transport/scheduled-transport-system.js`
- `src/systems/scs/simulation-runtime.js`
- `src/gpu/scs/gpu-r4-neighbor-lookup.js`
- `src/config/config-schema.js`
- `src/main.js`
- `tests/scheduled-flock.mjs`

## Next work

1. Replace the 120-direction brute-force root selection with an exact,
   smaller candidate mapping or symmetry lookup.
2. Reuse or replace the duplicate exact-site stable radix broadphase.
3. Add a true physical-radius cutoff on top of the current symmetric SCS
   cell stencil.
4. Port the reversible enclosure as a scheduled lattice boundary rule.
5. Add flock trails / heading diagnostics without making render state
   authoritative.
6. Explore cohesion/separation coefficient schedules and multiple flock
   species while retaining exact replay.
