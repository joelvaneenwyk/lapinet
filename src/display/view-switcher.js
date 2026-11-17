// Fixed bottom-centre bar: switch between the two Lapinet pages and pick
// what the integrated renderer shows. Selects are two-way bound to config,
// so the Config / Render Targets panels and hotkeys stay in sync.
export const LAPINET_PAGES = Object.freeze([
  Object.freeze({
    id: "lattice",
    href: "./",
    label: "E8/H4 lattice",
    title: "Integrated scheduled E8/H4 lattice runtime (index.html)",
  }),
  Object.freeze({
    id: "springs",
    href: "./springs.html",
    label: "Springs & boids",
    title: "Compact reversible springs/boids demo (springs.html)",
  }),
]);

export function mountViewSwitcher({
  document = globalThis.document,
  parent = document?.body,
  current = "lattice",
  config = null,
  selects = [],
  buttons = [],
} = {}) {
  const bar = document.createElement("nav");
  bar.className = "lapinet-view-switcher";
  bar.setAttribute("aria-label", "Lapinet views");

  const pages = document.createElement("div");
  pages.className = "lapinet-view-pages";
  for (const page of LAPINET_PAGES) {
    const link = document.createElement("a");
    link.href = page.href;
    link.textContent = page.label;
    link.title = page.title;
    if (page.id === current) link.setAttribute("aria-current", "page");
    pages.append(link);
  }
  bar.append(pages);

  const unsubscribers = [];
  for (const { path, label, options, title } of selects) {
    const wrap = document.createElement("label");
    wrap.className = "lapinet-view-control";
    if (title) wrap.title = title;
    const caption = document.createElement("span");
    caption.textContent = label;
    const select = document.createElement("select");
    for (const [value, text] of options) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = text;
      select.append(option);
    }
    const sync = () => {
      select.value = config.get(path);
    };
    select.addEventListener("change", () => {
      config.set(path, select.value);
      select.blur();
    });
    sync();
    unsubscribers.push(
      config.subscribe((event) => {
        if (event.path == null || event.path === path) sync();
      })
    );
    wrap.append(caption, select);
    bar.append(wrap);
  }

  for (const { label, title, onClick, pressed } of buttons) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    if (title) button.title = title;
    const syncPressed = () => {
      if (pressed) button.setAttribute("aria-pressed", String(!!pressed()));
    };
    button.addEventListener("click", () => {
      onClick();
      syncPressed();
      button.blur();
    });
    syncPressed();
    if (pressed && config) {
      unsubscribers.push(config.subscribe(syncPressed));
    }
    bar.append(button);
  }

  parent.append(bar);

  return {
    element: bar,
    destroy() {
      for (const unsubscribe of unsubscribers) unsubscribe?.();
      bar.remove();
    },
  };
}

// Step through an options list, wrapping at both ends.
export function cycleOption(options, current, direction = 1) {
  const values = options.map((option) =>
    Array.isArray(option) ? option[0] : option
  );
  const index = values.indexOf(current);
  const step = direction < 0 ? -1 : 1;
  const next = index < 0
    ? 0
    : (index + step + values.length) % values.length;
  return values[next];
}
