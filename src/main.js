import {
  LAPINET_CONFIG_SCHEMA,
  LAPINET_CONFIG_VERSION,
} from "./config/config-schema.js";
import {
  ConfigSystem,
} from "./config/config-system.js";
import {
  mountConfigUI,
} from "./config/config-ui.js";
import {
  DiagnosticsRegistry,
} from "./diagnostics/diagnostics-registry.js";
import {
  FrameCapturePublisher,
} from "./diagnostics/frame-capture.js";
import {
  mountKernelDiagnosticsUI,
} from "./diagnostics/kernel-diagnostics-ui.js";
import {
  mountRenderTargetDiagnosticsUI,
} from "./diagnostics/render-target-diagnostics-ui.js";
import {
  mountRuntimeConnectionsUI,
} from "./diagnostics/runtime-connections-ui.js";
import {
  DisplaySystem,
} from "./display/display-system.js";
import {
  mountDisplaysUI,
} from "./display/displays-ui.js";
import {
  CometField,
} from "./fields/comet-field.js";
import {
  FractalField,
} from "./fields/fractal-field.js";
import {
  NoneField,
} from "./fields/none-field.js";
import {
  PlaneField,
} from "./fields/plane-field.js";
import {
  GpuContext,
} from "./gpu/gpu-context.js";
import {
  createScsSimulationRuntime,
} from "./systems/scs/simulation-runtime.js";
import {
  SCS_PARTICLE_RECORDS,
  SCS_PARTICLE_STABLE_IDS,
} from "./systems/scs/fixture-particles.js";
import {
  SCHEDULED_FLOCK_STATE,
} from "./systems/scheduled-transport/scheduled-flock.js";
import {
  R4_SCS_RESOURCES,
} from "./systems/scs/r4-scs-system.js";
import {
  PrimitiveSource,
} from "./primitives/primitive-source.js";
import {
  PointerState,
  bindPointerSurface,
} from "./input/pointer-state.js";
import {
  bindControlHotkeys,
} from "./input/control-hotkeys.js";
import {
  PerspectiveCamera,
} from "./render/camera.js";
import {
  OrbitFlightCameraController,
  bindOrbitFlightCamera,
} from "./render/camera-controls.js";
import {
  GpuCursorPass,
} from "./render/cursor/cursor-pass.js";
import {
  DeferredLightingPass,
} from "./render/deferred/deferred-lighting-pass.js";
import {
  GBuffer,
} from "./render/gbuffer.js";
import {
  ImplicitSurfacePass,
} from "./render/implicit/implicit-surface-pass.js";
import {
  RenderTargetDebugPass,
} from "./render/diagnostics/render-target-debug-pass.js";
import {
  PrimitiveLayerPass,
} from "./render/primitives/primitive-layer-pass.js";
import {
  SimulationParticlePass,
} from "./render/particles/simulation-particle-pass.js";
import {
  ParticleDebugPass,
} from "./render/particles/particle-debug-pass.js";
import {
  RenderSurface,
  bindRenderFocusPause,
} from "./render/render-surface.js";
import {
  createPrimitiveTestScene,
} from "./scene/primitive-test-scene.js";

const CONFIG_STORAGE_KEY = "lapinet.config.v1";
const LAYOUT_STORAGE_KEY = "lapinet.display.layout.v1";

function loadInitialConfiguration(storage) {
  try {
    const raw = storage?.getItem(CONFIG_STORAGE_KEY);
    if (!raw) return null;
    const document = JSON.parse(raw);
    const implicit = document?.values?.render?.implicit;
    if (implicit) {
      const revision = Number(
        implicit.performanceRevision ?? 0
      );

      if (revision < 1) {
        if (implicit.renderScale === 0.5) {
          implicit.renderScale = 0.25;
        }
        implicit.performanceRevision = 1;
      }

      if (revision < 2) {
        if (implicit.renderScale === 0.25) {
          implicit.renderScale = 0.5;
        }
        if (implicit.hitEpsilon === 0.0004) {
          implicit.hitEpsilon = 0.00000001;
        }
        if (implicit.normalEpsilon === 0.001) {
          implicit.normalEpsilon = 0.00000001;
        }
        if (implicit.hitDistanceScale == null) {
          implicit.hitDistanceScale = 0.05;
        }
        implicit.performanceRevision = 2;
      }

      if (revision < 3) {
        const fractal = document?.values?.field?.fractal;
        if (fractal?.iterations === 32) {
          fractal.iterations = 40;
        }
        implicit.performanceRevision = 3;
      }
    }

    // Render capture is diagnostic I/O, not a durable run-state preference.
    // Every cold start requires an explicit opt-in, even if an older saved
    // configuration happened to persist it as enabled.
    if (document?.values?.diagnostics?.capture) {
      document.values.diagnostics.capture.enabled = false;
    }

    return document;
  } catch {
    return null;
  }
}

