# Scheduled H4 flocking fast path  2026-11-14

This follow-up replaces the initial v0 flock broadphase and root selection after
live testing showed that v0 was both expensive and visually difficult to read.

## Why v0 was slow

The first integrated implementation performed two complete 4D R4 stencil
traversals per flock frame. With radius 1 that means up to 81 cells per
particle per shear, twice per frame. Scheduled streaming also searched all
120 H4 directions for every particle.

At 262,144 particles the complete flock path rendered at 60 FPS but only
advanced about 14.4 scheduled frames/s.

## Fast spatial fan

SCS already publishes particles in deterministic R4 Morton order. Flocking now
runs directly over that ordered array. Each sorted particle visits the four
preceding and four following records, giving a symmetric +/-4 spatial fan.

This removes the flock coarse lookup, 81-cell stencil search, generation
snapshot, and binary cell lookup from the flock kernels.

The relation remains symmetric: if sorted indices i and j are within the fan,
each endpoint visits the other. The two reversible shears therefore retain
their exact inverse ordering.

## Exact 17-candidate H4 selector

The 120 unit-shell H4 directions are the 600-cell vertices:

- 8 axial vertices
- 16 hypercube vertices
- 96 golden vertices

For a desired steering vector, a vertex whose nonzero coordinate sign opposes
the desired vector cannot maximize the dot product. For each of the 16 sign
orthants we precompute exactly:

- 4 sign-compatible axial vertices
- 1 sign-compatible hypercube vertex
- 12 sign-compatible golden vertices

Therefore only 17 candidates need to be scored per particle.

A 10,000-state randomized CPU certificate found zero mismatches versus the
full 120-direction maximum. This preserves full H4 turning freedom; it is not
a local-turn approximation.

## Visibility

When scheduled flocking is enabled, particle splats are rendered as short
oriented dashes instead of symmetric discs. The dash orientation is computed
from the same effective H4 direction used by scheduled transport. The forward
end is slightly brighter, making direction as well as axis visible.

No history buffer, trail simulation, or additional render pass is used.

## Current default coefficients

- alignment: 12
- reversible coupling: 6
- base-channel inertia: 4 for new/default configs
- cohesion: 16
- separation: 1
- rest distance: 2
- position gain: 64
- spatial fan: 4 records on each side in SCS order

Existing saved base-channel inertia values are preserved.

## Certificates

At 262,144 particles with flocking active:

- render: about 60.34 FPS
- scheduled flock + transport: about 29.92 frames/s
- simulationError: null
- rendererError: null

This is approximately 2x the scheduled-frame throughput of flock v0 while
retaining display-refresh rendering.

Eight forward frames followed by eight reverse frames restore:

- every packed E8 record word: exact
- every reversible flock reservoir word: exact

The exact 17-candidate selector is regression-tested against the full
120-direction search.

After 24 fast-flock frames, the R4 neighborhood metric measured about
5.19 neighbors/particle versus 2.94 for transport alone in the prior control,
so the fast version retains real local grouping rather than merely changing
headings.

Full repository test suite after the fast-path + heading-render changes:
134/134 passing.
