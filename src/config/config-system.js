function clone(value) {
  if (globalThis.structuredClone) {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

function splitPath(path) {
  if (typeof path !== "string" || path.length === 0) {
    throw new TypeError("Config path must be a non-empty string");
  }
  return path.split(".");
}

function readPath(root, path) {
  return splitPath(path).reduce(
    (current, key) => current?.[key],
    root
  );
}

function writePath(root, path, value) {
  const keys = splitPath(path);
  let current = root;

  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    const next = current[key];
    if (!next || typeof next !== "object" || Array.isArray(next)) {
      current[key] = {};
    }
    current = current[key];
  }

  current[keys.at(-1)] = value;
}

function normalizeField(field, value) {
  if (field.type === "boolean") {
    return typeof value === "boolean" ? value : field.default;
  }

  if (field.type === "number") {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return field.default;
    }

    return Math.min(
      field.max ?? Infinity,
      Math.max(field.min ?? -Infinity, numeric)
    );
  }

  if (field.type === "string") {
    return typeof value === "string" ? value : field.default;
  }

  if (field.type === "color") {
    const candidate = String(value ?? "").trim().toLowerCase();
    return /^#[0-9a-f]{6}$/.test(candidate)
      ? candidate
      : field.default;
  }

  if (field.type === "enum") {
    const options = Array.isArray(field.options)
      ? field.options.map(String)
      : [];
    const candidate = String(value ?? "");
    return options.includes(candidate)
      ? candidate
      : field.default;
  }

  throw new Error(`Unsupported config field type: ${field.type}`);
}

export class ConfigSystem {
  constructor({
    version,
    schema,
    initial = null,
  }) {
    this.version = version;
    this.schema = [];
    this.fields = new Map();
    this.listeners = new Set();
    this.values = {};
    this.sourceDocument =
      initial && typeof initial === "object"
        ? clone(initial)
        : null;

    for (const field of schema) {
      this.define(field, { hydrate: false });
    }

    if (initial) {
      this.restore(initial);
    }
  }

  define(field, { hydrate = true } = {}) {
    if (!field || typeof field.path !== "string" || !field.path) {
      throw new TypeError("Config field requires a path");
    }
    if (this.fields.has(field.path)) {
      throw new Error(`Duplicate config field: ${field.path}`);
    }

    const frozen = Object.freeze({ ...field });
    this.fields.set(frozen.path, frozen);
    this.schema.push(frozen);

    const incoming = hydrate &&
      this.sourceDocument?.version === this.version
        ? readPath(this.sourceDocument.values ?? {}, frozen.path)
        : undefined;

    writePath(
      this.values,
      frozen.path,
      clone(
        incoming === undefined
          ? frozen.default
          : normalizeField(frozen, incoming)
      )
    );

    return frozen;
  }

  hasSourceValue(path) {
    if (this.sourceDocument?.version !== this.version) {
      return false;
    }
    return readPath(this.sourceDocument.values ?? {}, path) !== undefined;
  }

  defaultValues() {
    const values = {};
    for (const field of this.schema) {
      writePath(values, field.path, clone(field.default));
    }
    return values;
  }

  get(path) {
    if (!this.fields.has(path)) {
      throw new Error(`Unknown config field: ${path}`);
    }
    return clone(readPath(this.values, path));
  }

  set(path, value) {
    const field = this.fields.get(path);
    if (!field) {
      throw new Error(`Unknown config field: ${path}`);
    }

    const normalized = normalizeField(field, value);
    const previous = readPath(this.values, path);

    if (Object.is(previous, normalized)) {
      return clone(normalized);
    }

    writePath(this.values, path, clone(normalized));
    const event = Object.freeze({
      path,
      value: clone(normalized),
      previous: clone(previous),
    });

    for (const listener of this.listeners) {
      listener(event);
    }

    return clone(normalized);
  }

  reset() {
    const next = this.defaultValues();
    const previous = this.snapshot().values;
    this.values = next;
    this.sourceDocument = null;

    for (const listener of this.listeners) {
      listener(Object.freeze({
        path: null,
        value: clone(next),
        previous,
        reset: true,
      }));
    }

    return this.snapshot();
  }

  snapshot() {
    return {
      version: this.version,
      values: clone(this.values),
    };
  }

  restore(document) {
    if (!document || typeof document !== "object") {
      throw new TypeError("Configuration document must be an object");
    }

    if (document.version !== this.version) {
      throw new Error(
        `Unsupported configuration version: ${document.version}`
      );
    }

    this.sourceDocument = clone(document);
    const source = document.values ?? {};
    const next = this.defaultValues();

    for (const field of this.schema) {
      const incoming = readPath(source, field.path);
      if (incoming !== undefined) {
        writePath(next, field.path, normalizeField(field, incoming));
      }
    }

    const previous = this.snapshot().values;
    this.values = next;

    for (const listener of this.listeners) {
      listener(Object.freeze({
        path: null,
        value: clone(next),
        previous,
        restore: true,
      }));
    }

    return this.snapshot();
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
