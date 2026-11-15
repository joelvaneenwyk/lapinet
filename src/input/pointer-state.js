const clamp01 = (value) =>
  Math.min(Math.max(Number(value) || 0, 0), 1);

export class PointerState {
  constructor() {
    this.screen = [0.5, 0.5];
    this.active = false;
    this.listeners = new Set();
  }

  set({ x = this.screen[0], y = this.screen[1], active = this.active }) {
    const next = {
      screen: [clamp01(x), clamp01(y)],
      active: !!active,
    };

    const changed =
      next.active !== this.active ||
      next.screen[0] !== this.screen[0] ||
      next.screen[1] !== this.screen[1];

    this.screen = next.screen;
    this.active = next.active;

    if (changed) {
      const snapshot = this.snapshot();
      for (const listener of this.listeners) listener(snapshot);
    }

    return this.snapshot();
  }

  snapshot() {
    return Object.freeze({
      screen: Object.freeze([...this.screen]),
      ndc: Object.freeze([
        this.screen[0] * 2 - 1,
        1 - this.screen[1] * 2,
      ]),
      active: this.active,
    });
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export function bindPointerSurface(
  surface,
  pointer,
  {
    isGpuCursorEnabled = () => false,
    activeClass = "lapinet-gpu-cursor-active",
  } = {}
) {
  if (!surface?.addEventListener) {
    throw new TypeError("bindPointerSurface requires an event target");
  }
  if (!(pointer instanceof PointerState)) {
    throw new TypeError("bindPointerSurface requires PointerState");
  }

  const ownerDocument = surface.ownerDocument ?? globalThis.document;

  const updateFromEvent = (event, active = true) => {
    const rect = surface.getBoundingClientRect();
    const locked = ownerDocument?.pointerLockElement === surface;
    pointer.set({
      x: (event.clientX - rect.left) / Math.max(rect.width, 1),
      y: (event.clientY - rect.top) / Math.max(rect.height, 1),
      active: active && !locked,
    });
    refreshCursorOwnership();
  };

  const enter = (event) => updateFromEvent(event, true);
  const move = (event) => updateFromEvent(event, true);
  const leave = () => {
    pointer.set({ active: false });
    refreshCursorOwnership();
  };

  function refreshCursorOwnership() {
    const owns =
      pointer.active &&
      ownerDocument?.pointerLockElement !== surface &&
      !!isGpuCursorEnabled();
    surface.classList?.toggle(activeClass, owns);
    return owns;
  }

  const pointerLockChange = () => refreshCursorOwnership();

  surface.addEventListener("pointerenter", enter);
  surface.addEventListener("pointermove", move);
  surface.addEventListener("pointerleave", leave);
  ownerDocument?.addEventListener?.("pointerlockchange", pointerLockChange);

  return {
    refreshCursorOwnership,
    destroy() {
      surface.removeEventListener?.("pointerenter", enter);
      surface.removeEventListener?.("pointermove", move);
      surface.removeEventListener?.("pointerleave", leave);
      ownerDocument?.removeEventListener?.("pointerlockchange", pointerLockChange);
      surface.classList?.remove(activeClass);
      pointer.set({ active: false });
    },
  };
}
