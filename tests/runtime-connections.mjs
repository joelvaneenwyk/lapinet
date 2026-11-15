import assert from "node:assert/strict";
import test from "node:test";

import {
  runtimeConnectionSnapshot,
} from "../src/diagnostics/runtime-connections-ui.js";

test("runtime connections exposes simulation and renderer errors", () => {
  const snapshot = runtimeConnectionSnapshot({
    simulationError: new Error("simulation failed"),
    rendererError: new Error("renderer failed"),
  });

  assert.equal(snapshot.simulation.state, "error");
  assert.match(snapshot.simulation.detail, /simulation failed/);
  assert.equal(snapshot.renderer.state, "error");
  assert.match(snapshot.renderer.detail, /renderer failed/);
});

test("runtime connections reports browser target and authenticated clients", () => {
  const clients = [{
    id: "Helios",
    lastActivity: "2026-11-14T22:51:02.572Z",
  }];
  const snapshot = runtimeConnectionSnapshot({
    simulation: {
      running: true,
      paused: false,
      positionVersion: 4,
    },
    renderer: {
      surface: {
        passes: new Array(6),
        isPaused() {
          return false;
        },
      },
    },
    presence: {
      cdp: "online",
      target: {
        url: "http://127.0.0.1:1351/",
      },
      clients,
    },
  });

  assert.equal(snapshot.simulation.state, "running");
  assert.equal(snapshot.simulation.detail, "position v4");
  assert.equal(snapshot.renderer.state, "running");
  assert.equal(snapshot.renderer.detail, "6 render passes");
  assert.equal(snapshot.bridge.state, "connected");
  assert.equal(snapshot.bridge.detail, "http://127.0.0.1:1351/");
  assert.deepEqual(snapshot.clients, clients);
});