function createConfig(storage) {
  const initial = loadInitialConfiguration(storage);

  try {
    return new ConfigSystem({
      version: LAPINET_CONFIG_VERSION,
      schema: LAPINET_CONFIG_SCHEMA,
      initial,
    });
  } catch {
    return new ConfigSystem({
      version: LAPINET_CONFIG_VERSION,
      schema: LAPINET_CONFIG_SCHEMA,
    });
  }
}

const workspace = document.querySelector("#workspace");
const canvas = document.querySelector("#view");
const storage = globalThis.localStorage ?? null;
const config = createConfig(storage);
const diagnostics = new DiagnosticsRegistry();
let gpuRuntime = null;
const gpuReady = GpuContext.create().then((gpu) => {
  gpuRuntime = gpu;
  return gpu;
});

let simulationRuntime = null;
let simulationError = null;
let simulationConfigUnsubscribe = null;
const simulationDiagnosticsIds = [];
let controlHotkeysBinding = null;
let rendererRuntime = null;
let rendererError = null;

function applyUiConfig() {
  document.documentElement.style.setProperty(
    "--fox-ui-font-size",
    config.get("ui.fontSize") + "px"
  );
  document.documentElement.style.setProperty(
    "--fox-slider-width",
    config.get("ui.sliderWidth") + "px"
  );
}

function persistConfig() {
  if (!storage) return false;
  try {
    storage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(config.snapshot()));
    return true;
  } catch (error) {
    console.warn("Lapinet config save failed", error);
    return false;
  }
}

applyUiConfig();
config.subscribe(() => applyUiConfig());

const displays = new DisplaySystem({
  workspace,
  config,
  storage,
  layoutStorageKey: LAYOUT_STORAGE_KEY,
  topRail: document.querySelector("#lapin-dock-top"),
  bottomRail: document.querySelector("#lapin-dock-bottom"),
});

displays.register({
  id: "config",
  title: "Config",
  position: [0.012, 0.01],
  width: 430,
  defaultVisible: true,
  mount(container) {
    mountConfigUI(container, {
      config,
      schema: config.schema,
      storage,
      storageKey: CONFIG_STORAGE_KEY,
    });
  },
});

displays.register({
  id: "displays",
  title: "Displays",
  position: [0.72, 0.02],
  width: 260,
  defaultVisible: true,
  mount(container) {
    mountDisplaysUI(container, {
      displays,
    });
  },
});

displays.register({
  id: "kernels",
  title: "Kernels",
  position: [0.68, 0.18],
  width: 360,
  defaultVisible: false,
  mount(container) {
    mountKernelDiagnosticsUI(container, {
      diagnostics,
    });
  },
});

displays.register({
  id: "render-targets",
  title: "Render Targets",
  position: [0.68, 0.38],
  width: 330,
  defaultVisible: false,
  mount(container) {
    mountRenderTargetDiagnosticsUI(container, {
      config,
    });
  },
});

displays.register({
  id: "connections",
  title: "Connections / Runtime",
  position: [0.42, 0.02],
  width: 340,
  defaultVisible: true,
  mount(container) {
    mountRuntimeConnectionsUI(container, {
      getRuntime() {
        return {
          simulation: simulationRuntime,
          simulationError,
          renderer: rendererRuntime,
          rendererError,
        };
      },
    });
  },
});

config.subscribe(() => persistConfig());

displays.start();
persistConfig();

function toggleDisplay(id) {
  const panel = displays.get(id);
  if (panel.visible) displays.hide(id);
  else displays.open(id);
}

