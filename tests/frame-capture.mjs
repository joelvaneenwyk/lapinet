import assert from "node:assert/strict";
import test from "node:test";

import {
  FrameCapturePublisher,
} from "../src/diagnostics/frame-capture.js";

function makeCaptureHarness({
  frameIndex = 7,
  width = 1280,
  height = 720,
} = {}) {
  const uploads = [];
  const drawCalls = [];
  const outputCanvases = [];

  const sourceCanvas = {
    width,
    height,
  };

  const document = {
    createElement(tagName) {
      assert.equal(tagName, "canvas");
      const canvas = {
        width: 0,
        height: 0,
        getContext(kind) {
          assert.equal(kind, "2d");
          return {
            drawImage(...args) {
              drawCalls.push(args);
            },
          };
        },
        toBlob(callback) {
          callback(new Blob(["png"], { type: "image/png" }));
        },
      };
      outputCanvases.push(canvas);
      return canvas;
    },
  };

  const fetchImpl = async (url, options) => {
    uploads.push({ url, options });
    return { ok: true, status: 200 };
  };

  const surface = { frameIndex };
  const capture = new FrameCapturePublisher({
    canvas: sourceCanvas,
    surface,
    endpoint: "http://127.0.0.1:1352/capture",
    intervalMs: 2000,
    maxWidth: 640,
    fetchImpl,
    document,
  });

  return {
    capture,
    surface,
    uploads,
    drawCalls,
    outputCanvases,
  };
}

test("frame capture downscales and uploads frame metadata", async () => {
  const harness = makeCaptureHarness();

  const result = await harness.capture.capture();

  assert.deepEqual(result, {
    frame: 7,
    width: 640,
    height: 360,
    capturedAt: result.capturedAt,
  });
  assert.equal(harness.outputCanvases[0].width, 640);
  assert.equal(harness.outputCanvases[0].height, 360);
  assert.equal(harness.drawCalls.length, 1);
  assert.equal(harness.uploads.length, 1);
  assert.equal(
    harness.uploads[0].options.headers["X-Lapinet-Frame"],
    "7"
  );
  assert.equal(
    harness.uploads[0].options.headers["X-Lapinet-Width"],
    "640"
  );
  assert.equal(
    harness.uploads[0].options.headers["X-Lapinet-Height"],
    "360"
  );
  assert.equal(harness.capture.lastPublishedFrame, 7);
});

test("automatic capture only republishes changed frames", async () => {
  const harness = makeCaptureHarness({ frameIndex: 3 });

  assert.ok(await harness.capture.captureIfChanged());
  assert.equal(harness.uploads.length, 1);

  assert.equal(await harness.capture.captureIfChanged(), false);
  assert.equal(harness.uploads.length, 1);

  harness.surface.frameIndex = 4;
  assert.ok(await harness.capture.captureIfChanged());
  assert.equal(harness.uploads.length, 2);
});

test("capture errors are observable and do not throw into renderer", async () => {
  const harness = makeCaptureHarness();
  harness.capture.fetchImpl = async () => ({
    ok: false,
    status: 503,
  });

  assert.equal(await harness.capture.capture(), false);
  assert.match(
    harness.capture.state().lastError,
    /503/
  );
});
