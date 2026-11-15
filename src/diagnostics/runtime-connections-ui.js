const DEFAULT_PRESENCE_URL = "http://127.0.0.1:9236/presence";

function ageLabel(value, now = Date.now()) {
  const time = Date.parse(value ?? "");
  if (!Number.isFinite(time)) return "";
  const seconds = Math.max(Math.round((now - time) / 1000), 0);
  if (seconds < 2) return "now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ago`;
}

export function runtimeConnectionSnapshot({
  simulation = null,
  simulationError = null,
  renderer = null,
  rendererError = null,
  presence = null,
} = {}) {
  const simulationState = simulationError
    ? {
        state: "error",
        detail: String(simulationError?.message ?? simulationError),
      }
    : simulation
      ? {
          state: simulation.running
            ? (simulation.paused ? "paused" : "running")
            : "stopped",
          detail: `position v${simulation.positionVersion ?? 0}`,
        }
      : { state: "starting", detail: "initializing GPU simulation" };

  const rendererState = rendererError
    ? {
        state: "error",
        detail: String(rendererError?.message ?? rendererError),
      }
    : renderer
      ? {
          state: renderer.surface?.isPaused?.() ? "paused" : "running",
          detail: `${renderer.surface?.passes?.length ?? 0} render passes`,
        }
      : { state: "starting", detail: "initializing renderer" };

  return Object.freeze({
    simulation: simulationState,
    renderer: rendererState,
    bridge: presence
      ? {
          state: presence.cdp === "online" ? "connected" : "bridge only",
          detail: presence.target?.url ?? "No eligible Lapinet target",
        }
      : {
          state: "offline",
          detail: "Lapinet browser bridge not connected",
        },
    clients: Array.isArray(presence?.clients)
      ? presence.clients
      : [],
  });
}

function clear(element) {
  if (element.replaceChildren) {
    element.replaceChildren();
    return;
  }
  if (Array.isArray(element.children)) {
    element.children.length = 0;
  }
}

function appendStatusRow(document, list, label, state, detail) {
  const row = document.createElement("div");
  row.className = "connection-row";
  row.dataset.state = state;

  const name = document.createElement("span");
  name.className = "connection-name";
  name.textContent = label;

  const badge = document.createElement("span");
  badge.className = "connection-state";
  badge.textContent = state;

  const info = document.createElement("span");
  info.className = "connection-detail";
  info.textContent = detail || "";

  row.append(name, badge, info);
  list.append(row);
}

export function mountRuntimeConnectionsUI(
  container,
  {
    getRuntime = () => ({}),
    presenceUrl = DEFAULT_PRESENCE_URL,
    fetchImpl = globalThis.fetch,
    setTimer = globalThis.setInterval,
    clearTimer = globalThis.clearInterval,
    intervalMs = 1500,
  } = {}
) {
  const document = container.ownerDocument;
  const list = document.createElement("div");
  list.className = "connection-list";

  let presence = null;
  let stopped = false;

  const render = () => {
    const runtime = getRuntime() ?? {};
    const snapshot = runtimeConnectionSnapshot({
      ...runtime,
      presence,
    });

    clear(list);
    appendStatusRow(
      document,
      list,
      "Simulation",
      snapshot.simulation.state,
      snapshot.simulation.detail
    );
    appendStatusRow(
      document,
      list,
      "Renderer",
      snapshot.renderer.state,
      snapshot.renderer.detail
    );
    appendStatusRow(
      document,
      list,
      "Browser inspector",
      snapshot.bridge.state,
      snapshot.bridge.detail
    );

    const clientsTitle = document.createElement("div");
    clientsTitle.className = "connection-subtitle";
    clientsTitle.textContent = "Connected clients";
    list.append(clientsTitle);

    if (snapshot.clients.length === 0) {
      const empty = document.createElement("div");
      empty.className = "status-note";
      empty.textContent = "No authenticated browser clients observed yet.";
      list.append(empty);
    } else {
      for (const client of snapshot.clients) {
        appendStatusRow(
          document,
          list,
          String(client.id ?? "unknown"),
          "connected",
          ageLabel(client.lastActivity)
        );
      }
    }
  };

  const poll = async () => {
    if (stopped || typeof fetchImpl !== "function") return;
    try {
      const response = await fetchImpl(presenceUrl, {
        cache: "no-store",
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      presence = await response.json();
    } catch {
      presence = null;
    }
    render();
  };

  container.append(list);
  render();
  poll();
  const timer = setTimer?.(() => {
    poll();
  }, Math.max(Number(intervalMs) || 1500, 500));

  return () => {
    stopped = true;
    if (timer != null) clearTimer?.(timer);
  };
}
