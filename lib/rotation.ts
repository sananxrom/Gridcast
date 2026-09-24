import crypto from 'crypto';

/** Stable per-screen phase spreads creative choices without promising an exact fleet split. */
export function creativeRotationIndex(screenId: string, rotationIndex: number, slotIndex: number, creativeCount: number): number {
  if (!Number.isSafeInteger(creativeCount) || creativeCount < 1) throw new Error('Rotation needs an eligible creative');
  const salt = crypto.createHash('sha256').update(screenId).digest().readUInt32BE(0);
  const phase = Number.isSafeInteger(rotationIndex) && rotationIndex >= 0 ? rotationIndex : 0;
  // Reduce before adding so even a large persisted phase cannot lose integer precision.
  return ((phase % creativeCount) + (salt % creativeCount) + (slotIndex % creativeCount)) % creativeCount;
}
