import assert from "node:assert/strict";
import test from "node:test";

import {
  PerspectiveCamera,
} from "../src/render/camera.js";
import {
  OrbitFlightCameraController,
  bindOrbitFlightCamera,
} from "../src/render/camera-controls.js";

class FakeTarget {
  constructor() {
    this.listeners = new Map();
    this.ownerDocument = null;
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type, event = {}) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }
}

test("orbit camera rotates around a stable target and changes radius", () => {
  const camera = new PerspectiveCamera();
  const controller = new OrbitFlightCameraController({
    camera,
    mode: "orbit",
  });

  const before = controller.snapshot();
  const targetBefore = [...before.orbitTarget];
  const positionBefore = [...camera.position];

  controller.applyMouseDelta(120, -40);
  assert.deepEqual(controller.snapshot().orbitTarget, targetBefore);
  assert.notDeepEqual(camera.position, positionBefore);

  controller.keyDown("KeyW");
  controller.tick(0.1, { allowMovement: true });
  controller.keyUp("KeyW");

  assert.ok(controller.snapshot().orbitRadius < before.orbitRadius);
  assert.deepEqual(camera.target, targetBefore);
});

test("orbit camera reaches the float32 precision regime", () => {
  const camera = new PerspectiveCamera({
    position: [0, 0, -1],
    target: [0, 0, 0],
  });
  const controller = new OrbitFlightCameraController({
    camera,
    mode: "orbit",
  });

  for (let i = 0; i < 220; i += 1) {
    controller.zoomOrbit(0.9);
  }

  const state = controller.snapshot();
  assert.ok(state.orbitRadius < 1e-9);
  assert.equal(camera.near, 0);
  assert.ok(Math.hypot(
    camera.target[0] - camera.position[0],
    camera.target[1] - camera.position[1],
    camera.target[2] - camera.position[2],
  ) > 0);
});

test("optical orbit zoom reaches float32 angular precision without moving the camera", () => {
  const camera = new PerspectiveCamera({
    position: [0, 0, -2],
    target: [0, 0, 0],
  });
  const controller = new OrbitFlightCameraController({
    camera,
    mode: "orbit",
  });
  const position = [...camera.position];

  for (let i = 0; i < 64; i += 1) {
    controller.zoomView(0.5);
  }

  assert.deepEqual(camera.position, position);
  assert.ok(camera.fovY < 1e-8);
  assert.ok(camera.fovY > 0);

  for (let i = 0; i < 64; i += 1) {
    controller.zoomView(2);
  }

  assert.ok(Math.abs(camera.fovY - controller.baseFovY) < 1e-12);
});

test("orbit keyboard motion remains proportional at microscopic radii", () => {
  const camera = new PerspectiveCamera({
    position: [0, 0, -1e-6],
    target: [0, 0, 0],
    near: 0,
  });
  const controller = new OrbitFlightCameraController({
    camera,
    mode: "orbit",
  });
  const before = controller.snapshot().orbitRadius;

  controller.keyDown("KeyW");
  controller.tick(0.1, { allowMovement: true });
  controller.keyUp("KeyW");

  const after = controller.snapshot().orbitRadius;
  assert.ok(after < before);
  assert.ok(after > before * 0.8);
});

test("free-flight camera moves in view space with WASD + QE", () => {
  const camera = new PerspectiveCamera();
  const controller = new OrbitFlightCameraController({
    camera,
    mode: "free",
    moveSpeed: 2,
  });

  const before = [...camera.position];
  controller.keyDown("KeyW");
  controller.keyDown("KeyE");
  controller.tick(0.1, { allowMovement: true });
  controller.clearKeys();

  assert.notDeepEqual(camera.position, before);
  assert.ok(camera.position[1] > before[1]);
  assert.equal(controller.mode, "free");
});

