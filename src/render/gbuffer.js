export class GBuffer {
  constructor(device) {
    if (!device?.createTexture) {
      throw new TypeError("GBuffer requires a GPUDevice");
    }

    this.device = device;
    this.width = 0;
    this.height = 0;
    this.textures = null;
    this.views = null;
    this.version = 0;
  }

  ensureSize(width, height) {
    const nextWidth = Math.max(Math.floor(Number(width) || 1), 1);
    const nextHeight = Math.max(Math.floor(Number(height) || 1), 1);

    if (
      this.textures &&
      this.width === nextWidth &&
      this.height === nextHeight
    ) {
      return false;
    }

    this.destroyTextures();

    const usage = globalThis.GPUTextureUsage;
    if (!usage) {
      throw new Error("GPUTextureUsage is unavailable");
    }

    const create = (
      label,
      format,
      extraUsage = 0
    ) => this.device.createTexture({
      label,
      size: [nextWidth, nextHeight, 1],
      format,
      usage:
        usage.STORAGE_BINDING |
        usage.TEXTURE_BINDING |
        extraUsage,
    });

    this.textures = Object.freeze({
      albedo: create("Lapinet GBuffer albedo", "rgba16float"),
      normal: create("Lapinet GBuffer normal", "rgba16float"),
      material: create("Lapinet GBuffer material", "rgba16float"),
      depth: create(
        "Lapinet GBuffer depth",
        "r32float",
        usage.COPY_SRC
      ),
    });

    this.views = Object.freeze({
      albedo: this.textures.albedo.createView(),
      normal: this.textures.normal.createView(),
      material: this.textures.material.createView(),
      depth: this.textures.depth.createView(),
    });

    this.width = nextWidth;
    this.height = nextHeight;
    this.version += 1;
    return true;
  }

  async readDepthAt(x, y) {
    if (!this.textures?.depth || this.width <= 0 || this.height <= 0) {
      return null;
    }

    const bufferUsage = globalThis.GPUBufferUsage;
    const mapMode = globalThis.GPUMapMode;
    if (!bufferUsage || !mapMode) {
      return null;
    }

    const px = Math.min(
      Math.max(Math.floor(Number(x) || 0), 0),
      this.width - 1
    );
    const py = Math.min(
      Math.max(Math.floor(Number(y) || 0), 0),
      this.height - 1
    );
    const readback = this.device.createBuffer({
      label: "Lapinet GBuffer depth readback",
      size: 256,
      usage: bufferUsage.COPY_DST | bufferUsage.MAP_READ,
    });

    try {
      const encoder = this.device.createCommandEncoder({
        label: "Lapinet GBuffer depth readback",
      });
      encoder.copyTextureToBuffer(
        {
          texture: this.textures.depth,
          origin: { x: px, y: py, z: 0 },
        },
        {
          buffer: readback,
          bytesPerRow: 256,
          rowsPerImage: 1,
        },
        {
          width: 1,
          height: 1,
          depthOrArrayLayers: 1,
        }
      );
      this.device.queue.submit([encoder.finish()]);
      await readback.mapAsync(mapMode.READ);
      const bytes = readback.getMappedRange(0, 4).slice(0);
      const depth = new Float32Array(bytes)[0];
      readback.unmap();
      return Number.isFinite(depth) ? depth : null;
    } finally {
      readback.destroy?.();
    }
  }

  destroyTextures() {
    if (!this.textures) return;
    for (const texture of Object.values(this.textures)) {
      texture.destroy?.();
    }
    this.textures = null;
    this.views = null;
  }

  destroy() {
    this.destroyTextures();
    this.width = 0;
    this.height = 0;
  }
}