document.addEventListener("keydown", (event) => {
  if (!event.shiftKey || !(event.metaKey || event.ctrlKey)) {
    return;
  }

  const key = event.key.toLowerCase();
  if (key === "d") {
    toggleDisplay("displays");
    event.preventDefault();
  } else if (key === "c") {
    toggleDisplay("config");
    event.preventDefault();
  }
});

async function startSimulation() {
  const gpu = await gpuReady;
  const runtime = await createScsSimulationRuntime({
    gpu,
    count: Math.floor(
      config.get("simulation.particles.count")
    ),
    playbackHz: config.get(
      "simulation.transport.playbackHz"
    ),
    transport: {
      seed: config.get("simulation.transport.seed"),
      threshold: config.get(
        "simulation.transport.threshold"
      ),
    },
    flock: {
      enabled: config.get("simulation.flock.enabled"),
      alignment: config.get("simulation.flock.alignment"),
      coupling: config.get("simulation.flock.coupling"),
      baseWeight: config.get("simulation.flock.baseWeight"),
      cohesion: config.get("simulation.flock.cohesion"),
      separation: config.get("simulation.flock.separation"),
      restDistance: config.get("simulation.flock.restDistance"),
      positionGain: config.get("simulation.flock.positionGain"),
    },
  });

  const provider = {
    kernelInfo() {
      const info = runtime.diagnostics.kernelInfo();
      return {
        ...info,
        active: runtime.running && !runtime.paused,
        detail:
          info.detail +
          " | transport frame " + runtime.transportFrame +
          " | " + runtime.direction +
          " | " + (runtime.running ? "running" : "stopped") +
          (runtime.paused ? " | paused" : ""),
      };
    },
  };
  diagnostics.registerKernelProvider(provider);
  simulationDiagnosticsIds.push(provider.kernelInfo().id);

  for (const extra of [
    runtime.transportDiagnostics,
    runtime.topologyDiagnostics,
    runtime.flockDiagnostics,
  ]) {
    if (!extra) continue;
    diagnostics.registerKernelProvider(extra);
    simulationDiagnosticsIds.push(extra.kernelInfo().id);
  }

  const syncSimulationTransport = () => {
    runtime.setPlaybackHz(
      config.get("simulation.transport.playbackHz")
    );
    runtime.setDirection(
      config.get("simulation.transport.direction")
    );
    runtime.setTransportParameters({
      seed: config.get("simulation.transport.seed"),
      threshold: config.get(
        "simulation.transport.threshold"
      ),
    });
    diagnostics.notify();
  };

  const syncSimulationFlock = () => {
    runtime.setFlockParameters({
      enabled: config.get("simulation.flock.enabled"),
      alignment: config.get("simulation.flock.alignment"),
      coupling: config.get("simulation.flock.coupling"),
      baseWeight: config.get("simulation.flock.baseWeight"),
      cohesion: config.get("simulation.flock.cohesion"),
      separation: config.get("simulation.flock.separation"),
      restDistance: config.get("simulation.flock.restDistance"),
      positionGain: config.get("simulation.flock.positionGain"),
    });
    diagnostics.notify();
  };

  const syncSimulationControl = () => {
    runtime.setPaused(
      config.get("simulation.control.paused")
    );
    if (config.get("simulation.control.enabled")) {
      runtime.start();
    } else {
      runtime.stop();
    }
    diagnostics.notify();
  };

  simulationConfigUnsubscribe = config.subscribe((event) => {
    if (
      event.path == null ||
      event.path.startsWith("simulation.control.")
    ) {
      syncSimulationControl();
    }
    if (
      event.path == null ||
      event.path.startsWith("simulation.transport.")
    ) {
      syncSimulationTransport();
    }
    if (
      event.path == null ||
      event.path.startsWith("simulation.flock.")
    ) {
      syncSimulationFlock();
    }
  });

  syncSimulationTransport();
  syncSimulationFlock();
  syncSimulationControl();
  simulationRuntime = runtime;
  return runtime;
}
async function startRenderer() {
  const gpu = await gpuReady;
  const surface = RenderSurface.create({
    gpu,
    canvas,
  });
  const focusPauseBinding = bindRenderFocusPause(
    surface,
    {
      document,
      window,
    }
  );
  const pointer = new PointerState();
  const camera = new PerspectiveCamera();
  const cameraController = new OrbitFlightCameraController({
    camera,
    mode: config.get("render.camera.mode"),
    moveSpeed: config.get("render.camera.moveSpeed"),
    lookSensitivity: config.get("render.camera.lookSensitivity"),
    boostMultiplier: config.get("render.camera.boostMultiplier"),
    onChange() {
      if (!surface.running && surface.passes.length > 0) {
        surface.renderOnce();
      }
    },
  });
  let cameraBinding = null;
  const gbuffer = new GBuffer(gpu.device);
  const frameCapture = new FrameCapturePublisher({
    canvas,
    surface,
    enabled: config.get("diagnostics.capture.enabled"),
    intervalMs: config.get("diagnostics.capture.intervalMs"),
    maxWidth: config.get("diagnostics.capture.maxWidth"),
  });
  const simulation = await simulationReady;
  // Primitive rendering is staged but deliberately not part of live startup
  // until each producer is WebGPU-validated in isolation.
  const primitiveSource = null;

  const [none, plane, fractal, comet, cursor] = await Promise.all([
    NoneField.create(),
    PlaneField.create({ device: gpu.device }),
    FractalField.create({ device: gpu.device }),
    CometField.create({ device: gpu.device }),
    GpuCursorPass.create({
      device: gpu.device,
      format: surface.format,
    }),
  ]);

  const fields = new Map([
    ["none", none],
    ["plane", plane],
    ["fractal", fractal],
    ["comet", comet],
  ]);

  const implicit = await ImplicitSurfacePass.create({
    device: gpu.device,
    gbuffer,
    camera,
    field: fields.get(config.get("render.implicit.field")),
  });
  const deferred = await DeferredLightingPass.create({
    device: gpu.device,
    format: surface.format,
    gbuffer,
    camera,
  });
  const primitiveLayer = null;
  const primitiveLayerError = new Error(
    "Primitive layer staged; live integration temporarily disabled"
  );
  const primitiveFailureProvider = {
    kernelInfo() {
      return {
        id: "primitive.layer.error",
        label: "Primitive layer staged",
        kind: "render",
        stage: "disabled",
        active: false,
        detail: primitiveLayerError.message,
      };
    },
  };

  const particleRecords = simulation?.resources.get(
    SCS_PARTICLE_RECORDS
  );
  const particleStableIds = simulation?.resources.get(
    SCS_PARTICLE_STABLE_IDS
  );
  const particleFlockState = simulation?.resources.get(
    SCHEDULED_FLOCK_STATE
  );
  const particleSpatialOrder = simulation?.resources.get(
    R4_SCS_RESOURCES.spatialOrder
  );
  const simulationParticles =
    particleRecords && particleStableIds && particleFlockState
      ? await SimulationParticlePass.create({
          device: gpu.device,
          format: surface.format,
          gbuffer,
          camera,
          records: particleRecords.resource,
          stableIds: particleStableIds.resource,
          flockState: particleFlockState.resource,
          count: particleRecords.metadata.count,
        })
      : null;
  const particleDebug =
    particleRecords &&
    particleSpatialOrder &&
    simulation?.trailHistory?.buffer
      ? await ParticleDebugPass.create({
          device: gpu.device,
          format: surface.format,
          gbuffer,
          camera,
          records: particleRecords.resource,
          spatialOrder: particleSpatialOrder.resource,
          trailHistory: simulation.trailHistory,
          count: particleRecords.metadata.count,
        })
      : null;

  const renderTargetDebug = await RenderTargetDebugPass.create({
    device: gpu.device,
    format: surface.format,
    gbuffer,
    camera,
  });

  for (const pass of [
    implicit,
    deferred,
    simulationParticles,
    particleDebug,
    renderTargetDebug,
    cursor,
  ]) {
    if (!pass) continue;
    diagnostics.registerKernelProvider(pass);
  }
  if (primitiveLayer) {
    for (const provider of primitiveLayer.kernelProviders()) {
      diagnostics.registerKernelProvider(provider);
    }
  } else if (primitiveFailureProvider) {
    diagnostics.registerKernelProvider(primitiveFailureProvider);
  }

  const pointerBinding = bindPointerSurface(
    canvas,
    pointer,
    {
      isGpuCursorEnabled: () =>
        config.get("render.cursor.reticule") &&
        surface.running,
    }
  );

  const syncCamera = () => {
    cameraController.setMoveSpeed(
      config.get("render.camera.moveSpeed")
    );
    cameraController.setLookSensitivity(
      config.get("render.camera.lookSensitivity")
    );
    cameraController.setBoostMultiplier(
      config.get("render.camera.boostMultiplier")
    );
    cameraController.setMode(
      config.get("render.camera.mode")
    );
    diagnostics.notify();
  };

  const syncCursor = () => {
    const snapshot = pointer.snapshot();
    cursor.update({
      pointer: snapshot.screen,
      active: snapshot.active,
      enabled: config.get("render.cursor.reticule"),
      size: config.get("render.cursor.size"),
      color: config.get("render.cursor.color"),
      opacity: config.get("render.cursor.opacity"),
      viewport: surface.size(),
    });
    pointerBinding.refreshCursorOwnership();
    diagnostics.notify();
  };

  const syncImplicit = () => {
    const selected = fields.get(config.get("render.implicit.field"));
    if (selected && implicit.field !== selected) {
      implicit.setField(selected);
    }

    implicit.renderScale = config.get("render.implicit.renderScale");
    implicit.maxSteps = config.get("render.implicit.maxSteps");
    implicit.hitEpsilon = config.get("render.implicit.hitEpsilon");
    implicit.hitDistanceScale =
      config.get("render.implicit.hitDistanceScale");
    implicit.normalEpsilon = config.get("render.implicit.normalEpsilon");
    implicit.normalDistanceScale = config.get("render.implicit.normalDistanceScale");
    implicit.maxStep = config.get("render.implicit.maxStep");
    implicit.material = {
      color: config.get("render.material.color"),
      roughness: config.get("render.material.roughness"),
      metallic: config.get("render.material.metallic"),
      transmission: config.get("render.material.transmission"),
      ior: config.get("render.material.ior"),
    };

    fractal.update({
      iterations: config.get("field.fractal.iterations"),
      safety: config.get("field.fractal.safety"),
      rotationScale: [
        32.5,
        5.29,
        14.13,
        config.get("field.fractal.scale"),
      ],
    });

    comet.update({
      iterations: config.get("field.comet.iterations"),
      safety: config.get("field.comet.safety"),
      positionScale: [
        0,
        0,
        0,
        config.get("field.comet.massScale"),
      ],
      field: [
        3.58,
        config.get("field.comet.amplitude"),
        config.get("field.comet.massOffset"),
        -1.19,
      ],
    });
    diagnostics.notify();
  };

  const syncDeferred = () => {
    deferred.updateSettings({
      reconstructionEnabled:
        config.get("render.reconstruction.enabled"),
      reconstructionDepthScale:
        config.get("render.reconstruction.depthScale"),
      reconstructionDepthMinimum:
        config.get("render.reconstruction.depthMinimum"),
      reconstructionDepthFalloff:
        config.get("render.reconstruction.depthFalloff"),
      reconstructionNormalPower:
        config.get("render.reconstruction.normalPower"),
      reconstructionNormalFloor:
        config.get("render.reconstruction.normalFloor"),
      keyDirection: [
        config.get("render.lighting.keyDirectionX"),
        config.get("render.lighting.keyDirectionY"),
        config.get("render.lighting.keyDirectionZ"),
      ],
      keyIntensity:
        config.get("render.lighting.keyIntensity"),
      keyColor:
        config.get("render.lighting.keyColor"),
      ambientIntensity:
        config.get("render.lighting.ambientIntensity"),
      ambientColor:
        config.get("render.lighting.ambientColor"),
      rimEnabled:
        config.get("render.shading.rimEnabled"),
      rimStrength:
        config.get("render.shading.rimStrength"),
      rimPower:
        config.get("render.shading.rimPower"),
      rimColor:
        config.get("render.shading.rimColor"),
      curvatureEnabled:
        config.get("render.shading.curvatureEnabled"),
      curvatureWeight:
        config.get("render.shading.curvatureWeight"),
      curvatureMinimum:
        config.get("render.shading.curvatureMinimum"),
      curvatureMaximum:
        config.get("render.shading.curvatureMaximum"),
      ambientOcclusionEnabled:
        config.get("render.shading.ambientOcclusionEnabled"),
      ambientOcclusionStrength:
        config.get("render.shading.ambientOcclusionStrength"),
      ambientOcclusionBias:
        config.get("render.shading.ambientOcclusionBias"),
      ambientOcclusionRange:
        config.get("render.shading.ambientOcclusionRange"),
      ambientMetallicAttenuation:
        config.get("render.shading.ambientMetallicAttenuation"),
      ambientTransmissionAttenuation:
        config.get("render.shading.ambientTransmissionAttenuation"),
      rimMetallicAttenuation:
        config.get("render.shading.rimMetallicAttenuation"),
      ambientOcclusionBendScale:
        config.get("render.shading.ambientOcclusionBendScale"),
      hazeEnabled:
        config.get("render.haze.enabled"),
      hazeDensity:
        config.get("render.haze.density"),
      hazeColor:
        config.get("render.haze.color"),
      hazeMaxOpacity:
        config.get("render.haze.maxOpacity"),
      brightness:
        config.get("render.tone.brightness"),
      contrast:
        config.get("render.tone.contrast"),
      exposure:
        config.get("render.tone.exposure"),
      gamma:
        config.get("render.tone.gamma"),
    });
    diagnostics.notify();
  };

  const syncParticles = () => {
    if (!simulationParticles) return;
    simulationParticles.enabled = config.get("render.particles.enabled");
    simulationParticles.radius = config.get("render.particles.radius");
    simulationParticles.positionScale = config.get("render.particles.positionScale");
    simulationParticles.opacity = config.get("render.particles.opacity");
    simulationParticles.occludeByImplicit = config.get("render.particles.occludeByImplicit");
    simulationParticles.flockEnabled = config.get("simulation.flock.enabled");
    simulationParticles.flockBaseWeight = config.get("simulation.flock.baseWeight");
    simulationParticles.directionalStretch = config.get(
      "render.particles.directionalStretch"
    );

    if (particleDebug) {
      particleDebug.trailsEnabled = config.get(
        "render.particles.trailsEnabled"
      );
      particleDebug.trailLength = config.get(
        "render.particles.trailLength"
      );
      particleDebug.trailStride = config.get(
        "render.particles.trailStride"
      );
      particleDebug.trailOpacity = config.get(
        "render.particles.trailOpacity"
      );
      particleDebug.neighborEdgesEnabled = config.get(
        "render.particles.neighborEdgesEnabled"
      );
      particleDebug.edgeFan = config.get(
        "render.particles.neighborFan"
      );
      particleDebug.edgeStride = config.get(
        "render.particles.neighborStride"
      );
      particleDebug.edgeOpacity = config.get(
        "render.particles.neighborOpacity"
      );
      particleDebug.positionScale = config.get(
        "render.particles.positionScale"
      );
      particleDebug.occludeByImplicit = config.get(
        "render.particles.occludeByImplicit"
      );
    }
    diagnostics.notify();
  };

  const syncPrimitives = () => {
    if (!primitiveLayer) {
      diagnostics.notify();
      return;
    }

    primitiveLayer.setEnabled(
      "primitive.splats",
      config.get("render.primitives.splats")
    );
    primitiveLayer.setEnabled(
      "primitive.lines",
      config.get("render.primitives.lines")
    );
    primitiveLayer.setEnabled(
      "primitive.thick-lines",
      config.get("render.primitives.thickLines")
    );
    primitiveLayer.setEnabled(
      "primitive.sdf-splats",
      config.get("render.primitives.sdfSplats")
    );
    primitiveLayer.setEnabled(
      "primitive.polygons",
      config.get("render.primitives.polygons")
    );
    primitiveLayer.opacity =
      config.get("render.primitives.opacity");
    primitiveLayer.splatScale =
      config.get("render.primitives.splatScale");
    primitiveLayer.thickLineScale =
      config.get("render.primitives.thickLineScale");
    diagnostics.notify();
  };

  const syncRenderTarget = () => {
    renderTargetDebug.setTarget(
      config.get("diagnostics.renderTarget")
    );
    diagnostics.notify();
  };

  const syncCapture = () => {
    frameCapture.setIntervalMs(
      config.get("diagnostics.capture.intervalMs")
    );
    frameCapture.setMaxWidth(
      config.get("diagnostics.capture.maxWidth")
    );
    frameCapture.setEnabled(
      config.get("diagnostics.capture.enabled")
    );
  };

  const syncRenderControl = () => {
    surface.setPaused(
      config.get("render.control.paused")
    );
    pointerBinding.refreshCursorOwnership();
  };

  const unsubscribePointer = pointer.subscribe(syncCursor);
  const unsubscribeConfig = config.subscribe((event) => {
    if (
      event.path == null ||
      event.path.startsWith("render.cursor.")
    ) {
      syncCursor();
    }

    if (
      event.path == null ||
      event.path.startsWith("render.camera.")
    ) {
      syncCamera();
    }

    if (
      event.path == null ||
      event.path.startsWith("render.implicit.") ||
      event.path.startsWith("render.material.") ||
      event.path.startsWith("field.")
    ) {
      syncImplicit();
    }

    if (
      event.path == null ||
      event.path.startsWith("render.reconstruction.") ||
      event.path.startsWith("render.lighting.") ||
      event.path.startsWith("render.shading.") ||
      event.path.startsWith("render.haze.") ||
      event.path.startsWith("render.tone.")
    ) {
      syncDeferred();
    }

    if (
      event.path == null ||
      event.path.startsWith("render.particles.") ||
      event.path.startsWith("simulation.flock.")
    ) {
      syncParticles();
    }

    if (
      event.path == null ||
      event.path.startsWith("render.primitives.")
    ) {
      syncPrimitives();
    }

    if (
      event.path == null ||
      event.path === "diagnostics.renderTarget"
    ) {
      syncRenderTarget();
    }

    if (
      event.path == null ||
      event.path.startsWith("diagnostics.capture.")
    ) {
      syncCapture();
    }

    if (
      event.path == null ||
      event.path === "render.control.paused"
    ) {
      syncRenderControl();
    }
  });
  const unsubscribeSurface = surface.subscribe((event) => {
    if (event.type === "resize") {
      syncCursor();
    } else if (
      event.type === "render-state" ||
      event.type === "pause"
    ) {
      pointerBinding.refreshCursorOwnership();
    }
  });

  surface.resize();
  syncCamera();
  syncCursor();
  syncImplicit();
  syncDeferred();
  syncParticles();
  syncPrimitives();
  syncRenderTarget();
  syncCapture();
  syncRenderControl();

  surface.addPass(implicit);
  surface.addPass(deferred);
  if (primitiveLayer) {
    surface.addPass(primitiveLayer);
  }
  if (simulationParticles) {
    surface.addPass(simulationParticles);
  }
  if (particleDebug) {
    surface.addPass(particleDebug);
  }
  surface.addPass(renderTargetDebug);
  surface.addPass(cursor);
  surface.start();
  const resolveOrbitSurfaceTarget = async () => {
    if (gbuffer.width <= 0 || gbuffer.height <= 0) {
      return null;
    }

    const px = Math.floor(gbuffer.width * 0.5);
    const py = Math.floor(gbuffer.height * 0.5);
    const depth = await gbuffer.readDepthAt(px, py);
    const snapshot = camera.snapshot();

    if (
      !Number.isFinite(depth) ||
      !(depth > 0) ||
      depth >= snapshot.far * 0.999
    ) {
      return null;
    }

    const uvX = (px + 0.5) / gbuffer.width * 2 - 1;
    const uvY = -((py + 0.5) / gbuffer.height * 2 - 1);
    const aspect = gbuffer.width / gbuffer.height;
    const tanHalfFov = Math.tan(snapshot.fovY * 0.5);
    const ray = snapshot.forward.map(
      (value, axis) =>
        value +
        snapshot.right[axis] * (uvX * aspect * tanHalfFov) +
        snapshot.up[axis] * (uvY * tanHalfFov)
    );
    const rayLength = Math.hypot(...ray);
    if (!(rayLength > 0)) return null;

    return snapshot.position.map(
      (value, axis) => value + ray[axis] / rayLength * depth
    );
  };

  cameraBinding = bindOrbitFlightCamera(
    canvas,
    cameraController,
    {
      document,
      window,
      onModeChange(mode) {
        config.set("render.camera.mode", mode);
        pointerBinding.refreshCursorOwnership();
      },
      resolveOrbitTarget: resolveOrbitSurfaceTarget,
    }
  );
  frameCapture.start();

  rendererRuntime = Object.freeze({
    gpu,
    surface,
    pointer,
    camera,
    cameraController,
    gbuffer,
    fields,
    implicit,
    deferred,
    simulationParticles,
    particleDebug,
    renderTargetDebug,
    cursor,
    frameCapture,
    destroy() {
      surface.stop();
      unsubscribePointer();
      unsubscribeConfig();
      unsubscribeSurface();
      focusPauseBinding.destroy();
      cameraBinding?.destroy();
      pointerBinding.destroy();
      frameCapture.destroy();
      for (const id of [
        "implicit.surface",
        "deferred.lighting",
        "diagnostics.render-target",
        "primitive.splats",
        "primitive.lines",
        "primitive.thick-lines",
        "primitive.sdf-splats",
        "primitive.polygons",
        "primitive.layer.error",
        "simulation.particles.render",
        "cursor.overlay",
      ]) {
        diagnostics.unregisterKernel(id);
      }
      cursor.destroy();
      renderTargetDebug.destroy();
      simulationParticles?.destroy();
      primitiveLayer?.destroy();
      primitiveSource?.destroy();
      deferred.destroy();
      implicit.destroy();
      gbuffer.destroy();
      for (const field of fields.values()) {
        field.destroy?.();
      }
    },
  });

  return rendererRuntime;
}

