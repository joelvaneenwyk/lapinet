import assert from "node:assert/strict";
import test from "node:test";

import {
  DisplayRegistry,
} from "../src/display/display-system.js";

class FakeDisplay {
  constructor(id) {
    this.id = id;
    this.visible = false;
  }

  show() {
    this.visible = true;
  }

  hide() {
    this.visible = false;
  }
}

test("open always reuses the same display instance", () => {
  let builds = 0;
  const registry = new DisplayRegistry((definition) => {
    builds += 1;
    return new FakeDisplay(definition.id);
  });

  registry.define({
    id: "config",
    title: "Config",
    mount() {},
  });

  const first = registry.open("config");
  registry.hide("config");
  const second = registry.open("config");
  const third = registry.get("config");

  assert.strictEqual(first, second);
  assert.strictEqual(second, third);
  assert.equal(builds, 1);
  assert.equal(first.visible, true);
});

test("a display id can only be defined once", () => {
  const registry = new DisplayRegistry(
    (definition) => new FakeDisplay(definition.id)
  );

  registry.define({
    id: "config",
    mount() {},
  });

  assert.throws(
    () => registry.define({
      id: "config",
      mount() {},
    }),
    /Display already defined/
  );
});

test("v0 has no display destruction path", () => {
  const registry = new DisplayRegistry(
    (definition) => new FakeDisplay(definition.id)
  );

  registry.define({
    id: "config",
    mount() {},
  });

  const first = registry.get("config");

  assert.equal(typeof registry.destroy, "undefined");
  assert.strictEqual(registry.get("config"), first);
});
