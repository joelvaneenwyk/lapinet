import {
  createDisplayLayoutManager,
} from "./display-layout.js";

export class DisplayRegistry {
  constructor(factory, onChange = () => {}) {
    this.factory = factory;
    this.onChange = onChange;
    this.definitions = new Map();
    this.instances = new Map();
  }

  define(definition) {
    if (!definition || typeof definition.id !== "string" || !definition.id) {
      throw new TypeError("Display definition requires a stable id");
    }
    if (typeof definition.mount !== "function") {
      throw new TypeError(
        `Display ${definition.id} requires mount(container, context)`
      );
    }
    if (this.definitions.has(definition.id)) {
      throw new Error(`Display already defined: ${definition.id}`);
    }

    const frozen = Object.freeze({
      title: definition.id,
      position: [0.5, 0.05],
      width: null,
      defaultVisible: false,
      ...definition,
    });

    this.definitions.set(frozen.id, frozen);
    this.onChange({ type: "defined", id: frozen.id });
    return frozen;
  }

  definition(id) {
    const definition = this.definitions.get(id);
    if (!definition) {
      throw new Error(`Unknown display: ${id}`);
    }
    return definition;
  }

  get(id) {
    if (this.instances.has(id)) {
      return this.instances.get(id);
    }

    const definition = this.definition(id);
    const instance = this.factory(definition);
    this.instances.set(id, instance);
    this.onChange({ type: "created", id, instance });
    return instance;
  }

  open(id) {
    const instance = this.get(id);
    instance.show();
    this.onChange({ type: "shown", id, instance });
    return instance;
  }

  hide(id) {
    const instance = this.instances.get(id);
    if (!instance) return null;

    instance.hide();
    this.onChange({ type: "hidden", id, instance });
    return instance;
  }

  list() {
    return [...this.definitions.values()].map((definition) => ({
      definition,
      instance: this.instances.get(definition.id) ?? null,
    }));
  }
}

function isDescendantOf(root, node) {
  let current = node;
  while (current) {
    if (current === root) return true;
    current = current.parentNode ?? null;
  }
  return false;
}

export function releaseDisplayKeyboardFocus(element) {
  const document = element?.ownerDocument;
  const active = document?.activeElement;
  if (!active || !isDescendantOf(element, active)) {
    return false;
  }

  active.blur?.();
  return true;
}

export class LapinDisplay {
  constructor({
    definition,
    workspace,
    system,
  }) {
    this.definition = definition;
    this.id = definition.id;
    this.workspace = workspace;
    this.system = system;
    this.visible = false;

    const document = workspace.ownerDocument;

    this.element = document.createElement("section");
    this.element.className = "lapin-match-hud lapinet-display";
    this.element.dataset.displayId = this.id;
    this.element.hidden = true;

    if (Number.isFinite(definition.width)) {
      this.element.style.width = `${definition.width}px`;
    }

    this.title = document.createElement("div");
    this.title.className = "lapin-match-hud-title";
    this.title.setAttribute("aria-label", definition.title);
    this.title.textContent =
      String.fromCharCode(9660) + " " + definition.title;

    this.body = document.createElement("div");
    this.body.className = "lapinet-display-body";

    this.element.append(this.title, this.body);
    workspace.appendChild(this.element);
    system.bindRailHeightReference(this.title);

    this.element.addEventListener?.("pointerleave", () => {
      releaseDisplayKeyboardFocus(this.element);
    });

    definition.mount(this.body, {
      display: this,
      displays: system,
      config: system.config,
    });

    this.layoutRecord = system.layout.bindPanel(
      this.element,
      this.id,
      definition.position
    );

    if (!this.layoutRecord) {
      throw new Error(`Lapin display layout rejected panel: ${this.id}`);
    }
  }

  applyVisible(visible) {
    const next = !!visible;
    const changed = this.visible !== next || this.element.hidden === next;
    this.visible = next;
    this.element.hidden = !next;
    this.system.layout.setPanelVisibility(this.id, next);
    this.system.layout.applyPanel(this.id);
    return changed;
  }

  show() {
    return this.system.setVisible(this.id, true);
  }

  hide() {
    return this.system.setVisible(this.id, false);
  }

  center() {
    this.system.layout.centerPanel(this.id);
    return this;
  }
}

export class DisplaySystem {
  constructor({
    workspace,
    config,
    storage = null,
    layoutStorageKey = "lapinet.display.layout.v1",
    topRail = null,
    bottomRail = null,
    layoutManager = null,
  }) {
    if (!workspace) {
      throw new TypeError("DisplaySystem requires a workspace element");
    }

    this.workspace = workspace;
    this.config = config;
    this.storage = storage;
    this.layoutStorageKey = layoutStorageKey;
    this.listeners = new Set();
    this.started = false;
    this.persistenceReady = false;
    this.topRail = topRail;
    this.bottomRail = bottomRail;
    this.railReferenceTitle = null;
    this.railHeightObserver = null;

    this.layout = layoutManager ?? createDisplayLayoutManager({
      storage,
      storageKey: layoutStorageKey,
      topRail,
      bottomRail,
      onChange: () => {
        this.emit({ type: "layout" });
      },
    });

    this.registry = new DisplayRegistry(
      (definition) => new LapinDisplay({
        definition,
        workspace,
        system: this,
      }),
      (event) => this.registryChanged(event)
    );

    this.config?.subscribe?.((event) => {
      this.syncRailHeight();
      if (this.started) {
        this.applyConfigVisibility(event);
      }
    });
  }

