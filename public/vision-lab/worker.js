/* Pinned MediaPipe requires importScripts for its WASM loader: use a classic worker. */
let face, person, initialized = false;
self.onmessage = async ({ data }) => {
  if (data.type === 'INIT') {
    try {
      const { FaceLandmarker, ObjectDetector, FilesetResolver } = await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/vision_bundle.mjs');
      const files = await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm');
      const faceBytes = new Uint8Array(await (await fetch('https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task')).arrayBuffer());
      face = await FaceLandmarker.createFromOptions(files, { baseOptions: { modelAssetBuffer: faceBytes, delegate: data.delegate }, runningMode: 'VIDEO', numFaces: 5, outputFaceBlendshapes: true, outputFacialTransformationMatrixes: true });
      const personBytes = new Uint8Array(await (await fetch('https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/int8/1/efficientdet_lite0.tflite')).arrayBuffer());
      person = await ObjectDetector.createFromOptions(files, { baseOptions: { modelAssetBuffer: personBytes, delegate: 'CPU' }, runningMode: 'VIDEO', categoryAllowlist: ['person'], scoreThreshold: .4, maxResults: 20 });
      initialized = true;
      postMessage({ type: 'READY', delegate: data.delegate, personDelegate: 'CPU' });
    } catch (error) { face?.close(); person?.close(); postMessage({ type: 'ERROR', error: String(error?.message || error) }); }
    return;
  }
  if (data.type !== 'FRAME') return;
  const bitmap = data.frame, started = performance.now(), observation = { at: data.at };
  try {
    if (!initialized) throw Error('Models are not ready');
    if (data.person) {
      try {
        const r = person.detectForVideo(bitmap, data.at);
        const boxes = (r.detections || []).filter(d => d.boundingBox).map(d => {
          const b = d.boundingBox;
          return [b.originX / bitmap.width, b.originY / bitmap.height, (b.originX + b.width) / bitmap.width, (b.originY + b.height) / bitmap.height];
        });
        observation.bodies = { ok: true, boxes, saturated: boxes.length >= 20 };
      } catch { observation.bodies = { ok: false, boxes: [], saturated: false }; }
    }
    if (data.face) {
      try {
        const r = face.detectForVideo(bitmap, data.at);
        const faces = r.faceLandmarks.map((lm, i) => {
          const xs = lm.map(p => p.x), ys = lm.map(p => p.y), box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
          const m = r.facialTransformationMatrixes?.[i]?.data;
          const categories = r.faceBlendshapes?.[i]?.categories || [];
          const coefficient = name => categories.find(c => c.categoryName === name)?.score;
          const smileL = coefficient('mouthSmileLeft'), smileR = coefficient('mouthSmileRight');
          const blinkL = coefficient('eyeBlinkLeft'), blinkR = coefficient('eyeBlinkRight');
          const eyes = [[33, 133, 468], [263, 362, 473]];
          const eyePixels = Math.min(...eyes.map(([a,b]) => Math.abs(lm[a].x - lm[b].x) * bitmap.width));
          const valid = m && lm.length >= 478 && eyePixels >= 8 && (box[2] - box[0]) * bitmap.width >= 50 && Number.isFinite(blinkL) && Number.isFinite(blinkR);
          let looking = null;
          if (valid) {
            const deg = 180 / Math.PI;
            const yaw = Math.atan2(-m[2], Math.hypot(m[0], m[1])) * deg;
            const pitch = Math.atan2(m[6], m[10]) * deg;
            const cheekMid = (lm[234].x + lm[454].x) / 2;
            const direction = lm[1].x >= cheekMid ? 1 : -1;
            const iris = eyes.reduce((sum,[a,b,c]) => sum + (lm[c].x - (lm[a].x + lm[b].x) / 2) / Math.max(Math.abs(lm[a].x - lm[b].x), 1e-6), 0) / 2;
            const gaze = direction * Math.abs(yaw) + .7 * 120 * iris;
            looking = (blinkL + blinkR) / 2 < .55 && Math.abs(gaze - data.calibration.yaw) < 22 && Math.abs(pitch - data.calibration.pitch) < 20;
          }
          return { box, looking, smiling: valid && Number.isFinite(smileL) && Number.isFinite(smileR) ? (smileL + smileR) / 2 > .45 : null };
        });
        observation.faces = { ok: true, faces, saturated: faces.length >= 5 };
      } catch { observation.faces = { ok: false, faces: [], saturated: false }; }
    }
    postMessage({ type: 'OBSERVATION', observation, durationMs: performance.now() - started });
  } catch (error) { postMessage({ type: 'FRAME_ERROR', error: String(error?.message || error), at: data.at }); }
  finally { bitmap.close(); }
};
