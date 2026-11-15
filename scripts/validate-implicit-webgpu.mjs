const marker = "// __FIELD_MODULE__";

async function read(relative) {
  return Deno.readTextFile(
    new URL(relative, import.meta.url)
  );
}

async function main() {
  if (!navigator.gpu) {
    throw new Error("Deno WebGPU unavailable");
  }

  const adapter = await navigator.gpu.requestAdapter({
    powerPreference: "high-performance",
  });
  if (!adapter) throw new Error("No WebGPU adapter");
  const device = await adapter.requestDevice();

  const template = await read(
    "../src/render/implicit/implicit-surface.wgsl"
  );

  for (const field of [
    ["plane", "../src/fields/plane-field.wgsl"],
    ["fractal", "../src/fields/fractal-field.wgsl"],
    ["comet", "../src/fields/comet-field.wgsl"],
  ]) {
    const [name, relative] = field;
    const fieldSource = await read(relative);
    const code = template.replace(marker, fieldSource);
    const module = device.createShaderModule({
      label: "Lapinet implicit validation: " + name,
      code,
    });
    const info = await module.getCompilationInfo();
    const errors = info.messages.filter(
      (message) => message.type === "error"
    );
    if (errors.length) {
      throw new Error(
        name + " shader: " +
        errors.map((error) =>
          error.lineNum + ":" +
          error.linePos + " " +
          error.message
        ).join("; ")
      );
    }

    device.pushErrorScope("validation");
    await device.createComputePipelineAsync({
      label: "Lapinet implicit validation: " + name,
      layout: "auto",
      compute: {
        module,
        entryPoint: "implicitSurfaceMain",
      },
    });
    const error = await device.popErrorScope();
    if (error) {
      throw new Error(
        name + " pipeline: " + error.message
      );
    }
  }

  console.log(
    "Implicit WebGPU validation PASS: plane, fractal, comet"
  );
  device.destroy();
}

await main();
Deno.exit(0);
