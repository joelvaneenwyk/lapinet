function blobFromCanvas(canvas, type = "image/png") {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Canvas capture produced no image"));
    }, type);
  });
}

export class FrameCapturePublisher {
  constructor({
    canvas,
    surface,
    endpoint = "http://127.0.0.1:1352/capture",
    intervalMs = 2000,
    maxWidth = 640,
    enabled = true,
    fetchImpl = globalThis.fetch,
    document = globalThis.document,
  }) {
    if (!canvas || !surface) {
      throw new TypeError(
        "FrameCapturePublisher requires canvas and RenderSurface"
      );
    }

    this.canvas = canvas;
    this.surface = surface;
    this.endpoint = endpoint;
    this.intervalMs = Math.max(Number(intervalMs) || 2000, 250);
    this.maxWidth = Math.max(Number(maxWidth) || 640, 64);
    this.enabled = !!enabled;
    this.fetchImpl = fetchImpl;
    this.document = document;

    this.timer = null;
    this.busy = false;
    this.lastPublishedFrame = -1;
    this.lastResult = null;
    this.lastError = null;
    this.listeners = new Set();
  }

  state() {
    return Object.freeze({
      enabled: this.enabled,
      busy: this.busy,
      intervalMs: this.intervalMs,
      maxWidth: this.maxWidth,
      lastPublishedFrame: this.lastPublishedFrame,
      lastResult: this.lastResult,
      lastError: this.lastError,
    });
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify() {
    const snapshot = this.state();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
    return snapshot;
  }

  setEnabled(enabled) {
    this.enabled = !!enabled;
    if (this.enabled) this.start();
    else this.stop();
    this.notify();
  }

  setIntervalMs(value) {
    this.intervalMs = Math.max(Number(value) || 2000, 250);
    if (this.timer != null) {
      this.stop();
      this.start();
    }
    this.notify();
  }

  setMaxWidth(value) {
    this.maxWidth = Math.max(Number(value) || 640, 64);
    this.notify();
  }

  start() {
    if (!this.enabled || this.timer != null) return false;
    this.timer = globalThis.setInterval?.(
      () => this.captureIfChanged(),
      this.intervalMs
    ) ?? null;
    globalThis.setTimeout?.(
      () => this.captureIfChanged(),
      250
    );
    return true;
  }

  stop() {
    if (this.timer == null) return false;
    globalThis.clearInterval?.(this.timer);
    this.timer = null;
    return true;
  }

  async captureIfChanged() {
    if (!this.enabled || this.busy) return false;

    const frameIndex = Math.max(
      Number(this.surface.frameIndex) || 0,
      0
    );
    if (frameIndex <= this.lastPublishedFrame) {
      return false;
    }

    return this.capture();
  }

  async capture() {
    if (this.busy) return false;
    this.busy = true;
    this.lastError = null;
    this.notify();

    try {
      const sourceWidth = Math.max(this.canvas.width || 1, 1);
      const sourceHeight = Math.max(this.canvas.height || 1, 1);
      const scale = Math.min(this.maxWidth / sourceWidth, 1);
      const width = Math.max(Math.round(sourceWidth * scale), 1);
      const height = Math.max(Math.round(sourceHeight * scale), 1);

      const output = this.document.createElement("canvas");
      output.width = width;
      output.height = height;
      const context = output.getContext("2d");
      if (!context) {
        throw new Error("2D capture context unavailable");
      }

      context.drawImage(
        this.canvas,
        0,
        0,
        sourceWidth,
        sourceHeight,
        0,
        0,
        width,
        height
      );

      const blob = await blobFromCanvas(output);
      const frame = Math.max(
        Number(this.surface.frameIndex) || 0,
        0
      );

      const response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "image/png",
          "X-Lapinet-Frame": String(frame),
          "X-Lapinet-Width": String(width),
          "X-Lapinet-Height": String(height),
        },
        body: blob,
      });

      if (!response.ok) {
        throw new Error(
          `Frame capture upload failed: ${response.status}`
        );
      }

      this.lastPublishedFrame = frame;
      this.lastResult = Object.freeze({
        frame,
        width,
        height,
        capturedAt: Date.now(),
      });
      this.notify();
      return this.lastResult;
    } catch (error) {
      this.lastError = String(error?.message ?? error);
      this.notify();
      return false;
    } finally {
      this.busy = false;
      this.notify();
    }
  }

  destroy() {
    this.stop();
    this.listeners.clear();
  }
}
