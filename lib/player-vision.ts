// Browser capture helpers. These do not change the locked detector or sampling policy.
export function captureSize(resolution: unknown) {
  const sizes: Record<string, [number, number]> = { '320x240': [320, 240], '640x480': [640, 480], '1280x720': [1280, 720] };
  return sizes[String(resolution)] || sizes['640x480'];
}
export function frameSize(width: number, height: number, resolution: unknown) {
  const [maxWidth, maxHeight] = captureSize(resolution);
  const scale = Math.min(1, maxWidth / width, maxHeight / height);
  return [Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale))];
}
export function cameraConstraints(config: Record<string, any>): MediaStreamConstraints {
  const [width, height] = captureSize(config.inference_res);
  return { audio: false, video: { width: { ideal: width }, height: { ideal: height }, frameRate: { ideal: 15 },
    ...(config.camera_device_id ? { deviceId: { exact: config.camera_device_id } } : {}) } };
}
export function cameraError(error: unknown, stage: 'camera' | 'model') {
  const name = (error as { name?: string })?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Camera permission blocked. Allow camera access in this browser, then retry.';
  if (name === 'NotFoundError') return 'No camera found. Connect a camera, then retry.';
  if (name === 'NotReadableError') return 'Camera is busy or unavailable. Close other camera apps, then retry.';
  if (name === 'OverconstrainedError') return 'The configured camera is unavailable. Check the screen’s camera setting, then retry.';
  return stage === 'model' ? 'People detector could not load. Check the connection, then retry.' : 'Camera could not start. Check browser permissions, then retry.';
}
