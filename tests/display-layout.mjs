import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  createDisplayLayoutManager,
} from "../src/display/display-layout.js";

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
    if (force === undefined) {
      if (this.values.has(name)) {
        this.values.delete(name);
        return false;
      }
      this.values.add(name);
      return true;
    }

    if (force) this.values.add(name);
    else this.values.delete(name);
    return force;
  }

  contains(name) {
    return this.values.has(name);
  }
}

class FakeNode {
  constructor(rect = {}) {
    this.rect = {
      left: rect.left ?? 0,
      top: rect.top ?? 0,
      width: rect.width ?? 100,
      height: rect.height ?? 25,
    };
    this.hidden = false;
    this.dataset = {};
    this.classList = new FakeClassList();
    this.style = {
      setProperty(name, value) {
        this[name] = value;
      },
    };
    this.listeners = new Map();
    this.attributes = new Map();
    this.textContent = "";
  }

  getBoundingClientRect() {
    return {
      ...this.rect,
      right: this.rect.left + this.rect.width,
      bottom: this.rect.top + this.rect.height,
    };
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  dispatch(type, event) {
    this.listeners.get(type)?.(event);
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  setPointerCapture() {}
  releasePointerCapture() {}
}

function makePanel({
  left,
  width = 120,
  height = 100,
  titleLeft = left,
  titleWidth = 50,
}) {
  const element = new FakeNode({ left, top: 100, width, height });
  const handle = new FakeNode({
    left: titleLeft,
    top: 100,
    width: titleWidth,
    height: 25,
  });
  handle.setAttribute("aria-label", "Panel");
  handle.textContent = "v Panel";
  element.querySelector = (selector) =>
    selector === ".lapin-match-hud-title" ? handle : null;
  return { element, handle };
}

class MemoryStorage {
  constructor(profile) {
    this.profile = profile;
  }

  getItem() {
    return JSON.stringify(this.profile);
  }

  setItem() {}
}

test("docking divider ignores collapsed tabs and highlight uses the same divider", () => {
  const previousWindow = globalThis.window;
  globalThis.window = {
    innerWidth: 1000,
    innerHeight: 800,
  };

  try {
    const storage = new MemoryStorage({
      version: 1,
      panels: {
        left: {
          mode: "docked",
          edge: "top",
          side: "left",
          order: 0,
          collapsed: false,
          floatPosition: [0.1, 0.1],
        },
        right: {
          mode: "docked",
          edge: "top",
          side: "right",
          order: 0,
          collapsed: false,
          floatPosition: [0.7, 0.1],
        },
        collapsed: {
          mode: "docked",
          edge: "top",
          side: "right",
          order: 1,
          collapsed: true,
          floatPosition: [0.95, 0.1],
        },
        drag: {
          mode: "floating",
          edge: "top",
          side: "left",
          order: 0,
          collapsed: false,
          floatPosition: [0.4, 0.4],
        },
      },
    });

    const topRail = new FakeNode();
    const bottomRail = new FakeNode();
    const layout = createDisplayLayoutManager({
      storage,
      topRail,
      bottomRail,
    });

    const left = makePanel({
      left: 75,
      titleLeft: 100,
      titleWidth: 50,
    });
    const right = makePanel({
      left: 675,
      titleLeft: 700,
      titleWidth: 50,
    });
    const collapsed = makePanel({
      left: 925,
      titleLeft: 950,
      titleWidth: 50,
    });
    const drag = makePanel({
      left: 400,
      titleLeft: 400,
      titleWidth: 60,
    });

    layout.bindPanel(left.element, "left");
    layout.bindPanel(right.element, "right");
    layout.bindPanel(collapsed.element, "collapsed");
    layout.bindPanel(drag.element, "drag");

    drag.handle.dispatch("pointerdown", {
      button: 0,
      pointerId: 1,
      clientX: 430,
      clientY: 110,
      preventDefault() {},
    });

    drag.handle.dispatch("pointermove", {
      pointerId: 1,
      clientX: 500,
      clientY: 5,
    });

    // Expanded centers are 125 and 725, so divider = 425.
    // The collapsed center at 975 must not move that boundary.
    assert.equal(topRail.dataset.dockSide, "right");
    assert.equal(topRail.style["--lapin-dock-divider"], "425px");
    assert.equal(topRail.classList.contains("active"), true);
    assert.equal(bottomRail.classList.contains("active"), false);
  } finally {
    globalThis.window = previousWindow;
  }
});

test("right-docked expanded title tabs are visually right-justified", () => {
  const css = readFileSync(
    new URL("../src/styles.css", import.meta.url),
    "utf8"
  );

  assert.match(
    css,
    /\.lapin-match-hud\.docked\.dock-right:not\(\.collapsed\) > \.lapin-match-hud-title\s*\{[^}]*align-self:\s*flex-end;/s
  );
  assert.match(
    css,
    /var\(--lapin-dock-divider, 50%\)/
  );
});
