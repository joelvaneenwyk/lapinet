import { isKeyboardEditingTarget } from "../input/control-hotkeys.js";

const clamp = (value, min, max) =>
  Math.min(Math.max(Number(value) || 0, min), max);

function normalize3(value, fallback = [0, 0, 1]) {
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

export class OrbitFlightCameraController {
  constructor({
    camera,
    mode = "orbit",
    orbitTarget = [0, 0, 0],
    moveSpeed = 0.55,
    lookSensitivity = 0.002,
    boostMultiplier = 3.25,
    onChange = () => {},
  } = {}) {
    if (!camera) {
      throw new TypeError("camera controller requires a camera");
    }

    this.camera = camera;
    this.mode = "free";
    this.orbitTarget = [...orbitTarget];
    this.orbitRadius = 1;
    this.moveSpeed = Number(moveSpeed) || 0.55;
    this.lookSensitivity = Number(lookSensitivity) || 0.002;
    this.boostMultiplier = Number(boostMultiplier) || 3.25;
    this.baseFovY = Number(camera.fovY);
    this.keys = new Set();
    this.onChange = onChange;

    this.yaw = 0;
    this.pitch = 0;
    this.deriveAnglesFromCamera();
    this.setMode(mode, { notify: false, initialize: true });
  }

  deriveAnglesFromCamera() {
    const snapshot = this.camera.snapshot();
    const forward = snapshot.forward;
    this.yaw = Math.atan2(forward[0], forward[2]);
    this.pitch = Math.asin(clamp(forward[1], -1, 1));
    return [this.yaw, this.pitch];
  }

  forward() {
    const cp = Math.cos(this.pitch);
    return normalize3([
      Math.sin(this.yaw) * cp,
      Math.sin(this.pitch),
      Math.cos(this.yaw) * cp,
    ]);
  }

  basis() {
    const forward = this.forward();
    const right = normalize3(
      cross(this.camera.worldUp, forward),
      [1, 0, 0]
    );
    const up = normalize3(cross(forward, right), [0, 1, 0]);
    return { forward, right, up };
  }

  applyView(notify = true) {
    const { forward } = this.basis();

    if (this.mode === "orbit") {
      this.camera.position = [
        this.orbitTarget[0] - forward[0] * this.orbitRadius,
        this.orbitTarget[1] - forward[1] * this.orbitRadius,
        this.orbitTarget[2] - forward[2] * this.orbitRadius,
      ];
      this.camera.target = [...this.orbitTarget];
    } else {
      this.camera.target = [
        this.camera.position[0] + forward[0],
        this.camera.position[1] + forward[1],
        this.camera.position[2] + forward[2],
      ];
    }

    if (notify) this.onChange(this.snapshot());
    return this.camera.snapshot();
  }

  initializeOrbit(target = this.orbitTarget, notify = true) {
    this.orbitTarget = [...target];
    const toward = this.orbitTarget.map(
      (value, axis) => value - this.camera.position[axis]
    );
    const distance = Math.hypot(...toward);
    this.orbitRadius = Math.max(distance, 0);

    if (distance > 0) {
      const forward = toward.map((value) => value / distance);
      this.yaw = Math.atan2(forward[0], forward[2]);
      this.pitch = Math.asin(clamp(forward[1], -1, 1));
    }

    return this.applyView(notify);
  }

  setMode(mode, { notify = true, initialize = false } = {}) {
    const next = mode === "orbit" ? "orbit" : "free";
    const changed = next !== this.mode;
    this.mode = next;

    if (next === "orbit" && (changed || initialize)) {
      this.initializeOrbit(this.orbitTarget, notify);
      return this.mode;
    }

    this.applyView(notify && (changed || initialize));
    return this.mode;
  }

  toggleMode() {
    return this.setMode(this.mode === "orbit" ? "free" : "orbit");
  }

  setMoveSpeed(value) {
    this.moveSpeed = Math.max(Number(value) || 0, 0.001);
  }

  setLookSensitivity(value) {
    this.lookSensitivity = Math.max(Number(value) || 0, 0.00001);
  }

  setBoostMultiplier(value) {
    this.boostMultiplier = Math.max(Number(value) || 0, 1);
  }

  keyDown(code) {
    this.keys.add(String(code));
  }

  keyUp(code) {
    this.keys.delete(String(code));
  }

  clearKeys() {
    this.keys.clear();
  }

  applyMouseDelta(dx, dy) {
    this.yaw += Number(dx || 0) * this.lookSensitivity;
    this.pitch = clamp(
      this.pitch - Number(dy || 0) * this.lookSensitivity,
      -1.54,
      1.54
    );
    this.applyView();
  }

  zoomOrbit(factor) {
    if (this.mode !== "orbit") return false;
    const safeFactor = clamp(factor, 0.05, 20);
    this.orbitRadius = Math.max(
      this.orbitRadius * safeFactor,
      0
    );
    this.applyView();
    return true;
  }

  zoomView(factor) {
    if (this.mode !== "orbit") return false;
    const safeFactor = clamp(factor, 0.05, 20);
    const next = this.camera.fovY * safeFactor;

    this.camera.fovY = safeFactor >= 1
      ? Math.min(next, this.baseFovY)
      : Math.max(next, Number.MIN_VALUE);

    this.onChange(this.snapshot());
    return true;
  }

  tick(dt, { allowMovement = true } = {}) {
    const delta = clamp(dt, 0, 0.1);
    if (!allowMovement || !(delta > 0)) return false;

    const boost = (
      this.keys.has("ShiftLeft") ||
      this.keys.has("ShiftRight")
    ) ? this.boostMultiplier : 1;

    const { forward, right, up } = this.basis();

    if (this.mode === "orbit") {
      const step =
        this.orbitRadius *
        0.9 *
        boost *
        delta;
      let changed = false;

      if (this.keys.has("KeyW")) {
        this.orbitRadius -= step;
        changed = true;
      }
      if (this.keys.has("KeyS")) {
        this.orbitRadius += step;
        changed = true;
      }
      this.orbitRadius = Math.max(
        this.orbitRadius,
        0
      );

      const pan = [0, 0, 0];
      const add = (basis, amount) => {
        for (let axis = 0; axis < 3; axis += 1) {
          pan[axis] += basis[axis] * amount;
        }
      };
      if (this.keys.has("KeyD")) add(right, step);
      if (this.keys.has("KeyA")) add(right, -step);
      if (this.keys.has("KeyE")) add(up, step);
      if (this.keys.has("KeyQ")) add(up, -step);

      if (pan.some((value) => value !== 0)) {
        for (let axis = 0; axis < 3; axis += 1) {
          this.orbitTarget[axis] += pan[axis];
        }
        changed = true;
      }

      if (changed) this.applyView();
      return changed;
    }

    let x = 0;
    let y = 0;
    let z = 0;
    if (this.keys.has("KeyW")) z += 1;
    if (this.keys.has("KeyS")) z -= 1;
    if (this.keys.has("KeyD")) x += 1;
    if (this.keys.has("KeyA")) x -= 1;
    if (this.keys.has("KeyE")) y += 1;
    if (this.keys.has("KeyQ")) y -= 1;

    const magnitude = Math.hypot(x, y, z);
    if (!(magnitude > 0)) return false;

    x /= magnitude;
    y /= magnitude;
    z /= magnitude;

    const speed = this.moveSpeed * boost * delta;
    this.camera.position = [
      this.camera.position[0] + (right[0] * x + forward[0] * z) * speed,
      this.camera.position[1] + (y + forward[1] * z) * speed,
      this.camera.position[2] + (right[2] * x + forward[2] * z) * speed,
    ];
    this.applyView();
    return true;
  }

  snapshot() {
    return Object.freeze({
      mode: this.mode,
      yaw: this.yaw,
      pitch: this.pitch,
      orbitTarget: Object.freeze([...this.orbitTarget]),
      orbitRadius: this.orbitRadius,
      moveSpeed: this.moveSpeed,
      lookSensitivity: this.lookSensitivity,
      boostMultiplier: this.boostMultiplier,
    });
  }
}

export function bindOrbitFlightCamera(
  surface,
  controller,
  {
    document = globalThis.document,
    window = globalThis.window,
    requestAnimationFrame =
      globalThis.requestAnimationFrame?.bind(globalThis),
    cancelAnimationFrame =
      globalThis.cancelAnimationFrame?.bind(globalThis),
    onModeChange = () => {},
    onLockChange = () => {},
    resolveOrbitTarget = null,
  } = {}
) {
  if (!surface?.addEventListener) {
    throw new TypeError("camera binding requires an event target");
  }
  if (!(controller instanceof OrbitFlightCameraController)) {
    throw new TypeError("camera binding requires OrbitFlightCameraController");
  }

  let pointerLocked = document?.pointerLockElement === surface;
  let cameraLocked = false;
  let raf = null;
  let previousTime = null;

  const requestLock = () => {
    if (cameraLocked) return false;
    if (document?.pointerLockElement === surface) return true;
    const result = surface.requestPointerLock?.();
    result?.catch?.(() => {});
    return true;
  };

  const setCameraLocked = (locked) => {
    const next = !!locked;
    if (next === cameraLocked) return false;
    cameraLocked = next;
    controller.clearKeys();
    if (cameraLocked) {
      if (document?.pointerLockElement === surface) {
        document.exitPointerLock?.();
      }
    } else {
      requestLock();
    }
    onLockChange(cameraLocked);
    return true;
  };

  const toggleCameraLocked = () =>
    setCameraLocked(!cameraLocked);

  const click = () => requestLock();
  const pointerLockChange = () => {
    pointerLocked = document?.pointerLockElement === surface;
    if (!pointerLocked) controller.clearKeys();
  };
  const mouseMove = (event) => {
    if (!pointerLocked) return;
    controller.applyMouseDelta(event.movementX, event.movementY);
  };
  const keyDown = (event) => {
    if (isKeyboardEditingTarget(event.target)) return;

    if (!event.repeat && event.code === "KeyO") {
      event.preventDefault?.();
      const mode = controller.setMode("orbit");
      onModeChange(mode);
      requestLock();
      return;
    }

    if (!event.repeat && event.code === "KeyF") {
      event.preventDefault?.();
      const mode = controller.setMode("free");
      onModeChange(mode);
      requestLock();
      return;
    }

    if (!event.repeat && event.code === "Space") {
      event.preventDefault?.();
      toggleCameraLocked();
      return;
    }

    if ([
      "KeyW",
      "KeyA",
      "KeyS",
      "KeyD",
      "KeyQ",
      "KeyE",
      "ShiftLeft",
      "ShiftRight",
    ].includes(event.code)) {
      controller.keyDown(event.code);
    }
  };
  const keyUp = (event) => controller.keyUp(event.code);
  let orbitZoomPending = false;
  let pendingOrbitZoomFactor = 1;

  const flushOrbitZoom = async () => {
    if (orbitZoomPending) return;
    orbitZoomPending = true;

    try {
      while (pendingOrbitZoomFactor < 1) {
        const factor = pendingOrbitZoomFactor;
        pendingOrbitZoomFactor = 1;

        if (
          controller.camera.fovY >= controller.baseFovY &&
          typeof resolveOrbitTarget === "function"
        ) {
          let target = null;
          try {
            target = await resolveOrbitTarget();
          } catch {
            target = null;
          }

          if (
            Array.isArray(target) &&
            target.length >= 3 &&
            target.slice(0, 3).every(Number.isFinite)
          ) {
            controller.initializeOrbit(
              target.slice(0, 3),
              false
            );
          }
        }
        controller.zoomView(factor);
      }
    } finally {
      orbitZoomPending = false;
      if (pendingOrbitZoomFactor < 1) {
        void flushOrbitZoom();
      }
    }
  };

  const wheel = (event) => {
    if (controller.mode !== "orbit") return;
    event.preventDefault?.();

    const factor = Math.exp(
      Number(event.deltaY || 0) * 0.001
    );

    if (factor >= 1 || typeof resolveOrbitTarget !== "function") {
      controller.zoomView(factor);
      return;
    }

    pendingOrbitZoomFactor *= factor;
    void flushOrbitZoom();
  };

  const frame = (time) => {
    const now = Number(time) || 0;
    const dt = previousTime == null ? 0 : (now - previousTime) / 1000;
    previousTime = now;
    controller.tick(dt, { allowMovement: pointerLocked && !cameraLocked });
    raf = requestAnimationFrame?.(frame) ?? null;
  };

  surface.addEventListener("click", click);
  surface.addEventListener("wheel", wheel, { passive: false });
  document?.addEventListener?.("pointerlockchange", pointerLockChange);
  document?.addEventListener?.("mousemove", mouseMove);
  document?.addEventListener?.("keydown", keyDown);
  document?.addEventListener?.("keyup", keyUp);
  raf = requestAnimationFrame?.(frame) ?? null;

  return {
    requestLock,
    get pointerLocked() {
      return pointerLocked;
    },
    get cameraLocked() {
      return cameraLocked;
    },
    setCameraLocked,
    toggleCameraLocked,
    destroy() {
      if (raf != null) cancelAnimationFrame?.(raf);
      controller.clearKeys();
      surface.removeEventListener?.("click", click);
      surface.removeEventListener?.("wheel", wheel);
      document?.removeEventListener?.("pointerlockchange", pointerLockChange);
      document?.removeEventListener?.("mousemove", mouseMove);
      document?.removeEventListener?.("keydown", keyDown);
      document?.removeEventListener?.("keyup", keyUp);
    },
  };
}
