import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

test("main startup only registers actual kernel providers", () => {
  const source = readFileSync(
    new URL("../src/main.js", import.meta.url),
    "utf8"
  );

  const match = source.match(
    /for \(const pass of \[([\s\S]*?)\]\) \{([\s\S]*?)diagnostics\.registerKernelProvider\(pass\);/
  );
  assert.ok(match, "kernel provider registration loop must exist");

  const body = match[1];
  assert.match(body, /implicit/);
  assert.match(body, /deferred/);
  assert.match(body, /simulationParticles/);
  assert.match(body, /renderTargetDebug/);
  assert.match(body, /cursor/);

  assert.doesNotMatch(body, /primitiveSource/);
  assert.doesNotMatch(body, /primitiveLayer/);
  assert.doesNotMatch(body, /primitiveLayerError/);
});

test("simulation and renderer share GPU context and particle resources", () => {
  const source = readFileSync(
    new URL("../src/main.js", import.meta.url),
    "utf8"
  );

  assert.match(source, /const gpuReady = GpuContext\.create\(\)/);
  assert.match(source, /createScsSimulationRuntime/);
  assert.match(source, /const simulationReady = startSimulation\(\)/);
  assert.match(source, /const rendererReady = startRenderer\(\)/);
  assert.match(
    source,
    /async function startRenderer\(\) \{\s*const gpu = await gpuReady/
  );
  assert.match(source, /const simulation = await simulationReady/);
  assert.match(source, /SCS_PARTICLE_RECORDS/);
  assert.match(source, /SimulationParticlePass\.create/);
  assert.doesNotMatch(
    source.match(
      /async function startRenderer\(\)[\s\S]*?return rendererRuntime;/
    )?.[0] ?? "",
    /gpu\.destroy\(\)/
  );
});

test("render capture is session-opt-in on cold startup", () => {
  const source = readFileSync(
    new URL("../src/main.js", import.meta.url),
    "utf8"
  );
  assert.match(
    source,
    /document\.values\.diagnostics\.capture\.enabled = false/
  );
});


test("startup migrates the old 32-iteration fractal default to 40", () => {
  const source = readFileSync(
    new URL("../src/main.js", import.meta.url),
    "utf8"
  );
  assert.match(source, /revision < 3/);
  assert.match(source, /fractal\?\.iterations === 32/);
  assert.match(source, /fractal\.iterations = 40/);
  assert.match(source, /implicit\.performanceRevision = 3/);
});
