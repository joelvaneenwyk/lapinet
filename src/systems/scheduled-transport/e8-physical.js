import {
  E8_BASIS,
  PHI,
} from "./noether/icosian-e8.mjs";

export const E8_MODULUS = 4096;
export const E8_MASK = E8_MODULUS - 1;
export const ONE_Q16 = 65536;
export const PHI_Q16 = 106039;

export function signedE8Coefficient(value) {
  const v = Number(value) & E8_MASK;
  return v >= 2048 ? v - E8_MODULUS : v;
}

export function signedE8Coefficients(coords) {
  if (!coords || coords.length !== 8) {
    throw new TypeError("expected eight E8 coefficients");
  }
  return Array.from(coords, signedE8Coefficient);
}

export function icosianNumeratorFromStoredE8(coords) {
  const k = signedE8Coefficients(coords);
  return Array.from({ length: 8 }, (_, row) =>
    E8_BASIS.reduce(
      (sum, column, col) =>
        sum + column[row] * k[col],
      0
    )
  );
}

export function physical4FromStoredE8(coords) {
  const z = icosianNumeratorFromStoredE8(coords);
  return Array.from(
    { length: 4 },
    (_, axis) =>
      (
        z[axis * 2] +
        PHI * z[axis * 2 + 1]
      ) / 2
  );
}

export function physical4FixedFromStoredE8(coords) {
  const z = icosianNumeratorFromStoredE8(coords);
  return Array.from(
    { length: 4 },
    (_, axis) =>
      Math.trunc(
        (
          z[axis * 2] * ONE_Q16 +
          z[axis * 2 + 1] * PHI_Q16
        ) / 2
      )
  );
}
