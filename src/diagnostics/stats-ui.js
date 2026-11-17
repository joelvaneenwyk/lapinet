// Live stats panel. `sample()` returns sections of label/value rows:
//   [{ title: "Renderer", rows: [["FPS", "60.0"], ...] }, ...]
// The panel re-samples on an interval and only rewrites changed text.
export function mountStatsUI(
  container,
  {
    sample,
    intervalMs = 250,
    setInterval = globalThis.setInterval,
    clearInterval = globalThis.clearInterval,
    footer = "",
  }
) {
  if (typeof sample !== "function") {
    throw new TypeError("mountStatsUI requires sample()");
  }

  const document = container.ownerDocument;
  const root = document.createElement("div");
  root.className = "stats-list";
  container.append(root);

  if (footer) {
    const note = document.createElement("div");
    note.className = "status-note";
    note.textContent = footer;
    container.append(note);
  }

  const cells = new Map();
  let shape = "";

  const build = (sections) => {
    root.replaceChildren();
    cells.clear();
    for (const section of sections) {
      const title = document.createElement("div");
      title.className = "stats-section";
      title.textContent = section.title;
      root.append(title);
      for (const [label] of section.rows) {
        const name = document.createElement("span");
        name.className = "stats-label";
        name.textContent = label;
        const value = document.createElement("span");
        value.className = "stats-value";
        root.append(name, value);
        cells.set(section.title + "\u0000" + label, value);
      }
    }
  };

  const refresh = () => {
    let sections;
    try {
      sections = sample() ?? [];
    } catch (error) {
      sections = [{
        title: "Stats",
        rows: [["error", String(error?.message ?? error)]],
      }];
    }

    const nextShape = sections
      .map((s) => s.title + ":" + s.rows.map(([l]) => l).join(","))
      .join("|");
    if (nextShape !== shape) {
      build(sections);
      shape = nextShape;
    }

    for (const section of sections) {
      for (const [label, value] of section.rows) {
        const cell = cells.get(section.title + "\u0000" + label);
        const text = String(value ?? "—");
        if (cell && cell.textContent !== text) cell.textContent = text;
      }
    }
  };

  refresh();
  const timer = setInterval?.(refresh, intervalMs) ?? null;

  return {
    refresh,
    destroy() {
      if (timer != null) clearInterval?.(timer);
      root.remove();
    },
  };
}
