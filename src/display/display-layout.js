export const DISPLAY_LAYOUT_STORAGE_KEY = "lapin.display.layout.v1";

const clamp01 = (value) => Math.min(Math.max(Number(value) || 0, 0), 1);
const clone = (value) => {
  if (value == null) return value;
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
};

function normalizedPosition(position) {
  if (!Array.isArray(position) || position.length < 2) return [0.5, 0.05];
  return [clamp01(position[0]), clamp01(position[1])];
}

function normalizedPanelState(saved, legacyPosition) {
  const source = saved && typeof saved === "object" ? saved : {};
  return {
    mode: source.mode === "docked" ? "docked" : "floating",
    edge: source.edge === "bottom" ? "bottom" : "top",
    side: source.side === "right" ? "right" : "left",
    order: Number.isFinite(source.order) ? Number(source.order) : 0,
    floatPosition: normalizedPosition(
      Array.isArray(source.floatPosition) ? source.floatPosition : legacyPosition
    ),
    collapsed: !!source.collapsed,
  };
}

function readProfile(storage, storageKey) {
  try {
    const raw = storage?.getItem?.(storageKey);
    if (!raw) return { stored: false, profile: null };
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object"
      ? { stored: true, profile: parsed }
      : { stored: false, profile: null };
  } catch {
    return { stored: false, profile: null };
  }
}

