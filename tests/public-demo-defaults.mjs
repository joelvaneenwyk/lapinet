import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../springs.html", import.meta.url), "utf8");
const viewer = readFileSync(
  new URL("../src/systems/reversible-springs/springs-view.js", import.meta.url),
  "utf8"
);

test("published coefficient defaults match the selected screenshot", () => {
  const defaults = {
    stiffness: "20",
    restScale: "91",
    contactRange: "210",
    alignment: "0",
    coupling: "0",
    perturb: "15",
    edgeOpacity: ".55"
  };
  for (const [id, value] of Object.entries(defaults)) {
    const expression = new RegExp(
      'id="' + id + '"[^>]*\\bvalue="' + value.replace(".", "\\.") + '"'
    );
    assert.match(html, expression, id + " should default to " + value);
  }
  assert.match(html, /<h1>Lapinet<\/h1>/);
  assert.doesNotMatch(html, /reversible connected particles/);
  assert.doesNotMatch(html, /Central integer forces · dynamic proximity contacts/);
});

test("flock demo applies the same coefficients and starts playback", () => {
  const start = viewer.indexOf("function activateFlockDemo()");
  const finish = viewer.indexOf("$('flockDemo').addEventListener", start);
  assert.ok(start >= 0 && finish > start);
  const body = viewer.slice(start, finish);
  const values = {
    stiffness: "20",
    restScale: "91",
    contactRange: "210",
    alignment: "0",
    coupling: "0",
    perturb: "15",
    edgeOpacity: ".55"
  };
  for (const [id, value] of Object.entries(values)) {
    assert.ok(body.includes("$('" + id + "').value='" + value + "'"),
      "Flock demo should set " + id + " to " + value);
  }
  assert.match(body, /reset\(\{autoplay:true\}\)/);
  assert.match(body, /\$\('connectivity'\)\.value='flock'/);
  assert.match(body, /\$\('cohesion'\)\.value='2'/);
  assert.match(body, /\$\('separation'\)\.value='6'/);
  assert.match(body, /\$\('steering'\)\.value='2'/);
});
