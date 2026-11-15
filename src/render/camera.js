function normalize3(value, fallback) {
  const length = Math.hypot(value[0], value[1], value[2]);
  if (!(length > 0)) return [...fallback];
  return value.map((component) => component / length);
}

function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export class PerspectiveCamera {
  constructor({
    position = [0, 0.35, -2.2],
    target = [0, 0, 0],
    up = [0, 1, 0],
    fovY = Math.PI / 3,
    near = 0,
    far = 40,
  } = {}) {
    this.position = [...position];
    this.target = [...target];
    this.worldUp = [...up];
    this.fovY = fovY;
    this.near = near;
    this.far = far;
  }

  snapshot() {
    const forward = normalize3(
      this.target.map((value, index) => value - this.position[index]),
      [0, 0, 1]
    );
    const right = normalize3(
      cross(this.worldUp, forward),
      [1, 0, 0]
    );
    const up = normalize3(
      cross(forward, right),
      [0, 1, 0]
    );

    return Object.freeze({
      position: Object.freeze([...this.position]),
      forward: Object.freeze(forward),
      right: Object.freeze(right),
      up: Object.freeze(up),
      fovY: Number(this.fovY),
      near: Number(this.near),
      far: Number(this.far),
    });
  }
}
