import {
  ConfigStateStore,
} from "./config-state-store.js";
import {
  LAPINET_BUILD_VERSION,
} from "../version.js";

function titleCase(value) {
  return String(value ?? "")
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function configSectionForPath(path) {
  const parts = String(path).split(".");
  const root = parts[0] || "general";
  const child = parts[1] || "general";

  if (root === "ui") {
    return Object.freeze({
      id: "ui",
      label: "UI",
    });
  }

  if (root === "render") {
    return Object.freeze({
      id: `render.${child}`,
      label: `Render / ${titleCase(child)}`,
    });
  }

  if (root === "field") {
    return Object.freeze({
      id: `field.${child}`,
      label: `Field / ${titleCase(child)}`,
    });
  }

  if (root === "display") {
    return Object.freeze({
      id: `display.${child}`,
      label: `Display / ${titleCase(child)}`,
    });
  }

  if (root === "diagnostics") {
    return Object.freeze({
      id: "diagnostics",
      label: "Diagnostics",
    });
  }

  return Object.freeze({
    id: root,
    label: titleCase(root),
  });
}

export function mountConfigUI(
  container,
  {
    config,
    schema,
    storage = null,
    storageKey = "lapinet.config.v1",
  }
) {
  const document = container.ownerDocument;
  const sectionsRoot = document.createElement("div");
  sectionsRoot.className = "config-sections";
  const controls = new Map();
  const sliders = new Map();
  const sections = new Map();
  const stateStore = storage
    ? new ConfigStateStore({
        storage,
        storageKey: storageKey + ".states",
      })
    : null;

  const updateField = (field) => {
    const input = controls.get(field.path);
    if (!input) return;

    const value = config.get(field.path);
    if (field.type === "boolean") {
      input.checked = value;
    } else {
      input.value = String(value);
    }

    const slider = sliders.get(field.path);
    if (slider) {
      slider.value = String(value);
    }
  };

  const getSection = (field) => {
    const descriptor = configSectionForPath(field.path);
    if (sections.has(descriptor.id)) {
      return sections.get(descriptor.id);
    }

    const details = document.createElement("details");
    details.className = "config-section";
    details.dataset.sectionId = descriptor.id;
    details.open = true;

    const summary = document.createElement("summary");
    summary.className = "config-section-title";
    summary.textContent = descriptor.label;

    const grid = document.createElement("div");
    grid.className = "config-grid";

    details.append(summary, grid);
    sectionsRoot.append(details);

    const section = Object.freeze({
      details,
      summary,
      grid,
    });
    sections.set(descriptor.id, section);
    return section;
  };

  for (const field of schema) {
    if (field.hidden) continue;

    const section = getSection(field);
    const row = document.createElement("label");
    row.className = "config-row";
    row.dataset.configPath = field.path;

    const title = document.createElement("span");
    title.textContent = field.label;

    const input = document.createElement(
      field.type === "enum" ? "select" : "input"
    );
    let control = input;

    if (field.type === "boolean") {
      input.type = "checkbox";
      input.addEventListener("change", () => {
        config.set(field.path, input.checked);
      });
    } else if (field.type === "number") {
      const numberControl = document.createElement("div");
      numberControl.className = "config-number-control";

      const slider = document.createElement("input");
      slider.type = "range";
      slider.className = "config-slider";
      if (field.min != null) slider.min = String(field.min);
      if (field.max != null) slider.max = String(field.max);
      if (field.step != null) slider.step = String(field.step);
      slider.addEventListener("input", () => {
        config.set(field.path, Number(slider.value));
        updateField(field);
      });

      input.type = "number";
      if (field.min != null) input.min = String(field.min);
      if (field.max != null) input.max = String(field.max);
      if (field.step != null) input.step = String(field.step);
      input.addEventListener("change", () => {
        config.set(field.path, Number(input.value));
        updateField(field);
      });

      sliders.set(field.path, slider);
      numberControl.append(slider, input);
      control = numberControl;
    } else if (field.type === "color") {
      input.type = "color";
      input.addEventListener("input", () => {
        config.set(field.path, input.value);
      });
    } else if (field.type === "enum") {
      for (const optionValue of field.options ?? []) {
        const option = document.createElement("option");
        option.value = String(optionValue);
        option.textContent = String(optionValue);
        input.append(option);
      }
      input.addEventListener("change", () => {
        config.set(field.path, input.value);
      });
    } else {
      input.type = "text";
      input.addEventListener("change", () => {
        config.set(field.path, input.value);
      });
    }

    controls.set(field.path, input);
    updateField(field);
    row.append(title, control);
    section.grid.append(row);
  }

  const actions = document.createElement("div");
  actions.className = "config-actions";

  const reset = document.createElement("button");
  reset.type = "button";
  reset.textContent = "Defaults";
  reset.addEventListener("click", () => config.reset());

  const save = document.createElement("button");
  save.type = "button";
  save.textContent = "Save";
  save.disabled = !storage;
  save.addEventListener("click", () => {
    if (!storage) return;

    try {
      storage.setItem(storageKey, JSON.stringify(config.snapshot()));
    } catch (error) {
      console.warn("Lapinet config save failed", error);
    }
  });

  const load = document.createElement("button");
  load.type = "button";
  load.textContent = "Load";
  load.disabled = !storage;
  load.addEventListener("click", () => {
    if (!storage) return;

    try {
      const raw = storage.getItem(storageKey);
      if (!raw) return;
      config.restore(JSON.parse(raw));
    } catch (error) {
      console.warn("Lapinet config load failed", error);
    }
  });

  actions.append(reset, save, load);

  const stateActions = document.createElement("div");
  stateActions.className = "config-state-actions";

  const stateName = document.createElement("input");
  stateName.type = "text";
  stateName.placeholder = "state name";
  stateName.className = "config-state-name";

  const stateSelect = document.createElement("select");
  stateSelect.className = "config-state-select";

  const saveState = document.createElement("button");
  saveState.type = "button";
  saveState.textContent = "Save state";
  saveState.disabled = !stateStore;

  const loadState = document.createElement("button");
  loadState.type = "button";
  loadState.textContent = "Load state";
  loadState.disabled = !stateStore;

  const deleteState = document.createElement("button");
  deleteState.type = "button";
  deleteState.textContent = "Delete";
  deleteState.disabled = !stateStore;

  const clearStateOptions = () => {
    if (stateSelect.replaceChildren) {
      stateSelect.replaceChildren();
    } else if (Array.isArray(stateSelect.children)) {
      stateSelect.children.length = 0;
    }
  };

  const refreshStates = (preferred = "") => {
    clearStateOptions();

    let names = [];
    try {
      names = stateStore?.list() ?? [];
    } catch (error) {
      console.warn("Lapinet config state list failed", error);
    }

    if (names.length === 0) {
      const empty = document.createElement("option");
      empty.value = "";
      empty.textContent = "(no saved states)";
      stateSelect.append(empty);
      stateSelect.value = "";
      loadState.disabled = true;
      deleteState.disabled = true;
      return;
    }

    for (const name of names) {
      const option = document.createElement("option");
      option.value = name;
      option.textContent = name;
      stateSelect.append(option);
    }

    stateSelect.value = names.includes(preferred)
      ? preferred
      : names[0];
    loadState.disabled = !stateStore;
    deleteState.disabled = !stateStore;
  };

  stateSelect.addEventListener("change", () => {
    if (stateSelect.value) {
      stateName.value = stateSelect.value;
    }
  });

  saveState.addEventListener("click", () => {
    if (!stateStore) return;
    const name = String(
      stateName.value || stateSelect.value || ""
    ).trim();
    if (!name) return;

    try {
      stateStore.save(name, config.snapshot());
      stateName.value = name;
      refreshStates(name);
    } catch (error) {
      console.warn("Lapinet config state save failed", error);
    }
  });

  loadState.addEventListener("click", () => {
    if (!stateStore || !stateSelect.value) return;

    try {
      const snapshot = stateStore.load(stateSelect.value);
      if (!snapshot) return;
      stateName.value = stateSelect.value;
      config.restore(snapshot);
    } catch (error) {
      console.warn("Lapinet config state load failed", error);
    }
  });

  deleteState.addEventListener("click", () => {
    if (!stateStore || !stateSelect.value) return;

    try {
      stateStore.remove(stateSelect.value);
      refreshStates();
    } catch (error) {
      console.warn("Lapinet config state delete failed", error);
    }
  });

  stateActions.append(
    stateName,
    stateSelect,
    saveState,
    loadState,
    deleteState
  );
  refreshStates();

  const note = document.createElement("div");
  note.className = "status-note";
  note.textContent =
    "Config is canonical CPU state. Named states snapshot the full canonical configuration.";

  const version = document.createElement("div");
  version.className = "config-version";
  version.dataset.buildVersion = LAPINET_BUILD_VERSION;
  version.textContent = `Lapinet v${LAPINET_BUILD_VERSION}`;

  container.append(sectionsRoot, actions, stateActions, note, version);

  const unsubscribe = config.subscribe((event) => {
    if (event.path) {
      const field = schema.find((candidate) => candidate.path === event.path);
      if (field) updateField(field);
      return;
    }
    for (const field of schema) updateField(field);
  });

  return () => unsubscribe();
}
