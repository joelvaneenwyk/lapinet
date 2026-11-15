import assert from "node:assert/strict";
import test from "node:test";

import {
  bindControlHotkeys,
} from "../src/input/control-hotkeys.js";

class FakeDocument {
  constructor() {
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type, event) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }
}

test("P/T pause and R restarts simulation", () => {
  const document = new FakeDocument();
  let renderToggles = 0;
  let simulationToggles = 0;
  let simulationRestarts = 0;
  const binding = bindControlHotkeys({
    document,
    onRenderPauseToggle() {
      renderToggles += 1;
    },
    onSimulationPauseToggle() {
      simulationToggles += 1;
    },
    onSimulationRestart() {
      simulationRestarts += 1;
    },
  });

  document.dispatch("keydown", {
    code: "KeyP",
    repeat: false,
    target: null,
    preventDefault() {},
  });
  document.dispatch("keydown", {
    code: "KeyT",
    repeat: false,
    target: null,
    preventDefault() {},
  });
  document.dispatch("keydown", {
    code: "KeyR",
    repeat: false,
    target: null,
    preventDefault() {},
  });

  assert.equal(renderToggles, 1);
  assert.equal(simulationToggles, 1);
  assert.equal(simulationRestarts, 1);

  binding.destroy();
});

test("pause hotkeys ignore repeats and editing controls", () => {
  const document = new FakeDocument();
  let renderToggles = 0;
  let simulationToggles = 0;
  let simulationRestarts = 0;

  bindControlHotkeys({
    document,
    onRenderPauseToggle() {
      renderToggles += 1;
    },
    onSimulationPauseToggle() {
      simulationToggles += 1;
    },
    onSimulationRestart() {
      simulationRestarts += 1;
    },
  });

  document.dispatch("keydown", {
    code: "KeyP",
    repeat: true,
    target: null,
  });
  document.dispatch("keydown", {
    code: "KeyT",
    repeat: false,
    target: {
      tagName: "INPUT",
      type: "text",
      isContentEditable: false,
    },
  });

  document.dispatch("keydown", {
    code: "KeyR",
    repeat: true,
    target: null,
  });

  assert.equal(renderToggles, 0);
  assert.equal(simulationToggles, 0);
  assert.equal(simulationRestarts, 0);
});
