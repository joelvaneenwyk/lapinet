function frozenMetadata(metadata) {
  return Object.freeze({ ...(metadata ?? {}) });
}

export class GpuResourceRegistry {
  constructor() {
    this.records = new Map();
  }

  publish(
    id,
    {
      resource,
      kind = "buffer",
      owner = null,
      owned = false,
      metadata = {},
    }
  ) {
    if (typeof id !== "string" || !id) {
      throw new TypeError("GPU resource id must be a non-empty string");
    }
    if (!resource) {
      throw new TypeError(`GPU resource ${id} requires a resource object`);
    }
    if (this.records.has(id)) {
      throw new Error(`GPU resource already published: ${id}`);
    }

    const record = Object.freeze({
      id,
      resource,
      kind,
      owner,
      owned: !!owned,
      metadata: frozenMetadata(metadata),
    });

    this.records.set(id, record);
    return record;
  }

  has(id) {
    return this.records.has(id);
  }

  get(id) {
    return this.records.get(id) ?? null;
  }

  require(id) {
    const record = this.get(id);
    if (!record) {
      throw new Error(`GPU resource is unavailable: ${id}`);
    }
    return record;
  }

  resource(id) {
    return this.require(id).resource;
  }

  list() {
    return [...this.records.values()];
  }

  release(id, { owner = undefined } = {}) {
    const record = this.records.get(id);
    if (!record) return false;

    if (owner !== undefined && record.owner !== owner) {
      throw new Error(
        `GPU resource ${id} is owned by ${record.owner ?? "no owner"}`
      );
    }

    this.records.delete(id);
    if (record.owned) {
      record.resource.destroy?.();
    }
    return true;
  }

  releaseOwner(owner) {
    const ids = this.list()
      .filter((record) => record.owner === owner)
      .map((record) => record.id);

    for (const id of ids) {
      this.release(id, { owner });
    }

    return ids.length;
  }
}
