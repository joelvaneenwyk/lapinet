import {E8_ROOT_STEPS} from "./noether/icosian-e8.mjs";
import {physical4FixedFromStoredE8} from "./e8-physical.js";

export const H4_DIRECTION_COUNT = 120;
export const H4_DIRECTION_Q = 10;
export const H4_DIRECTION_SCALE = 1 << H4_DIRECTION_Q;
export const H4_EXACT_CANDIDATES = 17;

let directionCache = null;
let candidateCache = null;

export function createH4DirectionTableQ10() {
  if (directionCache) return directionCache;
  const table = new Int32Array(H4_DIRECTION_COUNT * 4);
  for (let channel = 0; channel < H4_DIRECTION_COUNT; channel += 1) {
    const stored = E8_ROOT_STEPS[channel].map((value) => value & 4095);
    const fixed = physical4FixedFromStoredE8(stored);
    for (let axis = 0; axis < 4; axis += 1) {
      table[channel * 4 + axis] = fixed[axis] >> 6;
    }
  }
  directionCache = table;
  return table;
}

function signBit(value) {
  return value >= 0 ? 1 : 0;
}

function matchesMask(table, direction, mask) {
  for (let axis = 0; axis < 4; axis += 1) {
    const value = table[direction * 4 + axis];
    if (value === 0) continue;
    const expected = (mask >> axis) & 1;
    if (signBit(value) !== expected) {
      return false;
    }
  }
  return true;
}

function nonzeroCount(table, direction) {
  let count = 0;
  for (let axis = 0; axis < 4; axis += 1) {
    if (table[direction * 4 + axis] !== 0) {
      count += 1;
    }
  }
  return count;
}

export function createH4ExactCandidateTable() {
  if (candidateCache) return candidateCache;
  const directions = createH4DirectionTableQ10();
  const table = new Uint32Array(
    16 * H4_EXACT_CANDIDATES
  );

  for (let mask = 0; mask < 16; mask += 1) {
    const candidates = [];

    // Four axial vertices, one per axis, with sign matching the orthant.
    for (let axis = 0; axis < 4; axis += 1) {
      const match = Array.from(
        { length: H4_DIRECTION_COUNT },
        (_, direction) => direction
      ).find((direction) => {
        if (nonzeroCount(directions, direction) !== 1) {
          return false;
        }
        if (directions[direction * 4 + axis] === 0) {
          return false;
        }
        return matchesMask(directions, direction, mask);
      });
      if (match == null) {
        throw new Error("missing H4 axial candidate");
      }
      candidates.push(match);
    }

    // Exactly one hypercube vertex per sign orthant.
    const hypercube = Array.from(
      { length: H4_DIRECTION_COUNT },
      (_, direction) => direction
    ).find((direction) =>
      nonzeroCount(directions, direction) === 4 &&
      matchesMask(directions, direction, mask)
    );
    if (hypercube == null) {
      throw new Error("missing H4 hypercube candidate");
    }
    candidates.push(hypercube);

    // Twelve sign-compatible golden vertices: one exact representative
    // for every even permutation of (0, 1/2phi, 1/2, phi/2).
    const golden = [];
    for (
      let direction = 0;
      direction < H4_DIRECTION_COUNT;
      direction += 1
    ) {
      if (
        nonzeroCount(directions, direction) === 3 &&
        matchesMask(directions, direction, mask)
      ) {
        golden.push(direction);
      }
    }
    if (golden.length !== 12) {
      throw new Error(
        "expected 12 H4 golden candidates, got " +
        golden.length
      );
    }
    candidates.push(...golden);

    if (candidates.length !== H4_EXACT_CANDIDATES) {
      throw new Error("invalid H4 exact candidate count");
    }

    table.set(
      candidates,
      mask * H4_EXACT_CANDIDATES
    );
  }

  candidateCache = table;
  return table;
}

export function effectiveH4Direction(
  channel,
  steering,
  baseWeight = 8
) {
  const directions = createH4DirectionTableQ10();
  const candidates = createH4ExactCandidateTable();
  const base = Number(channel) % H4_DIRECTION_COUNT;
  const desired = Array.from(
    { length: 4 },
    (_, axis) =>
      directions[base * 4 + axis] * baseWeight +
      Number(steering?.[axis] ?? 0)
  );

  let mask = 0;
  for (let axis = 0; axis < 4; axis += 1) {
    if (desired[axis] >= 0) {
      mask |= 1 << axis;
    }
  }

  const offset = mask * H4_EXACT_CANDIDATES;
  let best = candidates[offset];
  let bestDot = -Infinity;

  for (
    let i = 0;
    i < H4_EXACT_CANDIDATES;
    i += 1
  ) {
    const direction = candidates[offset + i];
    let dot = 0;
    for (let axis = 0; axis < 4; axis += 1) {
      dot +=
        directions[direction * 4 + axis] *
        desired[axis];
    }
    if (dot > bestDot) {
      bestDot = dot;
      best = direction;
    }
  }

  return best +
    (
      Number(channel) >= H4_DIRECTION_COUNT
        ? H4_DIRECTION_COUNT
        : 0
    );
}
