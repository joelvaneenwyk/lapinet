function lineRecord(a, b, color, width = 1) {
  return [
    ...a, 1,
    ...b, 1,
    ...color,
    width, 0, 0, 0,
  ];
}

function polygonTriangle(a, b, c, color) {
  return [
    ...a, 1, ...color,
    ...b, 1, ...color,
    ...c, 1, ...color,
  ];
}

export function createPrimitiveTestScene() {
  const splats = new Float32Array([
    -0.72, 0.40, 0.02, 0.075, 0.28, 0.78, 1.00, 0.95,
    -0.55, 0.18, -0.04, 0.055, 1.00, 0.62, 0.22, 0.92,
     0.66, 0.34, 0.03, 0.070, 0.68, 1.00, 0.42, 0.94,
  ]);

  const thinLines = new Float32Array([
    ...lineRecord(
      [-0.88, -0.36, 0.08],
      [0.88, -0.36, 0.08],
      [0.30, 0.72, 1.00, 0.62]
    ),
    ...lineRecord(
      [-0.88, -0.31, 0.08],
      [0.88, -0.31, 0.08],
      [0.90, 0.46, 0.82, 0.48]
    ),
  ]);

  const thickLines = new Float32Array([
    ...lineRecord(
      [-0.92, 0.64, 0.12],
      [-0.28, 0.76, 0.12],
      [0.20, 0.82, 1.00, 0.78],
      5
    ),
    ...lineRecord(
      [0.28, 0.76, 0.12],
      [0.92, 0.64, 0.12],
      [1.00, 0.62, 0.28, 0.78],
      8
    ),
  ]);

  // position.xyz, radius, color, shape(kind, p0, p1, p2)
  // kind 1 = rounded box, kind 2 = torus.
  const sdfSplats = new Float32Array([
    -0.58, -0.58, 0.02, 0.15,
     0.86, 0.40, 1.00, 0.90,
     1, 0.58, 0.16, 0,
     0, 0, 0, 0,

     0.58, -0.58, 0.02, 0.16,
     0.28, 1.00, 0.72, 0.90,
     2, 0.52, 0.17, 0,
     0, 0, 0, 0,
  ]);

  const polygons = new Float32Array([
    ...polygonTriangle(
      [-0.18, -0.72, 0.10],
      [0.00, -0.42, 0.10],
      [0.18, -0.72, 0.10],
      [0.94, 0.78, 0.26, 0.70]
    ),
    ...polygonTriangle(
      [-0.13, 0.48, 0.16],
      [0.00, 0.70, 0.16],
      [0.13, 0.48, 0.16],
      [0.64, 0.40, 1.00, 0.62]
    ),
  ]);

  return Object.freeze({
    splats,
    thinLines,
    thickLines,
    sdfSplats,
    polygons,
  });
}