test("O selects orbit, F selects free, Space locks camera", () => {
  const document = new FakeTarget();
  document.pointerLockElement = null;

  const surface = new FakeTarget();
  surface.ownerDocument = document;
  let lockRequests = 0;
  let exits = 0;
  surface.requestPointerLock = () => {
    lockRequests += 1;
    document.pointerLockElement = surface;
    document.dispatch("pointerlockchange");
    return Promise.resolve();
  };
  document.exitPointerLock = () => {
    exits += 1;
    document.pointerLockElement = null;
    document.dispatch("pointerlockchange");
  };

  const camera = new PerspectiveCamera();
  const controller = new OrbitFlightCameraController({
    camera,
    mode: "orbit",
  });
  const modes = [];
  const locks = [];
  let rafCallback = null;

  const binding = bindOrbitFlightCamera(
    surface,
    controller,
    {
      document,
      requestAnimationFrame(callback) {
        rafCallback = callback;
        return 1;
      },
      cancelAnimationFrame() {},
      onModeChange(mode) {
        modes.push(mode);
      },
      onLockChange(locked) {
        locks.push(locked);
      },
    }
  );

  surface.dispatch("click");
  assert.equal(lockRequests, 1);
  assert.equal(binding.pointerLocked, true);

  document.dispatch("keydown", {
    code: "KeyF",
    repeat: false,
    target: null,
    preventDefault() {},
  });
  assert.equal(controller.mode, "free");

  document.dispatch("keydown", {
    code: "KeyO",
    repeat: false,
    target: null,
    preventDefault() {},
  });
  assert.equal(controller.mode, "orbit");
  assert.deepEqual(modes, ["free", "orbit"]);

  document.dispatch("keydown", {
    code: "Space",
    repeat: false,
    target: null,
    preventDefault() {},
  });
  assert.equal(binding.cameraLocked, true);
  assert.equal(exits, 1);
  assert.deepEqual(locks, [true]);

  const before = [...camera.position];
  controller.keyDown("KeyW");
  rafCallback?.(1000);
  rafCallback?.(1100);
  assert.deepEqual(camera.position, before);

  document.dispatch("keydown", {
    code: "Space",
    repeat: false,
    target: null,
    preventDefault() {},
  });
  assert.equal(binding.cameraLocked, false);
  assert.deepEqual(locks, [true, false]);
  assert.equal(lockRequests, 2);

  binding.destroy();
});

test("inward orbit wheel optically zooms around the rendered surface target", async () => {
  const document = new FakeTarget();
  document.pointerLockElement = null;
  const surface = new FakeTarget();
  surface.ownerDocument = document;
  surface.requestPointerLock = () => Promise.resolve();

  const camera = new PerspectiveCamera({
    position: [0, 0, -2],
    target: [0, 0, 0],
  });
  const controller = new OrbitFlightCameraController({
    camera,
    mode: "orbit",
  });
  const baseFov = camera.fovY;

  let targetReads = 0;
  const binding = bindOrbitFlightCamera(
    surface,
    controller,
    {
      document,
      requestAnimationFrame() {
        return 1;
      },
      cancelAnimationFrame() {},
      async resolveOrbitTarget() {
        targetReads += 1;
        return [0, 0, -1];
      },
    }
  );

  surface.dispatch("wheel", {
    deltaY: -Math.log(2) * 1000,
    preventDefault() {},
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  const inward = controller.snapshot();
  assert.equal(targetReads, 1);
  assert.deepEqual(inward.orbitTarget, [0, 0, -1]);
  assert.ok(Math.abs(inward.orbitRadius - 1) < 1e-9);
  assert.ok(Math.abs(camera.position[2] + 2) < 1e-9);
  assert.ok(Math.abs(camera.fovY - baseFov * 0.5) < 1e-9);

  surface.dispatch("wheel", {
    deltaY: -Math.log(2) * 1000,
    preventDefault() {},
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(targetReads, 1);
  assert.deepEqual(controller.snapshot().orbitTarget, [0, 0, -1]);
  assert.ok(Math.abs(camera.position[2] + 2) < 1e-9);
  assert.ok(Math.abs(camera.fovY - baseFov * 0.25) < 1e-9);

  surface.dispatch("wheel", {
    deltaY: Math.log(4) * 1000,
    preventDefault() {},
  });
  assert.equal(targetReads, 1);
  assert.ok(
    Math.abs(controller.snapshot().orbitRadius - 1) < 1e-9
  );
  assert.ok(Math.abs(camera.position[2] + 2) < 1e-9);
  assert.ok(Math.abs(camera.fovY - baseFov) < 1e-9);
  assert.deepEqual(controller.snapshot().orbitTarget, [0, 0, -1]);

  binding.destroy();
});

test("editing controls do not capture camera hotkeys", () => {
  const document = new FakeTarget();
  document.pointerLockElement = null;
  const surface = new FakeTarget();
  surface.ownerDocument = document;
  surface.requestPointerLock = () => Promise.resolve();

  const camera = new PerspectiveCamera();
  const controller = new OrbitFlightCameraController({
    camera,
    mode: "orbit",
  });

  const binding = bindOrbitFlightCamera(
    surface,
    controller,
    {
      document,
      requestAnimationFrame() {
        return 1;
      },
      cancelAnimationFrame() {},
    }
  );

  document.dispatch("keydown", {
    code: "KeyF",
    repeat: false,
    target: {
      tagName: "INPUT",
      type: "number",
      isContentEditable: false,
    },
  });

  assert.equal(controller.mode, "orbit");
  binding.destroy();
});
