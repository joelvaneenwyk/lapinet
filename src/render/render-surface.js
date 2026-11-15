export class RenderSurface {
  static create({
    gpu,
    canvas,
    format = null,
    alphaMode = "opaque",
    clearColor = { r: 0, g: 0, b: 0, a: 1 },
  }) {
    if (!gpu?.device || !canvas?.getContext) {
      throw new TypeError("RenderSurface requires GpuContext and canvas");
    }

    const context = canvas.getContext("webgpu");
    if (!context) {
      throw new Error("Canvas WebGPU context is unavailable");
    }

    const preferred =
      format ??
      globalThis.navigator?.gpu?.getPreferredCanvasFormat?.();
    if (!preferred) {
      throw new Error("WebGPU canvas format is unavailable");
    }

    context.configure({
      device: gpu.device,
      format: preferred,
      alphaMode,
    });

    return new RenderSurface({
      gpu,
      canvas,
      context,
      format: preferred,
      clearColor,
    });
  }

  constructor({
    gpu,
    canvas,
    context,
    format,
    clearColor,
  }) {
    this.gpu = gpu;
    this.canvas = canvas;
    this.context = context;
    this.format = format;
    this.clearColor = { ...clearColor };
    this.passes = [];
    this.listeners = new Set();

    this.requested = false;
    this.running = false;
    this.manualPaused = false;
    this.focusPaused = false;
    this.raf = null;
    this.frameIndex = 0;
    this.boundFrame = () => this.frame();
  }

  addPass(pass) {
    if (!pass?.encode) {
      throw new TypeError("Render pass must implement encode(encoder, context)");
    }
    if (this.passes.includes(pass)) return pass;
    this.passes.push(pass);
    return pass;
  }

  removePass(pass) {
    const index = this.passes.indexOf(pass);
    if (index < 0) return false;
    this.passes.splice(index, 1);
    return true;
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event) {
    const frozen = Object.freeze({ ...event });
    for (const listener of this.listeners) {
      listener(frozen);
    }
  }

  state() {
    return Object.freeze({
      requested: this.requested,
      running: this.running,
      paused: this.manualPaused || this.focusPaused,
      manualPaused: this.manualPaused,
      focusPaused: this.focusPaused,
      frameIndex: this.frameIndex,
    });
  }

  resize() {
    const ratio = Math.max(Number(globalThis.devicePixelRatio) || 1, 1);
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(Math.round(rect.width * ratio), 1);
    const height = Math.max(Math.round(rect.height * ratio), 1);
    const changed =
      this.canvas.width !== width ||
      this.canvas.height !== height;

    if (changed) {
      this.canvas.width = width;
      this.canvas.height = height;
      const size = this.size();
      this.emit({ type: "resize", size });
    }

    return changed;
  }

  size() {
    return Object.freeze([
      Math.max(this.canvas.width || 1, 1),
      Math.max(this.canvas.height || 1, 1),
    ]);
  }

  isPaused() {
    return this.manualPaused || this.focusPaused;
  }

  shouldRun() {
    return this.requested && !this.isPaused();
  }

  schedule() {
    if (!this.running || this.raf != null) return false;
    this.raf =
      globalThis.requestAnimationFrame?.(this.boundFrame) ??
      null;
    return true;
  }

  startLoop() {
    if (this.running) return false;
    this.running = true;
    this.schedule();
    this.emit({
      type: "render-state",
      state: this.state(),
    });
    return true;
  }

  stopLoop() {
    const changed = this.running || this.raf != null;
    this.running = false;

    if (this.raf != null) {
      globalThis.cancelAnimationFrame?.(this.raf);
    }
    this.raf = null;

    if (changed) {
      this.emit({
        type: "render-state",
        state: this.state(),
      });
    }
    return changed;
  }

  syncLoop() {
    return this.shouldRun()
      ? this.startLoop()
      : this.stopLoop();
  }

  setPaused(paused) {
    const next = !!paused;
    if (this.manualPaused === next) return false;
    this.manualPaused = next;
    this.syncLoop();
    this.emit({
      type: "pause",
      reason: "manual",
      paused: next,
      state: this.state(),
    });
    return true;
  }

  setFocusPaused(paused) {
    const next = !!paused;
    if (this.focusPaused === next) return false;
    this.focusPaused = next;
    this.syncLoop();
    this.emit({
      type: "pause",
      reason: "focus",
      paused: next,
      state: this.state(),
    });
    return true;
  }

  renderOnce() {
    this.resize();

    const texture = this.context.getCurrentTexture();
    const view = texture.createView();
    const encoder = this.gpu.createCommandEncoder(
      `Lapinet render frame ${this.frameIndex}`
    );

    const passClearsTarget = this.passes.some(
      (pass) => pass?.clearsTarget === true
    );

    if (!passClearsTarget) {
      const clear = encoder.beginRenderPass({
        label: "Lapinet clear",
        colorAttachments: [{
          view,
          clearValue: this.clearColor,
          loadOp: "clear",
          storeOp: "store",
        }],
      });
      clear.end();
    }

    const context = Object.freeze({
      view,
      format: this.format,
      size: this.size(),
      frameIndex: this.frameIndex,
    });

    for (const pass of this.passes) {
      pass.encode(encoder, context);
    }

    this.gpu.submit(encoder);
    this.frameIndex += 1;
    return true;
  }

  frame() {
    if (!this.running) return;

    this.raf = null;
    this.renderOnce();
    this.schedule();
  }

  start() {
    const wasRequested = this.requested;
    this.requested = true;
    const changed = this.syncLoop();

    if (!this.running && this.frameIndex === 0) {
      this.renderOnce();
    }

    return !wasRequested || changed;
  }

  stop() {
    const wasRequested = this.requested;
    this.requested = false;
    const changed = this.stopLoop();
    return wasRequested || changed;
  }
}

export function bindRenderFocusPause(
  surface,
  {
    document = globalThis.document,
    window = globalThis.window,
  } = {}
) {
  if (!surface?.setFocusPaused) {
    throw new TypeError(
      "bindRenderFocusPause requires a RenderSurface"
    );
  }

  let windowFocused =
    typeof document?.hasFocus === "function"
      ? !!document.hasFocus()
      : true;

  const sync = () => {
    const hidden = !!document?.hidden;
    surface.setFocusPaused(hidden || !windowFocused);
  };

  const onBlur = () => {
    windowFocused = false;
    sync();
  };

  const onFocus = () => {
    windowFocused = true;
    sync();
  };

  const onVisibility = () => {
    if (
      !document?.hidden &&
      typeof document?.hasFocus === "function"
    ) {
      windowFocused = !!document.hasFocus();
    }
    sync();
  };

  window?.addEventListener?.("blur", onBlur);
  window?.addEventListener?.("focus", onFocus);
  document?.addEventListener?.(
    "visibilitychange",
    onVisibility
  );

  sync();

  return {
    sync,
    destroy() {
      window?.removeEventListener?.("blur", onBlur);
      window?.removeEventListener?.("focus", onFocus);
      document?.removeEventListener?.(
        "visibilitychange",
        onVisibility
      );
      surface.setFocusPaused(false);
    },
  };
}