function showRendererError(error) {
  let panel = document.querySelector("#renderer-error");
  if (!panel) {
    panel = document.createElement("pre");
    panel.id = "renderer-error";
    panel.className = "renderer-error";
    workspace.append(panel);
  }
  panel.textContent =
    "Renderer error\n" + String(error?.stack ?? error);
}

controlHotkeysBinding = bindControlHotkeys({
  document,
  onRenderPauseToggle() {
    config.set(
      "render.control.paused",
      !config.get("render.control.paused")
    );
  },
  onSimulationPauseToggle() {
    config.set(
      "simulation.control.paused",
      !config.get("simulation.control.paused")
    );
  },
  onSimulationRestart() {
    simulationRuntime?.reset();
    rendererRuntime?.surface.renderOnce();
    diagnostics.notify();
  },
});

const simulationReady = startSimulation().catch((error) => {
  simulationError = error;
  console.warn("Lapinet simulation unavailable", error);
  const failureProvider = {
    kernelInfo() {
      return {
        id: "simulation.r4-scs.error",
        label: "R4 Scan-Curve-Spectrum",
        kind: "compute",
        stage: "simulation",
        active: false,
        detail: String(error?.message ?? error),
      };
    },
  };
  diagnostics.registerKernelProvider(failureProvider);
  simulationDiagnosticsIds.push(failureProvider.kernelInfo().id);
  diagnostics.notify();
  return null;
});

