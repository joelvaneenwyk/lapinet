export async function runScheduledTransportCertificate({
  count = 256,
  steps = 4,
} = {}) {
  const device = window.__lapinet?.renderer?.gpu?.device;
  if (!device) throw new Error("Lapinet GPU device unavailable");

  const [
    fixtureModule,
    oracleModule,
    streamModule,
    schedulerModule,
  ] = await Promise.all([
    import("../src/systems/scs/fixture-particles.js"),
    import("../src/systems/scheduled-transport/noether/icosian-e8.mjs"),
    import("../src/systems/scheduled-transport/gpu-scheduled-e8-stream.js"),
    import("../src/systems/scheduled-transport/gpu-exact-site-scheduler.js"),
  ]);

  const fixture = fixtureModule.createScsFixtureData(count);
  const initial = new Uint32Array(fixture.records);
  const byteLength = initial.byteLength;

  const records = device.createBuffer({
    size: byteLength,
    usage:
      GPUBufferUsage.STORAGE |
      GPUBufferUsage.COPY_DST |
      GPUBufferUsage.COPY_SRC,
  });
  const stableIDs = device.createBuffer({
    size: fixture.stableIds.byteLength,
    usage:
      GPUBufferUsage.STORAGE |
      GPUBufferUsage.COPY_DST |
      GPUBufferUsage.COPY_SRC,
  });
  const topology = device.createBuffer({
    size: 16,
    usage:
      GPUBufferUsage.STORAGE |
      GPUBufferUsage.COPY_DST |
      GPUBufferUsage.COPY_SRC,
  });

  const readWords = async () => {
    const out = device.createBuffer({
      size: byteLength,
      usage:
        GPUBufferUsage.COPY_DST |
        GPUBufferUsage.MAP_READ,
    });
    const encoder = device.createCommandEncoder();
    encoder.copyBufferToBuffer(
      records, 0, out, 0, byteLength
    );
    device.queue.submit([encoder.finish()]);
    await out.mapAsync(GPUMapMode.READ);
    const copy = new Uint32Array(
      out.getMappedRange().slice(0)
    );
    out.unmap();
    out.destroy();
    return copy;
  };

  const compare = (actual, expected) => {
    if (actual.length !== expected.length) return 0;
    for (let i = 0; i < actual.length; i += 1) {
      if (actual[i] !== expected[i]) return i + 1;
    }
    return -1;
  };

  device.queue.writeBuffer(records, 0, initial);
  device.queue.writeBuffer(
    stableIDs, 0, fixture.stableIds
  );
  device.queue.writeBuffer(
    topology, 0, new Uint32Array([0, 0, 0, 0])
  );

  const stream =
    await streamModule.GPUScheduledE8Stream.create(
      device
    );

  const streamStart = performance.now();
  for (let frame = 0; frame < steps; frame += 1) {
    const encoder = device.createCommandEncoder();
    stream.encode(encoder, {
      records,
      topology,
      count,
      frame,
      seed: 17,
      threshold: 3072,
      cellShift: 17,
    });
    device.queue.submit([encoder.finish()]);
    await device.queue.onSubmittedWorkDone();
  }
  const streamForwardMs =
    performance.now() - streamStart;

  const gpuForward = await readWords();
  const cpuForward = oracleModule.evolveE8Words(
    initial,
    steps,
    {
      start: 0,
      seed: 17,
      threshold: 3072,
    }
  );
  const streamOracleMismatch =
    compare(gpuForward, cpuForward);

  for (
    let frame = steps - 1;
    frame >= 0;
    frame -= 1
  ) {
    const encoder = device.createCommandEncoder();
    stream.encode(encoder, {
      records,
      topology,
      count,
      frame,
      reverse: true,
      seed: 17,
      threshold: 3072,
      cellShift: 17,
    });
    device.queue.submit([encoder.finish()]);
    await device.queue.onSubmittedWorkDone();
  }
  const streamRewindMismatch =
    compare(await readWords(), initial);

  device.queue.writeBuffer(records, 0, initial);

  const scheduler =
    await schedulerModule.GPUExactSiteScheduler.create(
      device
    );

  const fullForwardStart = performance.now();
  for (let frame = 0; frame < steps; frame += 1) {
    const encoder = device.createCommandEncoder();
    scheduler.encode(encoder, {
      records,
      stableIDs,
      count,
      frame,
      applyCollisions: true,
    });
    stream.encode(encoder, {
      records,
      topology,
      count,
      frame,
      seed: 17,
      threshold: 3072,
      cellShift: 17,
    });
    device.queue.submit([encoder.finish()]);
    await device.queue.onSubmittedWorkDone();
  }
  const fullForwardMs =
    performance.now() - fullForwardStart;

  const fullReverseStart = performance.now();
  for (
    let frame = steps - 1;
    frame >= 0;
    frame -= 1
  ) {
    const encoder = device.createCommandEncoder();
    stream.encode(encoder, {
      records,
      topology,
      count,
      frame,
      reverse: true,
      seed: 17,
      threshold: 3072,
      cellShift: 17,
    });
    scheduler.encode(encoder, {
      records,
      stableIDs,
      count,
      frame,
      applyCollisions: true,
    });
    device.queue.submit([encoder.finish()]);
    await device.queue.onSubmittedWorkDone();
  }
  const fullReverseMs =
    performance.now() - fullReverseStart;

  const fullRewindMismatch =
    compare(await readWords(), initial);

  scheduler.destroy();
  stream.destroy();
  records.destroy();
  stableIDs.destroy();
  topology.destroy();

  return {
    count,
    steps,
    streamOracleMismatch,
    streamRewindMismatch,
    fullRewindMismatch,
    streamForwardMs,
    fullForwardMs,
    fullReverseMs,
    streamCpuOraclePass:
      streamOracleMismatch === -1,
    streamExactRewindPass:
      streamRewindMismatch === -1,
    fullExactRewindPass:
      fullRewindMismatch === -1,
  };
}
