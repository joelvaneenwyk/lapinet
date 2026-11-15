import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

function source(relative) {
  return readFileSync(
    new URL(relative, import.meta.url),
    "utf8"
  );
}

function storageBindings(wgsl) {
  return [...wgsl.matchAll(
    /@group\(0\)\s+@binding\((\d+)\)\s+var<storage/g
  )].map((match) => Number(match[1]));
}

test("R4 neighbor shader stays within Apple eight-storage-buffer limit", () => {
  const wgsl = source("../src/gpu/scs/gpu-r4-neighbors.wgsl");
  const bindings = storageBindings(wgsl);

  assert.equal(new Set(bindings).size, 8);
  assert.deepEqual([...new Set(bindings)].sort((a, b) => a - b), [
    0, 1, 2, 3, 4, 5, 6, 7,
  ]);
  assert.doesNotMatch(wgsl, /\blet\s+target\b|\bvar\s+target\b/);
  assert.match(wgsl, /for\(var d0=[\s\S]*?\{[\s\S]*?for\(var d1=/);
});

test("R4 hierarchy uses entry-point-specific layouts", () => {
  const js = source("../src/gpu/scs/gpu-r4-hierarchy.js");

  assert.match(js, /engine\.markLayout/);
  assert.match(js, /engine\.writeLayout/);
  assert.match(js, /engine\.momentLayout/);
  assert.doesNotMatch(
    js,
    /engine\.layout=device\.createBindGroupLayout/
  );
  assert.match(js, /dispatchWorkgroupsIndirect\(level\.indirect,0\)/);
});

test("prefix scan offset ABI remains bindings 4, 5, 6", () => {
  const wgsl = source("../src/gpu/scs/gpu-prefix-scan.wgsl");
  const js = source("../src/gpu/scs/gpu-prefix-scan.js");

  assert.match(wgsl, /@binding\(4\).*offsetValues/);
  assert.match(wgsl, /@binding\(5\).*scannedBlockOffsets/);
  assert.match(wgsl, /@binding\(6\).*offsetCfg/);
  assert.match(js, /binding:4/);
  assert.match(js, /binding:5/);
  assert.match(js, /binding:6/);
});

test("radix histogram zeroing is synchronized before increments", () => {
  const wgsl = source("../src/gpu/scs/gpu-radix-rank.wgsl");
  const zero = wgsl.indexOf("atomicStore(&localHistogram[lane],0u)");
  const barrier = wgsl.indexOf("workgroupBarrier()", zero);
  const add = wgsl.indexOf("atomicAdd(&localHistogram[sortDigit],1u)", zero);

  assert.ok(zero >= 0);
  assert.ok(barrier > zero);
  assert.ok(add > barrier);
});
