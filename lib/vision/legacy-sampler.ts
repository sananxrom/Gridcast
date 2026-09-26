import { frameSize } from '../player-vision';

/** Source-faithful local copy of the player collector's current defaults and filter. */
export const LEGACY_CV_PROFILE = Object.freeze({
  model: 'coco-ssd@2.2.3/lite_mobilenet_v2',
  modelUrl: '/models/coco-ssd/model.json',
  defaults: Object.freeze({ sample_interval_s: 2, confidence_min: 0.45, count_ceiling: 50, min_box_px: 24, inference_res: '640x480', detection_zone: Object.freeze({ x: 0, y: 0, w: 100, h: 100 }) }),
});

export type LegacySettings = {
  sample_interval_s: number;
  confidence_min: number;
  count_ceiling: number;
  min_box_px: number;
  inference_res: string;
  detection_zone: { x: number; y: number; w: number; h: number };
};
export type Prediction = { class?: string; score?: number; bbox?: number[] };
export type LegacyCount = { count: number; accepted: number; ceiling: number };
export type LegacyDetector = { detect(input: HTMLCanvasElement, maxBoxes: number, minScore: number): Promise<Prediction[]>; dispose?: () => void };

export function filterLegacyPredictions(all: Prediction[], width: number, height: number, sourceHeight: number, config: LegacySettings): LegacyCount {
  const confidence = Math.max(0, Math.min(1, Number(config.confidence_min ?? 0.45)));
  const ceiling = Math.max(1, Math.min(500, Math.floor(Number(config.count_ceiling) || 50)));
  const zone = config.detection_zone || { x: 0, y: 0, w: 100, h: 100 };
  const persons = all.filter(p => {
    if (!Array.isArray(p.bbox) || p.bbox.length < 4) return false;
    const [x, y, w, h] = p.bbox;
    const cx = (x + w / 2) / width * 100, cy = (y + h / 2) / height * 100;
    return p.class === 'person' && Number(p.score) >= confidence && h * sourceHeight / height >= Number(config.min_box_px ?? 24)
      && cx >= zone.x && cx <= zone.x + zone.w && cy >= zone.y && cy <= zone.y + zone.h;
  });
  return { count: Math.min(persons.length, ceiling), accepted: persons.length, ceiling };
}

export async function loadLegacyDetector(signal: AbortSignal, onProgress: (message: string) => void): Promise<LegacyDetector> {
  onProgress('Starting the existing COCO-SSD lite_mobilenet_v2 detector…');
  const tf = await import('@tensorflow/tfjs');
  await tf.ready();
  signal.throwIfAborted();
  const coco = await import('@tensorflow-models/coco-ssd');
  signal.throwIfAborted();
  const model = await coco.load({ base: 'lite_mobilenet_v2', modelUrl: LEGACY_CV_PROFILE.modelUrl });
  if (signal.aborted) { model.dispose(); signal.throwIfAborted(); }
  return model;
}

/** Capture and filter exactly as the player does; pixels are cleared even after a failure. */
export async function sampleLegacyFrame(video: HTMLVideoElement, detector: LegacyDetector, canvas: HTMLCanvasElement, config: LegacySettings): Promise<LegacyCount> {
  if (video.readyState < 2 || video.paused || video.ended || !video.videoWidth || !video.videoHeight) throw Error('Camera frame is not available');
  const sourceWidth = video.videoWidth, sourceHeight = video.videoHeight;
  const [width, height] = frameSize(sourceWidth, sourceHeight, config.inference_res);
  if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
  const context = canvas.getContext('2d');
  if (!context) throw Error('Camera frame unavailable');
  try {
    context.drawImage(video, 0, 0, width, height);
    const all = await detector.detect(canvas, Math.max(1, Math.min(500, Math.floor(Number(config.count_ceiling) || 50))), Math.max(0, Math.min(1, Number(config.confidence_min ?? 0.45))));
    return filterLegacyPredictions(all, width, height, sourceHeight, config);
  } finally {
    context.clearRect(0, 0, canvas.width, canvas.height);
  }
}
