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
  ConfigStateStore,
} from "../src/config/config-state-store.js";
import {
  configSectionForPath,
  mountConfigUI,
} from "../src/config/config-ui.js";
import {
  createDisplayLayoutManager,
} from "../src/display/display-layout.js";
import {
  DisplaySystem,
} from "../src/display/display-system.js";
import {
  LAPINET_BUILD_VERSION,
} from "../src/version.js";

class MemoryStorage {
  constructor(initial = {}) {
    this.values = new Map(Object.entries(initial));
  }

  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }

  setItem(key, value) {
    this.values.set(key, String(value));
  }
}

class FakeClassList {
  constructor() {
    this.values = new Set();
  }

  add(...names) {
    for (const name of names) this.values.add(name);
  }

  remove(...names) {
    for (const name of names) this.values.delete(name);
  }

  toggle(name, force) {
    const next = force === undefined ? !this.values.has(name) : !!force;
    if (next) this.values.add(name);
    else this.values.delete(name);
    return next;
  }
}

class FakeElement {
  constructor(tagName, ownerDocument, rect = {}) {
    this.tagName = tagName;
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.parentNode = null;
    this.dataset = {};
    this.hidden = false;
    this.className = "";
    this.textContent = "";
    this.attributes = new Map();
    this.listeners = new Map();
    this.classList = new FakeClassList();
    this.style = {
      setProperty(name, value) {
        this[name] = value;
      },
    };
    this.rect = {
      left: rect.left ?? 0,
      top: rect.top ?? 0,
      width: rect.width ?? 220,
      height: rect.height ?? 120,
    };
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

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  dispatch(type, event = {}) {
    this.listeners.get(type)?.(event);
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  getBoundingClientRect() {
    return {
      ...this.rect,
      right: this.rect.left + this.rect.width,
      bottom: this.rect.top + this.rect.height,
    };
  }

  setPointerCapture() {}
  releasePointerCapture() {}

  querySelector(selector) {
    if (selector === ".lapin-match-hud-title") {
      return this.children.find(
        (child) => child.className === "lapin-match-hud-title"
      ) ?? null;
    }
    return null;
  }

  querySelectorAll(selector) {
    const result = [];
    const visit = (node) => {
      if (
        selector === "[data-display-id]" &&
        node.dataset?.displayId
      ) {
        result.push(node);
      }
      for (const child of node.children ?? []) visit(child);
    };
    for (const child of this.children) visit(child);
    return result;
  }
}

class FakeDocument {
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
  }

  bindPanel(element, key, position) {
    const record = { element, key, position };
    this.records.set(key, record);
    return record;
  }

  setPanelVisibility(key, visible) {
    this.visibility.set(key, !!visible);
    return false;
  }

  applyPanel() {}
  apply() {}
  centerPanel() {}

  getExtras() {
    return this.extras == null ? null : structuredClone(this.extras);
  }

  setExtras(extras) {
    this.extras = extras == null ? null : structuredClone(extras);
  }

  enablePersistence() {
    this.enabled = true;
  }

  save() {
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

function registerCoreDisplays(displays) {
  for (const [id, title] of [
    ["config", "Config"],
    ["displays", "Displays"],
  ]) {
    displays.register({
      id,
      title,
      defaultVisible: true,
      mount() {},
    });
  }
}

function findByClass(root, className) {
  let found = null;
  const visit = (node) => {
    if (found) return;
    if (node.className === className) {
      found = node;
      return;
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(root);
  return found;
}

function findByText(root, text) {
  let found = null;
  const visit = (node) => {
    if (found) return;
    if (node.textContent === text) {
      found = node;
      return;
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(root);
  return found;
}

test("Config UI Save/Load round-trips UI and display visibility", () => {
  const storage = new MemoryStorage();
  const config = makeConfig();
  config.define({
    path: "display.visibility.config",
    label: "Display: Config",
    type: "boolean",
    default: true,
  });
  config.define({
    path: "display.visibility.displays",
    label: "Display: Displays",
    type: "boolean",
    default: true,
  });

  const document = new FakeDocument();
  const container = new FakeElement("section", document);

  mountConfigUI(container, {
    config,
    schema: config.schema,
    storage,
    storageKey: "config",
  });

  config.set("ui.fontSize", 17);
  config.set("ui.sliderWidth", 111);
  config.set("display.visibility.config", true);
  config.set("display.visibility.displays", false);

  findByText(container, "Save").dispatch("click");

  config.set("ui.fontSize", 9);
  config.set("ui.sliderWidth", 48);
  config.set("display.visibility.displays", true);

  findByText(container, "Load").dispatch("click");

  assert.equal(config.get("ui.fontSize"), 17);
  assert.equal(config.get("ui.sliderWidth"), 111);
  assert.equal(config.get("display.visibility.config"), true);
  assert.equal(config.get("display.visibility.displays"), false);
  const version = findByText(container, `Lapinet v${LAPINET_BUILD_VERSION}`);
  assert.ok(version);
  assert.equal(version.dataset.buildVersion, LAPINET_BUILD_VERSION);
});

test("malformed manual load leaves canonical config unchanged", () => {
  const storage = new MemoryStorage({ config: "{ definitely not json" });
  const config = makeConfig();
  const document = new FakeDocument();
  const container = new FakeElement("section", document);

  mountConfigUI(container, {
    config,
    schema: config.schema,
    storage,
    storageKey: "config",
  });

  config.set("ui.fontSize", 14);
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    assert.doesNotThrow(() => {
      findByText(container, "Load").dispatch("click");
    });
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(config.get("ui.fontSize"), 14);
});

test("cold reload hydrates late display fields from saved config", () => {
  const firstConfig = makeConfig();
  const firstDisplays = new DisplaySystem({
    workspace: new FakeElement("main", new FakeDocument()),
    config: firstConfig,
    layoutManager: new FakeLayoutManager(),
  });
  registerCoreDisplays(firstDisplays);
  firstDisplays.start();

  firstConfig.set("ui.fontSize", 16);
  firstConfig.set("ui.sliderWidth", 104);
  firstDisplays.hide("displays");

  const saved = JSON.stringify(firstConfig.snapshot());

  const secondConfig = makeConfig(JSON.parse(saved));
  const secondDisplays = new DisplaySystem({
    workspace: new FakeElement("main", new FakeDocument()),
    config: secondConfig,
    layoutManager: new FakeLayoutManager(),
  });
  registerCoreDisplays(secondDisplays);
  secondDisplays.start();

  assert.equal(secondConfig.get("ui.fontSize"), 16);
  assert.equal(secondConfig.get("ui.sliderWidth"), 104);
  assert.equal(secondConfig.get("display.visibility.config"), true);
  assert.equal(secondConfig.get("display.visibility.displays"), false);
  assert.equal(secondDisplays.get("config").visible, true);
  assert.equal(secondDisplays.get("displays").visible, false);
});

test("layout save/load preserves docking and hide/show does not rewrite it", () => {
  const previousWindow = globalThis.window;
  globalThis.window = {
    innerWidth: 1200,
    innerHeight: 800,
  };

  try {
    const key = "layout";
    const initialProfile = {
      version: 1,
      panels: {
        config: {
          mode: "docked",
          edge: "bottom",
          side: "right",
          order: 37,
          floatPosition: [0.2, 0.3],
          collapsed: true,
        },
      },
      extras: null,
    };
    const storage = new MemoryStorage({
      [key]: JSON.stringify(initialProfile),
    });

    const document = new FakeDocument();
    const panel = new FakeElement("section", document);
    const title = new FakeElement("div", document, {
      left: 900,
      top: 775,
      width: 90,
      height: 25,
    });
    title.className = "lapin-match-hud-title";
    title.setAttribute("aria-label", "Config");
    title.textContent = "v Config";
    panel.append(title);

    const first = createDisplayLayoutManager({
      storage,
      storageKey: key,
    });
    first.bindPanel(panel, "config");
    first.enablePersistence();

    const before = first.snapshot().panels.config;
    first.setPanelVisibility("config", false);
    first.setPanelVisibility("config", true);
    first.save();

    const after = first.snapshot().panels.config;
    assert.deepEqual(after, before);

    const stored = JSON.parse(storage.getItem(key));
    assert.deepEqual(stored.panels.config, initialProfile.panels.config);
    assert.equal(stored.extras, null);

    const secondPanel = new FakeElement("section", document);
    const secondTitle = new FakeElement("div", document);
    secondTitle.className = "lapin-match-hud-title";
    secondTitle.setAttribute("aria-label", "Config");
    secondTitle.textContent = "v Config";
    secondPanel.append(secondTitle);

    const second = createDisplayLayoutManager({
      storage,
      storageKey: key,
    });
    second.bindPanel(secondPanel, "config");

    assert.deepEqual(
      second.snapshot().panels.config,
      initialProfile.panels.config
    );
  } finally {
    globalThis.window = previousWindow;
  }
});


test("manual save storage failure does not mutate or crash config", () => {
  const config = makeConfig();
  config.set("ui.fontSize", 15);

  const storage = {
    getItem() {
      return null;
    },
    setItem() {
      throw new Error("quota");
    },
  };

  const document = new FakeDocument();
  const container = new FakeElement("section", document);
  mountConfigUI(container, {
    config,
    schema: config.schema,
    storage,
    storageKey: "config",
  });

  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    assert.doesNotThrow(() => {
      findByText(container, "Save").dispatch("click");
    });
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(config.get("ui.fontSize"), 15);
});


test("manual Load applies restored visibility to the live DisplaySystem", () => {
  const storage = new MemoryStorage();
  const config = makeConfig();
  const displays = new DisplaySystem({
    workspace: new FakeElement("main", new FakeDocument()),
    config,
    layoutManager: new FakeLayoutManager(),
  });
  registerCoreDisplays(displays);
  displays.start();

  const original = displays.get("displays");
  const document = new FakeDocument();
  const container = new FakeElement("section", document);
  mountConfigUI(container, {
    config,
    schema: config.schema,
    storage,
    storageKey: "config",
  });

  displays.hide("displays");
  assert.equal(original.visible, false);
  findByText(container, "Save").dispatch("click");

  displays.open("displays");
  assert.equal(original.visible, true);

  findByText(container, "Load").dispatch("click");

  assert.strictEqual(displays.get("displays"), original);
  assert.equal(config.get("display.visibility.displays"), false);
  assert.equal(original.visible, false);
  assert.equal(original.element.hidden, true);
});


test("numeric config fields expose live range sliders plus exact number inputs", () => {
  const config = makeConfig();
  const document = new FakeDocument();
  const container = new FakeElement("section", document);

  mountConfigUI(container, {
    config,
    schema: config.schema,
  });

  const sectionsRoot = container.children[0];
  const firstSection = sectionsRoot.children[0];
  const grid = firstSection.children[1];
  const firstRow = grid.children[0];
  const numberControl = firstRow.children[1];
  const slider = numberControl.children[0];
  const number = numberControl.children[1];

  assert.equal(slider.type, "range");
  assert.equal(number.type, "number");
  assert.equal(slider.value, "12");
  assert.equal(number.value, "12");

  slider.value = "17";
  slider.dispatch("input");

  assert.equal(config.get("ui.fontSize"), 17);
  assert.equal(number.value, "17");

  config.set("ui.fontSize", 14);
  assert.equal(slider.value, "14");
  assert.equal(number.value, "14");
});


test("config fields organize into semantic collapsible sections", () => {
  assert.deepEqual(
    configSectionForPath("render.implicit.maxSteps"),
    { id: "render.implicit", label: "Render / Implicit" }
  );
  assert.deepEqual(
    configSectionForPath("field.fractal.scale"),
    { id: "field.fractal", label: "Field / Fractal" }
  );
  assert.deepEqual(
    configSectionForPath("display.visibility.kernels"),
    { id: "display.visibility", label: "Display / Visibility" }
  );

  const config = makeConfig();
  const document = new FakeDocument();
  const container = new FakeElement("section", document);
  mountConfigUI(container, {
    config,
    schema: config.schema,
  });

  const labels = container.children[0].children.map(
    (section) => section.children[0].textContent
  );

  assert.ok(labels.includes("UI"));
  assert.ok(labels.includes("Render / Implicit"));
  assert.ok(labels.includes("Render / Material"));
  assert.ok(labels.includes("Render / Primitives"));
  assert.ok(labels.includes("Render / Cursor"));
  assert.ok(labels.includes("Field / Fractal"));
  assert.ok(labels.includes("Field / Comet"));
  assert.ok(labels.includes("Diagnostics"));
  assert.equal(
    container.children[0].children.every((section) => section.open),
    true
  );
});


test("named configuration states preserve full canonical snapshots", () => {
  const storage = new MemoryStorage();
  const store = new ConfigStateStore({
    storage,
    storageKey: "states",
  });
  const config = makeConfig();
  config.define({
    path: "display.visibility.config",
    label: "Display: Config",
    type: "boolean",
    default: true,
  });

  config.set("render.implicit.normalEpsilon", 0.0042);
  config.set("render.implicit.normalDistanceScale", 1.75);
  config.set("display.visibility.config", false);
  store.save("close fractal", config.snapshot());

  config.set("render.implicit.normalEpsilon", 0.02);
  config.set("render.implicit.normalDistanceScale", 0.1);
  config.set("display.visibility.config", true);

  config.restore(store.load("close fractal"));

  assert.equal(config.get("render.implicit.normalEpsilon"), 0.0042);
  assert.equal(config.get("render.implicit.normalDistanceScale"), 1.75);
  assert.equal(config.get("display.visibility.config"), false);
  assert.deepEqual(store.list(), ["close fractal"]);

  assert.equal(store.remove("close fractal"), true);
  assert.deepEqual(store.list(), []);
});

test("Config UI saves and reloads named tuning states", () => {
  const storage = new MemoryStorage();
  const config = makeConfig();
  const document = new FakeDocument();
  const container = new FakeElement("section", document);

  mountConfigUI(container, {
    config,
    schema: config.schema,
    storage,
    storageKey: "config",
  });

  const name = findByClass(container, "config-state-name");
  assert.ok(name);
  name.value = "high detail";

  config.set("render.implicit.normalEpsilon", 0.0023);
  config.set("render.implicit.normalDistanceScale", 2.5);
  findByText(container, "Save state").dispatch("click");

  config.set("render.implicit.normalEpsilon", 0.017);
  config.set("render.implicit.normalDistanceScale", 0.2);
  findByText(container, "Load state").dispatch("click");

  assert.equal(config.get("render.implicit.normalEpsilon"), 0.0023);
  assert.equal(config.get("render.implicit.normalDistanceScale"), 2.5);

  findByText(container, "Delete").dispatch("click");
  const store = new ConfigStateStore({
    storage,
    storageKey: "config.states",
  });
  assert.deepEqual(store.list(), []);
});
