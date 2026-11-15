export function mountKernelDiagnosticsUI(
  container,
  { diagnostics }
) {
  const document = container.ownerDocument;
  const list = document.createElement("div");
  list.className = "kernel-list";

  let lastSignature = null;

  const render = (snapshot = null) => {
    const kernels = Array.isArray(snapshot)
      ? snapshot
      : diagnostics.kernels();
    const signature = kernels.map((kernel) =>
      [
        kernel.id,
        kernel.label,
        kernel.kind,
        kernel.stage,
        kernel.active ? 1 : 0,
        kernel.detail,
      ].join("\u0000")
    ).join("\u0001");

    if (signature === lastSignature) {
      return false;
    }
    lastSignature = signature;

    list.replaceChildren?.();
    if (!list.replaceChildren) {
      while (list.children?.length) {
        list.children.pop();
      }
    }
    if (kernels.length === 0) {
      const empty = document.createElement("div");
      empty.className = "status-note";
      empty.textContent = "No GPU kernels registered yet.";
      list.append(empty);
      return true;
    }

    for (const kernel of kernels) {
      const row = document.createElement("div");
      row.className = "kernel-row";

      const name = document.createElement("span");
      name.className = "kernel-name";
      name.textContent = kernel.label;

      const type = document.createElement("span");
      type.className = "kernel-kind";
      type.textContent = kernel.kind;

      const detail = document.createElement("span");
      detail.className = "kernel-detail";
      detail.textContent = kernel.detail;

      row.dataset.active = kernel.active ? "true" : "false";
      row.append(name, type, detail);
      list.append(row);
    }
    return true;
  };

  render();
  const unsubscribe = diagnostics.subscribe(render);
  container.append(list);

  return () => unsubscribe();
}
