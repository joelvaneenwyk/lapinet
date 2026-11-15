function freezeKernel(kernel) {
  return Object.freeze({
    id: String(kernel.id),
    label: String(kernel.label ?? kernel.id),
    kind: String(kernel.kind ?? "unknown"),
    stage: String(kernel.stage ?? kernel.kind ?? "unknown"),
    active: kernel.active !== false,
    detail: String(kernel.detail ?? ""),
  });
}

export class DiagnosticsRegistry {
  constructor() {
    this.kernelProviders = new Map();
    this.listeners = new Set();
  }

  registerKernelProvider(provider) {
    if (!provider || typeof provider.kernelInfo !== "function") {
      throw new TypeError(
        "Kernel diagnostic provider requires kernelInfo()"
      );
    }

    const initial = provider.kernelInfo();
    if (!initial?.id) {
      throw new TypeError("Kernel diagnostic provider requires a stable id");
    }

    const id = String(initial.id);
    if (this.kernelProviders.has(id)) {
      throw new Error(`Kernel diagnostic already registered: ${id}`);
    }

    this.kernelProviders.set(id, provider);
    this.notify();
    return provider;
  }

  unregisterKernel(id) {
    const removed = this.kernelProviders.delete(String(id));
    if (removed) this.notify();
    return removed;
  }

  kernels() {
    return [...this.kernelProviders.values()]
      .map((provider) => freezeKernel(provider.kernelInfo()))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify() {
    const snapshot = this.kernels();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
    return snapshot;
  }
}