export function createDisplayLayoutManager({
  storage = globalThis.localStorage,
  storageKey = DISPLAY_LAYOUT_STORAGE_KEY,
  topRail = null,
  bottomRail = null,
  referenceTitle = null,
  onChange = () => {},
} = {}) {
  const loaded = readProfile(storage, storageKey);
  const profile = {
    version: 1,
    panels: loaded.profile?.panels && typeof loaded.profile.panels === "object"
      ? clone(loaded.profile.panels)
      : {},
    extras: loaded.profile?.extras && typeof loaded.profile.extras === "object"
      ? clone(loaded.profile.extras)
      : null,
  };
  const records = new Map();
  const visibilityStates = new Map();
  let persistenceEnabled = false;
  let saveTimer = null;

  function syncRailHeight() {
    const height = referenceTitle?.getBoundingClientRect?.().height;
    if (!Number.isFinite(height) || height <= 0) return;
    for (const rail of [topRail, bottomRail]) {
      if (rail) rail.style.height = height + "px";
    }
  }

  const railHeightObserver =
    referenceTitle && typeof ResizeObserver === "function"
      ? new ResizeObserver(syncRailHeight)
      : null;
  railHeightObserver?.observe(referenceTitle);

  function writeNow() {
    if (!persistenceEnabled) return false;
    try {
      storage?.setItem?.(storageKey, JSON.stringify(profile));
      return true;
    } catch (error) {
      console.warn("Lapin display layout save failed", error);
      return false;
    }
  }

  function scheduleWrite() {
    if (!persistenceEnabled) return;
    if (saveTimer != null) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      writeNow();
    }, 80);
  }

  function updateHandle(record) {
    const collapsed = !!record.state.collapsed;
    record.element.classList.toggle("collapsed", collapsed);
    record.handle.textContent =
      String.fromCharCode(collapsed ? 9658 : 9660) + " " + record.label;
    record.handle.setAttribute("aria-expanded", String(!collapsed));
  }

  function applyFloating(record) {
    const position = normalizedPosition(record.state.floatPosition);
    record.state.floatPosition = position;
    record.element.classList.remove(
      "docked", "dock-top", "dock-bottom", "dock-left", "dock-right"
    );
    record.element.classList.toggle("opens-up", position[1] >= 0.5);
    record.element.style.left = (position[0] * 100).toFixed(3) + "%";
    record.element.style.top = (position[1] * 100).toFixed(3) + "%";
    record.element.style.right = "auto";
    record.element.style.bottom = "auto";
  }

  function prepareDocked(record) {
    const { edge, side } = record.state;
    record.element.classList.remove("opens-up");
    record.element.classList.add(
      "docked",
      edge === "bottom" ? "dock-bottom" : "dock-top",
      side === "right" ? "dock-right" : "dock-left"
    );
    record.element.classList.remove(
      edge === "bottom" ? "dock-top" : "dock-bottom",
      side === "right" ? "dock-left" : "dock-right"
    );
    record.element.style.top = edge === "top" ? "0px" : "auto";
    record.element.style.bottom = edge === "bottom" ? "0px" : "auto";
  }

  function packDockGroup(edge, side) {
    const group = [...records.values()]
      .filter((record) =>
        !record.element.hidden &&
        record.state.mode === "docked" &&
        record.state.edge === edge &&
        record.state.side === side
      )
      .sort((a, b) =>
        a.state.order - b.state.order || a.key.localeCompare(b.key)
      );

    let cursor = 0;
    for (const record of group) {
      const rect = record.element.getBoundingClientRect();
      if (side === "right") {
        record.element.style.left = "auto";
        record.element.style.right = cursor + "px";
      } else {
        record.element.style.right = "auto";
        record.element.style.left = cursor + "px";
      }
      cursor += Math.max(rect.width - 1, 1);
    }
  }

  function apply() {
    syncRailHeight();
    for (const record of records.values()) {
      updateHandle(record);
      if (record.state.mode === "docked") prepareDocked(record);
      else applyFloating(record);
    }
    packDockGroup("top", "left");
    packDockGroup("top", "right");
    packDockGroup("bottom", "left");
    packDockGroup("bottom", "right");

    for (const record of records.values()) {
      if (record.element.hidden || record.state.collapsed) continue;
      const rect = record.element.getBoundingClientRect();
      if (rect.width > 0) record.lastWidth = rect.width;
      if (rect.height > 0) record.lastHeight = rect.height;
    }
  }

  function setCandidate(candidate) {
    for (const [edge, rail] of [["top", topRail], ["bottom", bottomRail]]) {
      if (!rail) continue;
      const active = candidate?.edge === edge;
      rail.classList.toggle("active", active);
      if (active) {
        rail.dataset.dockSide = candidate.side;
        if (Number.isFinite(candidate.divider)) {
          const divider = Math.min(
            Math.max(candidate.divider, 0),
            Math.max(window.innerWidth, 0)
          );
          rail.style.setProperty("--lapin-dock-divider", divider + "px");
        }
      } else {
        delete rail.dataset.dockSide;
      }
    }
  }

  function dockSideDivider(edge) {
    const centers = [...records.values()]
      .filter((record) =>
        !record.element.hidden &&
        !record.state.collapsed &&
        record.state.mode === "docked" &&
        record.state.edge === edge
      )
      .map((record) => {
        const rect = record.handle.getBoundingClientRect();
        return rect.left + rect.width * 0.5;
      })
      .filter(Number.isFinite);

    if (centers.length === 0) return window.innerWidth * 0.5;
    const leftmost = Math.min(...centers);
    const rightmost = Math.max(...centers);
    return (leftmost + rightmost) * 0.5;
  }

  function candidateForPointer(event, titleHeight) {
    const threshold = Math.max(42, titleHeight + 14);
    const edge = event.clientY <= threshold
      ? "top"
      : event.clientY >= window.innerHeight - threshold
        ? "bottom"
        : null;
    if (!edge) return null;
    const divider = dockSideDivider(edge);
    return {
      edge,
      side: event.clientX < divider ? "left" : "right",
      divider,
    };
  }

  function notifyChanged() {
    scheduleWrite();
    onChange(snapshot());
  }

  function centerPanel(key) {
    const record = records.get(key);
    if (!record) return false;

    const viewportWidth = Math.max(window.innerWidth, 1);
    const viewportHeight = Math.max(window.innerHeight, 1);

    // Expand first, synchronously, so a panel that was collapsed on a rail is
    // centered using its opened dimensions rather than its tiny title tab.
    record.state.mode = "floating";
    record.state.collapsed = false;
    record.state.floatPosition = [0.5, 0.5];
    apply();

    const rect = record.element.getBoundingClientRect();
    const panelWidth =
      rect.width > 0 ? rect.width : Math.max(record.lastWidth || 190, 1);
    const panelHeight =
      rect.height > 0 ? rect.height : Math.max(record.lastHeight || 100, 1);
    record.state.floatPosition = [
      Math.max((viewportWidth - panelWidth) * 0.5, 0) / viewportWidth,
      Math.max((viewportHeight - panelHeight) * 0.5, 0) / viewportHeight,
    ];
    apply();
    notifyChanged();
    return true;
  }

  function setPanelLabel(key, label) {
    const record = records.get(key);
    if (!record) return false;
    const next = String(label ?? "").trim();
    if (!next) return false;
    record.label = next;
    record.handle.setAttribute("aria-label", next);
    updateHandle(record);
    return true;
  }

  function setPanelVisibility(key, visible) {
    const next = !!visible;
    const previous = visibilityStates.get(key);
    visibilityStates.set(key, next);

    if (!persistenceEnabled || previous === undefined || previous === next) {
      return false;
    }

    // Visibility is independent of layout. Reopening a display must preserve
    // its dock edge/side/order, floating position, and collapsed state.
    return true;
  }

  function bindPanel(element, key, legacyPosition = [0.5, 0.05]) {
    if (!element || !key) return null;
    if (records.has(key)) return records.get(key);
    const handle = element.querySelector(".lapin-match-hud-title");
    if (!handle) return null;

    const label =
      handle.getAttribute("aria-label") ||
      handle.textContent.replace(/^.\s*/, "").trim() ||
      key;
    const state = normalizedPanelState(profile.panels[key], legacyPosition);
    profile.panels[key] = state;
    const record = { key, element, handle, label, state };
    records.set(key, record);
    element.dataset.displayPanel = key;

    let drag = null;
    handle.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      const titleRect = handle.getBoundingClientRect();
      drag = {
        pointerId: event.pointerId,
        offsetX: event.clientX - rect.left,
        offsetY: event.clientY - titleRect.top,
        startX: event.clientX,
        startY: event.clientY,
        startRect: {
          left: rect.left,
          top: rect.top,
          titleHeight: titleRect.height,
        },
        moved: false,
        detached: false,
        candidate: null,
      };
      handle.setPointerCapture?.(event.pointerId);
      element.classList.add("dragging");
    });

    handle.addEventListener("pointermove", (event) => {
      if (!drag || drag.pointerId !== event.pointerId) return;
      if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 4) {
        drag.moved = true;
      }
      if (!drag.moved) return;

      if (record.state.mode === "docked" && !drag.detached) {
        record.state.mode = "floating";
        record.state.floatPosition = [
          drag.startRect.left / Math.max(window.innerWidth, 1),
          drag.startRect.top / Math.max(window.innerHeight, 1),
        ];
        drag.detached = true;
      }

      const width = Math.max(window.innerWidth, 1);
      const height = Math.max(window.innerHeight, 1);
      const rect = element.getBoundingClientRect();
      const left = Math.min(
        Math.max(event.clientX - drag.offsetX, 0),
        Math.max(width - rect.width, 0)
      );
      const top = Math.min(
        Math.max(event.clientY - drag.offsetY, 0),
        Math.max(height - drag.startRect.titleHeight, 0)
      );
      record.state.floatPosition = [left / width, top / height];
      drag.candidate = candidateForPointer(event, drag.startRect.titleHeight);
      setCandidate(drag.candidate);
      apply();
    });

    const finish = (event, cancelled = false) => {
      if (!drag || drag.pointerId !== event.pointerId) return;
      const moved = drag.moved;
      const candidate = cancelled ? null : drag.candidate;
      handle.releasePointerCapture?.(event.pointerId);
      drag = null;
      element.classList.remove("dragging");
      setCandidate(null);

      if (!moved && !cancelled) {
        record.state.collapsed = !record.state.collapsed;
      } else if (moved && candidate) {
        record.state.mode = "docked";
        record.state.edge = candidate.edge;
        record.state.side = candidate.side;
        record.state.order = candidate.side === "right"
          ? Math.max(window.innerWidth - event.clientX, 0)
          : Math.max(event.clientX, 0);
      }

      apply();
      notifyChanged();
    };

    handle.addEventListener("pointerup", (event) => finish(event, false));
    handle.addEventListener("pointercancel", (event) => finish(event, true));
    apply();
    return record;
  }

  function setExtras(extras) {
    profile.extras = extras && typeof extras === "object" ? clone(extras) : null;
  }

  function snapshot() {
    return clone(profile);
  }

  return {
    bindPanel,
    apply,
    applyPanel: () => apply(),
    centerPanel,
    setPanelLabel,
    setPanelVisibility,
    syncRailHeight,
    hasStoredProfile: () => loaded.stored,
    getExtras: () => clone(profile.extras),
    setExtras,
    enablePersistence() {
      persistenceEnabled = true;
      writeNow();
    },
    save: writeNow,
    snapshot,
  };
}
