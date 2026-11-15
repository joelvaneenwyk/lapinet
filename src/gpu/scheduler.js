import {
  GpuResourceRegistry,
} from "./resource-registry.js";
import {
  defineGpuSystem,
} from "../systems/system-contract.js";

function enabled(system, frame) {
  if (typeof system.enabled === "function") {
    return !!system.enabled(frame);
  }
  return system.enabled !== false;
}

export class GpuScheduler {
  constructor({
    gpu,
    resources = new GpuResourceRegistry(),
  }) {
    if (!gpu) {
      throw new TypeError("GpuScheduler requires a GpuContext");
    }

    this.gpu = gpu;
    this.resources = resources;
    this.systems = new Map();
    this.order = null;
    this.initialized = false;
    this.frameIndex = 0;
  }

  register(definition) {
    if (this.initialized) {
      throw new Error("GPU systems must be registered before initialize()");
    }

    const system = defineGpuSystem(definition);
    if (this.systems.has(system.id)) {
      throw new Error(`GPU system already registered: ${system.id}`);
    }

    this.systems.set(system.id, system);
    this.order = null;
    return system;
  }

  compile() {
    const producers = new Map();

    for (const system of this.systems.values()) {
      for (const output of system.outputs) {
        if (producers.has(output)) {
          throw new Error(
            `GPU resource ${output} has multiple producers: ` +
            `${producers.get(output)} and ${system.id}`
          );
        }
        producers.set(output, system.id);
      }
    }

    const dependencies = new Map();
    for (const system of this.systems.values()) {
      const deps = new Set(system.after);

      for (const dependency of system.after) {
        if (!this.systems.has(dependency)) {
          throw new Error(
            `GPU system ${system.id} depends on unknown system ${dependency}`
          );
        }
      }

      for (const input of system.inputs) {
        const producer = producers.get(input);
        if (producer && producer !== system.id) {
          deps.add(producer);
        } else if (!producer && !this.resources.has(input)) {
          throw new Error(
            `GPU system ${system.id} has unresolved input ${input}`
          );
        }
      }

      dependencies.set(system.id, deps);
    }

    const indegree = new Map();
    const outgoing = new Map();
    for (const id of this.systems.keys()) {
      indegree.set(id, 0);
      outgoing.set(id, new Set());
    }

    for (const [id, deps] of dependencies) {
      indegree.set(id, deps.size);
      for (const dep of deps) {
        outgoing.get(dep).add(id);
      }
    }

    const ready = [...this.systems.keys()]
      .filter((id) => indegree.get(id) === 0)
      .sort();
    const order = [];

    while (ready.length > 0) {
      const id = ready.shift();
      order.push(id);

      for (const next of outgoing.get(id)) {
        const remaining = indegree.get(next) - 1;
        indegree.set(next, remaining);
        if (remaining === 0) {
          ready.push(next);
          ready.sort();
        }
      }
    }

    if (order.length !== this.systems.size) {
      throw new Error("GPU system dependency graph contains a cycle");
    }

    this.order = Object.freeze(order);
    return this.order;
  }

  async initialize() {
    if (this.initialized) return this;

    const order = this.order ?? this.compile();

    for (const id of order) {
      const system = this.systems.get(id);
      await system.initialize?.({
        gpu: this.gpu,
        resources: this.resources,
        scheduler: this,
        system,
      });

      for (const output of system.outputs) {
        const record = this.resources.require(output);
        if (record.owner !== system.id) {
          throw new Error(
            `GPU system ${system.id} must own published output ${output}`
          );
        }
      }
    }

    this.initialized = true;
    return this;
  }

  tick(frame = {}) {
    if (!this.initialized) {
      throw new Error("GpuScheduler must be initialized before tick()");
    }

    const frameState = Object.freeze({
      frameIndex: this.frameIndex,
      ...frame,
    });
    const activeSystems = this.order
      .map((id) => this.systems.get(id))
      .filter((system) => enabled(system, frameState));

    if (activeSystems.length === 0) {
      this.frameIndex += 1;
      return null;
    }

    const encoder = this.gpu.createCommandEncoder(
      `Lapinet compute frame ${this.frameIndex}`
    );

    for (const system of activeSystems) {
      system.encode({
        gpu: this.gpu,
        resources: this.resources,
        encoder,
        frame: frameState,
        scheduler: this,
        system,
      });
    }

    const commandBuffer = this.gpu.submit(encoder);
    this.frameIndex += 1;
    return commandBuffer;
  }

  async destroy() {
    const order = [...(this.order ?? [])].reverse();

    for (const id of order) {
      const system = this.systems.get(id);
      await system.destroy?.({
        gpu: this.gpu,
        resources: this.resources,
        scheduler: this,
        system,
      });
      this.resources.releaseOwner(id);
    }

    this.initialized = false;
  }
}
