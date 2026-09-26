/* Independent face/attention worker: body setup, inference and failure are isolated. */
let face = null;
self.onmessage = async ({ data }) => {
  if (data.type === 'INIT') {
    try {
      const { FaceLandmarker, FilesetResolver } = await import(data.asset_urls['vision_bundle.mjs']);
      const files = await FilesetResolver.forVisionTasks('');
      const loader = String(files.wasmLoaderPath).split('/').pop();
      const binary = String(files.wasmBinaryPath).split('/').pop();
      files.wasmLoaderPath = data.asset_urls['wasm/' + loader];
      files.wasmBinaryPath = data.asset_urls['wasm/' + binary];
      if (!files.wasmLoaderPath || !files.wasmBinaryPath) throw Error('Verified WASM files are incomplete');
      const modelBytes = new Uint8Array(await (await fetch(data.asset_urls['face.task'])).arrayBuffer());
      face = await FaceLandmarker.createFromOptions(files, { baseOptions: { modelAssetBuffer: modelBytes, delegate: 'CPU' },
        runningMode: 'VIDEO', numFaces: 5, outputFaceBlendshapes: true, outputFacialTransformationMatrixes: true });
      postMessage({ type: 'READY', stage: 'face' });
    } catch (error) { face?.close(); face = null; postMessage({ type: 'ERROR', stage: 'face', error: String(error?.message || error) }); }
    return;
  }
  if (data.type !== 'FRAME') return;
  const bitmap = data.frame;
  try {
    if (!face) throw Error('Face detector is unavailable');
    const result = face.detectForVideo(bitmap, data.at), calibrationOutput = { value: null };
    const faces = result.faceLandmarks.slice(0, 5).map((landmarks, i) => {
      const xs = landmarks.map(p => p.x), ys = landmarks.map(p => p.y);
      const box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
      const matrix = result.facialTransformationMatrixes?.[i]?.data;
      const categories = result.faceBlendshapes?.[i]?.categories || [];
      const score = name => categories.find(c => c.categoryName === name)?.score;
      const smileL = score('mouthSmileLeft'), smileR = score('mouthSmileRight');
      const blinkL = score('eyeBlinkLeft'), blinkR = score('eyeBlinkRight');
      const eyes = [[33, 133, 468], [263, 362, 473]];
      const eyePixels = Math.min(...eyes.map(([a, b]) => Math.abs(landmarks[a].x - landmarks[b].x) * bitmap.width));
      const valid = matrix && landmarks.length >= 478 && eyePixels >= 8 && (box[2] - box[0]) * bitmap.width >= 50
        && Number.isFinite(blinkL) && Number.isFinite(blinkR);
      let looking = null, distance_cm = null;
      if (valid) {
        const deg = 180 / Math.PI;
        const yaw = Math.atan2(-matrix[2], Math.hypot(matrix[0], matrix[1])) * deg;
        const cheekWidthPx=Math.abs(landmarks[454].x-landmarks[234].x)*bitmap.width/Math.max(Math.cos(yaw/deg),.5);
        distance_cm=14.5*(bitmap.width/(2*Math.tan((65/2)/deg)))/Math.max(cheekWidthPx,1);
        const pitch = Math.atan2(matrix[6], matrix[10]) * deg;
        const cheekMid = (landmarks[234].x + landmarks[454].x) / 2;
        const direction = landmarks[1].x >= cheekMid ? 1 : -1;
        const iris = eyes.reduce((sum, [a, b, c]) => sum + (landmarks[c].x - (landmarks[a].x + landmarks[b].x) / 2)
          / Math.max(Math.abs(landmarks[a].x - landmarks[b].x), 1e-6), 0) / 2;
        const gaze = direction * Math.abs(yaw) + .7 * 120 * iris;
        if (result.faceLandmarks.length === 1 && (blinkL + blinkR) / 2 < .55 && Number.isFinite(gaze) && Number.isFinite(pitch)) calibrationOutput.value = { yaw: gaze, pitch };
        const calibration = data.calibration || { yaw: 0, pitch: 0 };
        looking = (blinkL + blinkR) / 2 < .55 && Number.isFinite(gaze) && Number.isFinite(pitch)
          && Math.abs(gaze - calibration.yaw) < 22 && Math.abs(pitch - calibration.pitch) < 20;
      }
      return { box, looking, distance_cm, unavailable_reason: valid ? undefined : eyePixels < 8 || (box[2] - box[0]) * bitmap.width < 50 ? 'too_small' : 'unclear',
        smiling: valid && Number.isFinite(smileL) && Number.isFinite(smileR) ? (smileL + smileR) / 2 > .45 : null };
    });
    postMessage({ type: 'OBSERVATION', stage: 'face', at: data.at,
      result: { ok: true, faces, saturated: faces.length >= 5, calibration: calibrationOutput.value }, context: data.context });
  } catch (error) {
    postMessage({ type: 'OBSERVATION', stage: 'face', at: data.at, result: { ok: false, faces: [], saturated: false }, context: data.context,
      error: String(error?.message || error) });
  } finally { bitmap.close(); }
};
