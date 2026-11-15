export function mountDisplaysUI(container, {
  displays,
}) {
  const document = container.ownerDocument;
  const list = document.createElement("div");
  list.className = "display-list";
  const rows = new Map();

  const ensureRow = (definition) => {
    if (rows.has(definition.id)) {
      return rows.get(definition.id);
    }

    const row = document.createElement("label");
    row.className = "display-row";

    const title = document.createElement("span");
    title.textContent = definition.title;

    const visible = document.createElement("input");
    visible.type = "checkbox";
    visible.addEventListener("change", () => {
      if (visible.checked) {
        displays.open(definition.id);
      } else {
        displays.hide(definition.id);
      }
    });

    row.append(title, visible);
    list.append(row);

    const record = { row, visible };
    rows.set(definition.id, record);
    return record;
  };

  const refresh = () => {
    for (const { definition, instance } of displays.registry.list()) {
      const row = ensureRow(definition);
      row.visible.checked = instance ? instance.visible : false;
    }
  };

  const actions = document.createElement("div");
  actions.className = "display-actions";

  const reset = document.createElement("button");
  reset.type = "button";
  reset.textContent = "Reset layout";
  reset.addEventListener("click", () => displays.resetLayout());

  const save = document.createElement("button");
  save.type = "button";
  save.textContent = "Save layout";
  save.disabled = !displays.storage;
  save.addEventListener("click", () => displays.saveStoredLayout());

  actions.append(reset, save);

  const note = document.createElement("div");
  note.className = "status-note";
  note.textContent =
    "Visibility is canonical Config state. This panel and Config edit the same display switches.";

  container.append(list, actions, note);
  refresh();

  const unsubscribe = displays.subscribe(() => refresh());
  return () => unsubscribe();
}