  visibilityPath(id) {
    return `display.visibility.${id}`;
  }

  bindRailHeightReference(title) {
    if (this.railReferenceTitle || !title) return false;

    this.railReferenceTitle = title;
    const ResizeObserverClass = globalThis.ResizeObserver;
    if (typeof ResizeObserverClass === "function") {
      this.railHeightObserver = new ResizeObserverClass(() => {
        this.syncRailHeight();
      });
      this.railHeightObserver.observe(title);
    }

    return true;
  }

  syncRailHeight() {
    const height = this.railReferenceTitle?.getBoundingClientRect?.().height;
    if (!Number.isFinite(height) || height <= 0) return false;

    const cssHeight = height + "px";
    for (const rail of [this.topRail, this.bottomRail]) {
      if (rail?.style) rail.style.height = cssHeight;
    }
    this.workspace.style?.setProperty?.(
      "--lapin-hud-title-height",
      cssHeight
    );
    return true;
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event) {
    const frozen = Object.freeze({ ...event });
    for (const listener of this.listeners) {
      listener(frozen);
    }
  }

  registryChanged(event) {
    this.assertUniqueDom();
    this.emit(event);
  }

  register(definition) {
    if (this.started) {
      throw new Error(
        "Displays must be registered before DisplaySystem.start()"
      );
    }

    const registered = this.registry.define(definition);
    this.config?.define?.({
      path: this.visibilityPath(registered.id),
      label: `Display: ${registered.title}`,
      type: "boolean",
      default: !!registered.defaultVisible,
    });
    return registered;
  }

  start(defaultVisibleIds = []) {
    if (this.started) return this;

    const defaults = new Set(defaultVisibleIds);
    const savedExtras = this.layout.getExtras?.() ?? null;
    const legacyVisibility =
      savedExtras?.visibility &&
      typeof savedExtras.visibility === "object"
        ? savedExtras.visibility
        : {};

    for (const { definition } of this.registry.list()) {
      const path = this.visibilityPath(definition.id);

      if (!this.config.hasSourceValue?.(path)) {
        if (typeof legacyVisibility[definition.id] === "boolean") {
          this.config.set(path, legacyVisibility[definition.id]);
        } else if (defaults.has(definition.id)) {
          this.config.set(path, true);
        }
      }

      this.applyVisibility(definition.id, this.config.get(path));
    }

    if (savedExtras && Object.hasOwn(savedExtras, "visibility")) {
      const { visibility: _legacyVisibility, ...remainingExtras } = savedExtras;
      this.layout.setExtras?.(
        Object.keys(remainingExtras).length > 0 ? remainingExtras : null
      );
    }

    this.started = true;
    this.persistenceReady = true;
    this.layout.enablePersistence?.();
    this.layout.apply();
    this.syncRailHeight();
    this.assertUniqueDom();
    this.emit({ type: "started" });
    return this;
  }

  applyVisibility(id, visible) {
    const next = !!visible;
    const existing = this.registry.instances.get(id) ?? null;

    if (!next && !existing) {
      return null;
    }

    const display = existing ?? this.registry.get(id);
    display.applyVisible(next);
    return display;
  }

  applyConfigVisibility(event) {
    if (event?.path) {
      for (const { definition } of this.registry.list()) {
        const path = this.visibilityPath(definition.id);
        if (event.path === path) {
          const visible = this.config.get(path);
          this.applyVisibility(definition.id, visible);
          this.emit({
            type: "visibility",
            id: definition.id,
            visible,
          });
          return true;
        }
      }
      return false;
    }

    for (const { definition } of this.registry.list()) {
      const path = this.visibilityPath(definition.id);
      this.applyVisibility(definition.id, this.config.get(path));
    }
    this.emit({ type: "visibility-restored" });
    return true;
  }

  get(id) {
    return this.registry.get(id);
  }

  setVisible(id, visible) {
    const path = this.visibilityPath(id);
    const next = !!visible;
    const current = this.config.get(path);

    if (current === next) {
      return this.applyVisibility(id, next);
    }

    this.config.set(path, next);
    return this.registry.get(id);
  }

  open(id) {
    return this.setVisible(id, true);
  }

  hide(id) {
    return this.setVisible(id, false);
  }

  center(id) {
    return this.get(id).center();
  }

  assertUniqueDom() {
    const counts = new Map();

    for (const element of this.workspace.querySelectorAll("[data-display-id]")) {
      const id = element.dataset.displayId;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }

    for (const [id, count] of counts) {
      if (count > 1) {
        throw new Error(`Duplicate display DOM identity: ${id}`);
      }
    }

    return true;
  }
}
