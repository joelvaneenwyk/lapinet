import assert from "node:assert/strict";
import test from "node:test";

import {
  LAPINET_CONFIG_SCHEMA,
  LAPINET_CONFIG_VERSION,
} from "../src/config/config-schema.js";
import {
  ConfigSystem,
} from "../src/config/config-system.js";
import {
  DisplaySystem,
  LapinDisplay,
} from "../src/display/display-system.js";

class FakeElement {
  constructor(tagName, ownerDocument) {
    this.tagName = tagName;
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.parentNode = null;
    this.dataset = {};
    this.hidden = false;
    this.className = "";
    this.textContent = "";
    this.attributes = new Map();
    this.style = {
      setProperty(name, value) {
        this[name] = value;
      },
    };
    this.mockHeight = 25;
    this.listeners = new Map();
    this.blurred = false;
  }

  append(...nodes) {
    for (const node of nodes) this.appendChild(node);
  }

  appendChild(node) {
    if (node.parentNode) {
      const index = node.parentNode.children.indexOf(node);
      if (index >= 0) node.parentNode.children.splice(index, 1);
    }
    node.parentNode = this;
    this.children.push(node);
    return node;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, []);
    }
    this.listeners.get(type).push(listener);
  }

  dispatch(type, event = {}) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }

  focus() {
    this.ownerDocument.activeElement = this;
  }

  blur() {
    this.blurred = true;
    if (this.ownerDocument.activeElement === this) {
      this.ownerDocument.activeElement = null;
    }
  }

  getBoundingClientRect() {
    return { height: this.mockHeight };
  }

  querySelectorAll(selector) {
    if (selector !== "[data-display-id]") return [];

    const result = [];
    const visit = (node) => {
      if (node.dataset?.displayId) result.push(node);
      for (const child of node.children ?? []) visit(child);
    };
    for (const child of this.children) visit(child);
    return result;
  }
}

class FakeDocument {
  constructor() {
    this.activeElement = null;
  }

  createElement(tagName) {
    return new FakeElement(tagName, this);
  }
}

class FakeLayoutManager {
  constructor(extras = null) {
    this.records = new Map();
    this.visibility = new Map();
    this.extras = extras;
    this.enabled = false;
    this.saves = 0;
    this.centers = [];
  }

  bindPanel(element, key, position) {
    if (this.records.has(key)) return this.records.get(key);
    const record = { element, key, position };
    this.records.set(key, record);
    element.dataset.displayPanel = key;
    return record;
  }

  setPanelVisibility(key, visible) {
    this.visibility.set(key, !!visible);
    return true;
  }

  applyPanel() {}
  apply() {}

  centerPanel(key) {
    this.centers.push(key);
    return true;
  }

  getExtras() {
    return this.extras == null
      ? null
      : structuredClone(this.extras);
  }

  setExtras(extras) {
    this.extras = structuredClone(extras);
  }

  enablePersistence() {
    this.enabled = true;
  }

  save() {
    this.saves += 1;
    return true;
  }
}

function makeConfig(initial = null) {
  return new ConfigSystem({
    version: LAPINET_CONFIG_VERSION,
    schema: LAPINET_CONFIG_SCHEMA,
    initial,
  });
}

function makeWorkspace() {
  const document = new FakeDocument();
  return new FakeElement("main", document);
}

test("Config and Displays use the original Lapin display DOM contract", () => {
  const workspace = makeWorkspace();
  const layout = new FakeLayoutManager();
  const config = makeConfig();
  const displays = new DisplaySystem({
    workspace,
    config,
    layoutManager: layout,
  });

  let configMounts = 0;
  let displaysMounts = 0;

  displays.register({
    id: "config",
    title: "Config",
    position: [0.012, 0.01],
    defaultVisible: true,
    mount() {
      configMounts += 1;
    },
  });

  displays.register({
    id: "displays",
    title: "Displays",
    position: [0.72, 0.02],
    defaultVisible: true,
    mount() {
      displaysMounts += 1;
    },
  });

  displays.start();

  const configPanel = displays.get("config");
  const displaysPanel = displays.get("displays");

  assert.ok(configPanel instanceof LapinDisplay);
  assert.ok(displaysPanel instanceof LapinDisplay);
  assert.match(configPanel.element.className, /lapin-match-hud/);
  assert.equal(configPanel.title.className, "lapin-match-hud-title");
  assert.equal(configPanel.title.getAttribute("aria-label"), "Config");
  assert.equal(configPanel.title.textContent, "\u25bc Config");
  assert.equal(configMounts, 1);
  assert.equal(displaysMounts, 1);
  assert.equal(layout.records.size, 2);
  assert.equal(config.get("display.visibility.config"), true);
  assert.equal(config.get("display.visibility.displays"), true);
});

