/* Independent EfficientDet worker: face setup, inference and failure are isolated. */
let detector = null;
self.onmessage = async ({ data }) => {
  if (data.type === 'INIT') {
    try {
      const { ObjectDetector, FilesetResolver } = await import(data.asset_urls['vision_bundle.mjs']);
      const files = await FilesetResolver.forVisionTasks('');
      const loader = String(files.wasmLoaderPath).split('/').pop();
      const binary = String(files.wasmBinaryPath).split('/').pop();
      files.wasmLoaderPath = data.asset_urls['wasm/' + loader];
      files.wasmBinaryPath = data.asset_urls['wasm/' + binary];
      if (!files.wasmLoaderPath || !files.wasmBinaryPath) throw Error('Verified WASM files are incomplete');
      const modelBytes = new Uint8Array(await (await fetch(data.asset_urls['person.tflite'])).arrayBuffer());
      detector = await ObjectDetector.createFromOptions(files, { baseOptions: { modelAssetBuffer: modelBytes, delegate: 'CPU' },
        runningMode: 'VIDEO', categoryAllowlist: ['person'], scoreThreshold: .01, maxResults: 20 });
      postMessage({ type: 'READY', stage: 'body' });
    } catch (error) { detector?.close(); detector = null; postMessage({ type: 'ERROR', stage: 'body', error: String(error?.message || error) }); }
    return;
  }
  if (data.type !== 'FRAME') return;
  const bitmap = data.frame;
  try {
    if (!detector) throw Error('Body detector is unavailable');
    const result = detector.detectForVideo(bitmap, data.at);
    const boxes = (result.detections || []).filter(d => d.boundingBox && (d.categories || []).some(c => c.categoryName === 'person' && c.score >= data.confidence))
      .map(d => { const b = d.boundingBox; return [b.originX / bitmap.width, b.originY / bitmap.height,
        (b.originX + b.width) / bitmap.width, (b.originY + b.height) / bitmap.height]; });
    postMessage({ type: 'OBSERVATION', stage: 'body', at: data.at, result: { ok: true, boxes: boxes.slice(0, 20), saturated: boxes.length >= 20 }, context: data.context });
  } catch (error) {
    postMessage({ type: 'OBSERVATION', stage: 'body', at: data.at, result: { ok: false, boxes: [], saturated: false }, context: data.context,
      error: String(error?.message || error) });
  } finally { bitmap.close(); }
};
