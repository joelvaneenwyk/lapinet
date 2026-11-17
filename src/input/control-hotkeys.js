export function isKeyboardEditingTarget(target) {
  if (!target || typeof target !== "object") return false;
  if (target.isContentEditable) return true;

  const tag = String(target.tagName ?? "").toLowerCase();
  if (tag === "textarea" || tag === "select") return true;
  if (tag !== "input") return false;

  return [
    "text",
    "search",
    "url",
    "email",
    "password",
    "tel",
    "number",
  ].includes(String(target.type ?? "text").toLowerCase());
}

export function bindControlHotkeys({
  document = globalThis.document,
  onRenderPauseToggle = () => {},
  onSimulationPauseToggle = () => {},
  onSimulationRestart = () => {},
  onCycleRenderView = () => {},
  onCycleField = () => {},
  onToggleStats = () => {},
} = {}) {
  const keyDown = (event) => {
    if (
      event.repeat ||
      isKeyboardEditingTarget(event.target)
    ) {
      return;
    }

    if (event.code === "KeyP") {
      event.preventDefault?.();
      onRenderPauseToggle();
      return;
    }

    if (event.code === "KeyT") {
      event.preventDefault?.();
      onSimulationPauseToggle();
      return;
    }

    if (event.code === "KeyR") {
      event.preventDefault?.();
      onSimulationRestart();
      return;
    }

    // Modifier chords (e.g. Ctrl/Cmd+Shift+D) belong to other bindings.
    if (event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }

    if (event.code === "KeyV") {
      event.preventDefault?.();
      onCycleRenderView(event.shiftKey ? -1 : 1);
      return;
    }

    if (event.code === "KeyG") {
      event.preventDefault?.();
      onCycleField(event.shiftKey ? -1 : 1);
      return;
    }

    if (event.code === "Backquote") {
      event.preventDefault?.();
      onToggleStats();
    }
  };

  document?.addEventListener?.("keydown", keyDown);

  return {
    destroy() {
      document?.removeEventListener?.("keydown", keyDown);
    },
  };
}
