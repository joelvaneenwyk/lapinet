function uniqueStrings(values, label) {
  const result = [];
  const seen = new Set();

  for (const value of values ?? []) {
    if (typeof value !== "string" || !value) {
      throw new TypeError(`${label} entries must be non-empty strings`);
    }
    if (seen.has(value)) {
      throw new Error(`Duplicate ${label} entry: ${value}`);
    }
    seen.add(value);
    result.push(value);
  }

  return Object.freeze(result);
}

export function defineGpuSystem(definition) {
  if (!definition || typeof definition.id !== "string" || !definition.id) {
    throw new TypeError("GPU system requires a stable id");
  }
  if (typeof definition.encode !== "function") {
    throw new TypeError(
      `GPU system ${definition.id} requires encode(context)`
    );
  }

  return Object.freeze({
    id: definition.id,
    inputs: uniqueStrings(definition.inputs, "inputs"),
    outputs: uniqueStrings(definition.outputs, "outputs"),
    after: uniqueStrings(definition.after, "after"),
    enabled: definition.enabled ?? true,
    initialize:
      typeof definition.initialize === "function"
        ? definition.initialize
        : null,
    encode: definition.encode,
    destroy:
      typeof definition.destroy === "function"
        ? definition.destroy
        : null,
  });
}