const rendererReady = startRenderer().catch((error) => {
  rendererError = error;
  canvas.classList.remove("lapinet-gpu-cursor-active");
  console.warn("Lapinet renderer unavailable", error);
  showRendererError(error);
  return null;
});

globalThis.__lapinet = Object.freeze({
  config,
  displays,
  gpuReady,
  simulationReady,
  rendererReady,
  get simulation() {
    return simulationRuntime;
  },
  get simulationError() {
    return simulationError;
  },
  get renderer() {
    return rendererRuntime;
  },
  get rendererError() {
    return rendererError;
  },
  get frameCapture() {
    return rendererRuntime?.frameCapture ?? null;
  },
  captureFrame() {
    return rendererRuntime?.frameCapture?.capture() ?? Promise.resolve(false);
  },
  async destroy() {
    controlHotkeysBinding?.destroy();
    controlHotkeysBinding = null;
    rendererRuntime?.destroy();
    simulationConfigUnsubscribe?.();
    simulationConfigUnsubscribe = null;
    for (const id of simulationDiagnosticsIds.splice(0)) {
      diagnostics.unregisterKernel(id);
    }
    await simulationRuntime?.destroy();
    simulationRuntime = null;
    gpuRuntime?.destroy();
    gpuRuntime = null;
  },
});
