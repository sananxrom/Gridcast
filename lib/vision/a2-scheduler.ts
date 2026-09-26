/** Rejects asynchronous work that belongs to a trial superseded by stop/restart. */
export function isCurrentA2Generation(current: number, captured: number) {
  return Number.isSafeInteger(current) && Number.isSafeInteger(captured) && current === captured;
}

export type A2CaptureBoundary = { generation: number; segment: number | null; stream: unknown; cameraLive: boolean; playing: boolean; visible: boolean; phase: string; mode: string | null };
export function acceptsA2CaptureResult(captured: A2CaptureBoundary, current: A2CaptureBoundary) {
  return isCurrentA2Generation(current.generation, captured.generation)
    && captured.segment !== null && current.segment === captured.segment && current.stream === captured.stream && captured.cameraLive && current.cameraLive
    && current.playing && current.visible && current.phase === 'running' && current.mode === captured.mode;
}

/**
 * Mirrors app/player/page.tsx's 250 ms wall-clock ticker: legacy work is due only
 * when elapsed time is strictly greater than the interval, and every due ticker
 * consumes the opportunity even if playback is paused or inference is in flight.
 * Attention may use requestAnimationFrame but yields before the next legacy slot.
 */
export class LegacyPriorityScheduler {
  readonly intervalMs: number;
  readonly attentionLeadMs: number;
  private lastDetectAt: number;
  private hasPolledLegacy = false;

  constructor(intervalMs: number, lastDetectAt = 0, attentionLeadMs = 300) {
    this.intervalMs = Math.max(500, intervalMs);
    this.attentionLeadMs = Math.max(0, attentionLeadMs);
    this.lastDetectAt = lastDetectAt;
  }

  pollLegacy(now: number, playing: boolean, legacyInFlight: boolean) {
    if (now - this.lastDetectAt <= this.intervalMs) return { legacy: false, legacySkipped: null as 'paused' | 'in_flight' | null };
    this.lastDetectAt = now;
    this.hasPolledLegacy = true;
    if (!playing) return { legacy: false, legacySkipped: 'paused' as const };
    if (legacyInFlight) return { legacy: false, legacySkipped: 'in_flight' as const };
    return { legacy: true, legacySkipped: null };
  }

  attentionAllowed(now: number, playing: boolean, legacyInFlight: boolean) {
    if (!this.hasPolledLegacy || !playing || legacyInFlight) return false;
    return now + this.attentionLeadMs < this.lastDetectAt + this.intervalMs;
  }

  get nextLegacyDeadline() {
    return this.lastDetectAt + this.intervalMs;
  }

}

/** Read-only total: an open stall is included without mutating stored intervals. */
export function playbackStallTotal(accumulatedMs: number, stallStartedAt: number | null, now: number) {
  return Math.max(0, accumulatedMs) + (stallStartedAt === null ? 0 : Math.max(0, now - stallStartedAt));
}

export function summarize(values: number[]) {
  if (!values.length) return { count: 0, median: null as number | null, p95: null as number | null };
  const ordered = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
  if (!ordered.length) return { count: 0, median: null, p95: null };
  return { count: ordered.length, median: ordered[Math.floor((ordered.length - 1) * 0.5)], p95: ordered[Math.ceil(ordered.length * 0.95) - 1] };
}

export function boundedPush(values: number[], value: number, limit = 512) {
  if (!Number.isFinite(value)) return;
  values.push(value);
  if (values.length > limit) values.splice(0, values.length - limit);
}

/** Installs only the existing scoped isolation worker; it does not download model assets. */
export async function ensureA2IsolationScope(signal: AbortSignal) {
  if (!navigator.serviceWorker || !window.isSecureContext) throw Error('This browser cannot provide the local evaluation isolation check.');
  const registration = await navigator.serviceWorker.register('/vision-lab/sw.js', { scope: '/vision-lab/' });
  const deadline = Date.now() + 30000;
  while (!registration.active || !navigator.serviceWorker.controller?.scriptURL.endsWith('/vision-lab/sw.js')) {
    signal.throwIfAborted();
    if (Date.now() > deadline) throw Error('The local isolation worker did not activate. Reload the page, then try again.');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}
