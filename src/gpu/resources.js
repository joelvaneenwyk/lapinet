export function alignTo(value, alignment = 4) {
  const numeric = Math.max(Math.ceil(Number(value) || 0), 0);
  const step = Math.max(Math.ceil(Number(alignment) || 1), 1);
  return Math.ceil(numeric / step) * step;
}

export function createGpuBuffer(
  device,
  {
    label,
    size,
    usage,
    data = null,
    alignment = 4,
  }
) {
  if (!device?.createBuffer) {
    throw new TypeError("createGpuBuffer requires a GPUDevice");
  }

  const byteLength = data?.byteLength ?? size;
  const alignedSize = alignTo(byteLength, alignment);
  if (alignedSize <= 0) {
    throw new RangeError("GPU buffer size must be greater than zero");
  }

  const buffer = device.createBuffer({
    label,
    size: alignedSize,
    usage,
  });

  if (data) {
    device.queue.writeBuffer(
      buffer,
      0,
      data.buffer,
      data.byteOffset,
      data.byteLength
    );
  }

  return buffer;
}
