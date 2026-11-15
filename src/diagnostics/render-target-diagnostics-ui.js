export const RENDER_TARGET_OPTIONS = Object.freeze([
  Object.freeze(["final", "Final"]),
  Object.freeze(["all", "All targets"]),
  Object.freeze(["albedo", "Albedo"]),
  Object.freeze(["normal", "Normal"]),
  Object.freeze(["material", "Material"]),
  Object.freeze(["depth", "Depth"]),
  Object.freeze(["position", "World position"]),
  Object.freeze(["effort", "Trace effort"]),
  Object.freeze(["roughness", "Roughness"]),
  Object.freeze(["ior", "IOR"]),
]);

export function mountRenderTargetDiagnosticsUI(
  container,
  { config }
) {
  const document = container.ownerDocument;

  const row = document.createElement("label");
  row.className = "diagnostic-control-row";

  const label = document.createElement("span");
  label.textContent = "Main render";

  const select = document.createElement("select");
  for (const [value, title] of RENDER_TARGET_OPTIONS) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = title;
    select.append(option);
  }

  const sync = () => {
    select.value = config.get("diagnostics.renderTarget");
  };

  select.addEventListener("change", () => {
    config.set("diagnostics.renderTarget", select.value);
  });

  row.append(label, select);

  const note = document.createElement("div");
  note.className = "status-note";
  note.textContent =
    "All targets shows the core 2x2 G-buffer grid. Additional views expose reconstructed position, trace effort, roughness, and IOR.";

  container.append(row, note);
  sync();

  const unsubscribe = config.subscribe((event) => {
    if (
      event.path == null ||
      event.path === "diagnostics.renderTarget"
    ) {
      sync();
    }
  });

  return () => unsubscribe();
}
