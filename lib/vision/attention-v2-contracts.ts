import { ATTENTION_PROFILE, ATTENTION_LIMITS, attentionQueuedEventBytes, validateAttentionSummary } from './attention-contracts';
import { PRESENCE_V2_PROFILE } from './presence-v2-profile';
import { summaryForAttentionMode } from './attention-summary';
import type { PlaySummary } from './metrics';

export function presenceV2Summary(summary: PlaySummary, playingMs: number, mode: 'default' | 'guided', revision: string | null) {
  const v1 = summaryForAttentionMode(summary, playingMs, mode, revision);
  return { ...v1, schema: 'attention-v2/1', profile: PRESENCE_V2_PROFILE.id };
}

export function validatePresenceV2Summary(value: any, playingMs: number, revision: string | null, mode: 'default' | 'guided') {
  if (!value || value.schema !== PRESENCE_V2_PROFILE.metric_schema || value.profile !== PRESENCE_V2_PROFILE.id) return false;
  const compatibilityView = { ...value, schema: 'attention-v1/1', profile: ATTENTION_PROFILE.id };
  return validateAttentionSummary(compatibilityView, playingMs, revision, mode);
}

export function preparePresenceV2Envelope(legacy: Record<string, unknown>, candidate: unknown, revision: string | null, mode: 'default' | 'guided') {
  if ('seq_no' in legacy || 'attention' in legacy) throw new Error('Analytics may only be attached to a new, unqueued delivery event');
  const base = JSON.parse(JSON.stringify(legacy)) as Record<string, unknown>;
  if (attentionQueuedEventBytes(base) > ATTENTION_LIMITS.event_bytes) throw new Error('Legacy evidence exceeds the queue limit');
  const summary = candidate as any;
  if (!validatePresenceV2Summary(summary, Number(base.playing_duration_ms), revision, mode)) return { event: base, outcome: 'invalid' as const };
  const event = { ...base, attention: JSON.parse(JSON.stringify(summary)) };
  if (attentionQueuedEventBytes(event) > ATTENTION_LIMITS.target_bytes) return { event: base, outcome: 'size_limit' as const };
  return { event, outcome: 'included' as const };
}
