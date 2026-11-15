function clone(value) {
  if (globalThis.structuredClone) {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

function normalizeName(name) {
  const value = String(name ?? "").trim();
  if (!value) {
    throw new TypeError("Configuration state name must not be empty");
  }
  return value;
}

export class ConfigStateStore {
  constructor({
    storage,
    storageKey = "lapinet.config.v1.states",
  } = {}) {
    this.storage = storage ?? null;
    this.storageKey = storageKey;
  }

  readDocument() {
    if (!this.storage) {
      return { version: 1, states: {} };
    }

    const raw = this.storage.getItem(this.storageKey);
    if (!raw) {
      return { version: 1, states: {} };
    }

    const parsed = JSON.parse(raw);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      parsed.version !== 1 ||
      !parsed.states ||
      typeof parsed.states !== "object" ||
      Array.isArray(parsed.states)
    ) {
      throw new Error("Unsupported configuration state document");
    }

    return {
      version: 1,
      states: clone(parsed.states),
    };
  }

  writeDocument(document) {
    if (!this.storage) return false;
    this.storage.setItem(
      this.storageKey,
      JSON.stringify(document)
    );
    return true;
  }

  list() {
    return Object.keys(this.readDocument().states)
      .sort((a, b) => a.localeCompare(b));
  }

  save(name, snapshot) {
    const key = normalizeName(name);
    if (!snapshot || typeof snapshot !== "object") {
      throw new TypeError("Configuration snapshot must be an object");
    }

    const document = this.readDocument();
    document.states[key] = clone(snapshot);
    this.writeDocument(document);
    return key;
  }

  load(name) {
    const key = normalizeName(name);
    const snapshot = this.readDocument().states[key];
    return snapshot == null ? null : clone(snapshot);
  }

  remove(name) {
    const key = normalizeName(name);
    const document = this.readDocument();
    if (!(key in document.states)) return false;
    delete document.states[key];
    this.writeDocument(document);
    return true;
  }
}
