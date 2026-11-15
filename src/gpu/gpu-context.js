export class GpuContext {
  constructor({ adapter = null, device }) {
    if (!device) {
      throw new TypeError("GpuContext requires a GPUDevice");
    }

    this.adapter = adapter;
    this.device = device;
    this.queue = device.queue;
    this.lost = device.lost ?? null;
  }

  static async create({
    gpu = globalThis.navigator?.gpu,
    adapterOptions = {},
    deviceDescriptor = {},
  } = {}) {
    if (!gpu?.requestAdapter) {
      throw new Error("WebGPU is unavailable");
    }

    const adapter = await gpu.requestAdapter(adapterOptions);
    if (!adapter) {
      throw new Error("No WebGPU adapter is available");
    }

    const device = await adapter.requestDevice(deviceDescriptor);
    return new GpuContext({ adapter, device });
  }

  static fromDevice(device, { adapter = null } = {}) {
    return new GpuContext({ adapter, device });
  }

  createCommandEncoder(label = "Lapinet GPU frame") {
    return this.device.createCommandEncoder({ label });
  }

  submit(encoder) {
    if (!encoder?.finish) {
      throw new TypeError("GpuContext.submit requires a command encoder");
    }

    const commandBuffer = encoder.finish();
    this.queue.submit([commandBuffer]);
    return commandBuffer;
  }

  destroy() {
    this.device.destroy?.();
  }
}
