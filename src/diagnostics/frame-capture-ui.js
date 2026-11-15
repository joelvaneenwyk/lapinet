export function mountFrameCaptureUI(
  container,
  { capture }
) {
  const document = container.ownerDocument;

  const status = document.createElement("div");
  status.className = "status-note";

  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Capture now";
  button.addEventListener("click", () => {
    capture.capture();
  });

  const render = (state = capture.state()) => {
    if (state.lastError) {
      status.textContent = "Capture error: " + state.lastError;
      return;
    }

    if (state.lastResult) {
      status.textContent =
        `Latest: frame ${state.lastResult.frame} | ` +
        `${state.lastResult.width}x${state.lastResult.height}`;
      return;
    }

    status.textContent =
      state.enabled
        ? "Waiting for first changed frame..."
        : "Automatic capture disabled.";
  };

  container.append(button, status);
  render();

  const unsubscribe = capture.subscribe(render);
  return () => unsubscribe();
}
