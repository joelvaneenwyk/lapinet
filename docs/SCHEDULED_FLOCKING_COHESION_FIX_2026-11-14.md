# Scheduled flock cohesion correction  2026-11-14

The first fast-path flock implementation made cohesion visually weak for the
wrong reason. Position steering used a squared-distance error multiplied by
cohesion, then clamped the scalar to [-3, 3]. Typical neighbor distances were
large enough that cohesion values from small to large all hit the same clamp.
The subsequent raw displacement multiplication could also wrap the finite
18-bit steering reservoir, so very high cohesion could become less coherent.

The corrected rule is a bounded normalized pair impulse:

```
unit = (x_j - x_i) / ||x_j - x_i||_inf

if distance > restDistance:
    steer += unit * cohesion * positionGain / 2048
else if distance < restDistance:
    steer -= unit * separation * positionGain / 2048
```

Only genuinely local Morton-fan partners participate. Locality is checked
against the already-published R4 quantized cells; the allowed cell radius is
derived from restDistance. The pair rule is odd under i<->j, and the visible
flock update remains an additive modular shear, so exact reversal is retained.

## Behavior certificate

65,536 particles, 16 frames, alignment/coupling/separation disabled:

- cohesion 0:  avg local neighbors 0.677
- cohesion 16: avg local neighbors 1.760
- cohesion 64: avg local neighbors 3.078

262,144 particles with normal alignment/coupling/separation, 16 frames:

- cohesion 0:  avg local neighbors 1.911
- cohesion 64: avg local neighbors 9.248

Occupied R4 cells fell from about 258k to 234k at cohesion 64, confirming
actual spatial clumping rather than a neighborhood-count artifact.

## Reversibility

At 262,144 particles and cohesion 64:

- 16 forward + 16 reverse frames
- packed E8 word mismatches: 0
- flock-reservoir word mismatches: 0

## Performance

At 262,144 particles, cohesion 64 active:

- render: about 60.38 FPS
- scheduled flock + transport: about 29.44 frames/s
- simulationError: null
- rendererError: null

Full repository test suite: 135/135 passing.