test("all registered displays are created once and visibility writes through config", () => {
  const workspace = makeWorkspace();
  const layout = new FakeLayoutManager();
  const config = makeConfig();
  const displays = new DisplaySystem({
    workspace,
    config,
    layoutManager: layout,
  });

  let mounts = 0;
  displays.register({
    id: "config",
    title: "Config",
    defaultVisible: true,
    mount() {
      mounts += 1;
    },
  });

  displays.start();

  const first = displays.get("config");
  const element = first.element;

  displays.hide("config");
  assert.equal(config.get("display.visibility.config"), false);

  const reopened = displays.open("config");
  assert.equal(config.get("display.visibility.config"), true);

  assert.strictEqual(reopened, first);
  assert.strictEqual(reopened.element, element);
  assert.equal(mounts, 1);
  assert.equal(workspace.querySelectorAll("[data-display-id]").length, 1);
  assert.equal(displays.assertUniqueDom(), true);
  assert.equal(typeof displays.registry.destroy, "undefined");
});

test("legacy layout visibility migrates once into canonical config", () => {
  const workspace = makeWorkspace();
  const layout = new FakeLayoutManager({
    visibility: {
      config: true,
      displays: false,
    },
  });
  const config = makeConfig();

  const displays = new DisplaySystem({
    workspace,
    config,
    layoutManager: layout,
  });

  let mounts = 0;
  for (const id of ["config", "displays"]) {
    displays.register({
      id,
      title: id,
      defaultVisible: true,
      mount() {
        mounts += 1;
      },
    });
  }

  displays.start();

  assert.equal(config.get("display.visibility.config"), true);
  assert.equal(config.get("display.visibility.displays"), false);
  assert.equal(displays.get("config").visible, true);
  assert.equal(displays.get("displays").visible, false);
  assert.equal(mounts, 2);
  assert.equal(layout.enabled, true);
  assert.equal(layout.extras, null);

  displays.open("displays");
  assert.equal(config.get("display.visibility.displays"), true);
  assert.equal(displays.get("displays").visible, true);
  assert.equal(mounts, 2);
  assert.equal(layout.extras, null);
});

test("Config can reopen Displays after Displays hides itself", () => {
  const workspace = makeWorkspace();
  const config = makeConfig();
  const displays = new DisplaySystem({
    workspace,
    config,
    layoutManager: new FakeLayoutManager(),
  });

  for (const id of ["config", "displays"]) {
    displays.register({
      id,
      title: id,
      defaultVisible: true,
      mount() {},
    });
  }

  displays.start();
  const original = displays.get("displays");

  displays.hide("displays");
  assert.equal(original.visible, false);
  assert.equal(config.get("display.visibility.displays"), false);

  config.set("display.visibility.displays", true);

  assert.strictEqual(displays.get("displays"), original);
  assert.equal(original.visible, true);
  assert.equal(original.element.hidden, false);
});

test("dock rails track the rendered Lapin title-tab height", () => {
  const workspace = makeWorkspace();
  const topRail = new FakeElement("div", workspace.ownerDocument);
  const bottomRail = new FakeElement("div", workspace.ownerDocument);
  const displays = new DisplaySystem({
    workspace,
    config: makeConfig(),
    topRail,
    bottomRail,
    layoutManager: new FakeLayoutManager(),
  });

  displays.register({
    id: "config",
    title: "Config",
    defaultVisible: true,
    mount() {},
  });
  displays.start();

  const title = displays.get("config").title;
  title.mockHeight = 31;
  assert.equal(displays.syncRailHeight(), true);
  assert.equal(topRail.style.height, "31px");
  assert.equal(bottomRail.style.height, "31px");
  assert.equal(workspace.style["--lapin-hud-title-height"], "31px");
});

test("registration closes before start so display identity cannot mutate later", () => {
  const displays = new DisplaySystem({
    workspace: makeWorkspace(),
    config: makeConfig(),
    layoutManager: new FakeLayoutManager(),
  });

  displays.register({
    id: "config",
    mount() {},
  });
  displays.start();

  assert.throws(
    () => displays.register({
      id: "late",
      mount() {},
    }),
    /registered before DisplaySystem.start/
  );
});


test("leaving a display releases keyboard focus from controls inside it", () => {
  const workspace = makeWorkspace();
  const config = makeConfig();
  const displays = new DisplaySystem({
    workspace,
    config,
    layoutManager: new FakeLayoutManager(),
  });

  let input = null;
  displays.register({
    id: "config",
    title: "Config",
    defaultVisible: true,
    mount(container) {
      input = container.ownerDocument.createElement("input");
      container.append(input);
    },
  });

  displays.start();
  const panel = displays.get("config");

  input.focus();
  assert.strictEqual(workspace.ownerDocument.activeElement, input);

  panel.element.dispatch("pointerleave");

  assert.equal(input.blurred, true);
  assert.equal(workspace.ownerDocument.activeElement, null);
});

test("leaving a display does not blur focus owned outside that display", () => {
  const workspace = makeWorkspace();
  const config = makeConfig();
  const displays = new DisplaySystem({
    workspace,
    config,
    layoutManager: new FakeLayoutManager(),
  });

  displays.register({
    id: "config",
    title: "Config",
    defaultVisible: true,
    mount() {},
  });

  displays.start();
  const outside = workspace.ownerDocument.createElement("input");
  workspace.append(outside);
  outside.focus();

  displays.get("config").element.dispatch("pointerleave");

  assert.strictEqual(workspace.ownerDocument.activeElement, outside);
  assert.equal(outside.blurred, false);
});
