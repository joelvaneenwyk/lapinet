import {
  createGpuBuffer,
} from "../gpu/resources.js";

function requireTypedArray(value, label) {
  if (!ArrayBuffer.isView(value)) {
    throw new TypeError(`${label} must be a typed array`);
  }
  return value;
}

function makeBuffer(device, label, data) {
  const usage = globalThis.GPUBufferUsage;
  if (!usage) {
    throw new Error("GPUBufferUsage is unavailable");
  }

  return createGpuBuffer(device, {
    label,
    data: requireTypedArray(data, label),
    usage: usage.STORAGE | usage.COPY_DST,
    alignment: 16,
  });
}

export class PrimitiveSource {
  constructor({
    device,
    splats,
    thinLines,
    thickLines,
    sdfSplats,
    polygons,
  }) {
    if (!device) {
      throw new TypeError("PrimitiveSource requires a GPUDevice");
    }

    this.device = device;
    this.counts = Object.freeze({
      splats: Math.floor(splats.length / 8),
      thinLines: Math.floor(thinLines.length / 16),
      thickLines: Math.floor(thickLines.length / 16),
      sdfSplats: Math.floor(sdfSplats.length / 16),
      polygonVertices: Math.floor(polygons.length / 8),
    });

    this.buffers = Object.freeze({
      splats: makeBuffer(
        device,
        "Lapinet primitive splats",
        splats
      ),
      thinLines: makeBuffer(
        device,
        "Lapinet primitive thin lines",
        thinLines
      ),
      thickLines: makeBuffer(
        device,
        "Lapinet primitive thick lines",
        thickLines
      ),
      sdfSplats: makeBuffer(
        device,
        "Lapinet primitive SDF splats",
        sdfSplats
      ),
      polygons: makeBuffer(
        device,
        "Lapinet primitive polygon vertices",
        polygons
      ),
    });
  }

  resources() {
    return Object.freeze({
      ...this.buffers,
      counts: this.counts,
    });
  }

  destroy() {
    for (const buffer of Object.values(this.buffers)) {
      buffer.destroy?.();
    }
  }
}
