import { createHash } from 'node:crypto';

/**
 * Campaign drafts (doc 31 Phase 4). Drafts live in their own `campaign_drafts` collection and are never
 * campaigns: playback, inventory, settlement, budgets, reporting and bootstrap read `campaigns` only.
 * A draft holds no capacity, freezes no economics and authorizes nothing. Submit turns a draft into a body
 * for the unchanged POST /campaign path. This module is dependency-free so access, api and the Firestore
 * adapter can share it without import cycles.
 */
export const DRAFT_STEPS = ['basics', 'screens', 'creatives', 'budget', 'review'] as const;
export const DRAFT_FIELDS = ['name', 'starts_at', 'ends_at', 'dayparts', 'screen_ids', 'bookings', 'creative_ids', 'rate_type', 'rate_value', 'committed_budget'] as const;
export const DRAFT_TTL_DAYS = 30;
const DAY_MS = 86_400_000;

export const draftExpiry = (at: number) => new Date(at + DRAFT_TTL_DAYS * DAY_MS).toISOString();
/** An expired draft behaves as not found. No background job: reads and writes filter by this. */
export const draftExpired = (draft: any, now = Date.now()) => !draft?.expires_at || !(Date.parse(draft.expires_at) > now);
/** Creator-only, same organisation (platform admins may hold drafts for the organisation they scoped). */
export const draftVisibleTo = (draft: any, actor: any, now = Date.now()) => !!draft && !!actor && draft.created_by === actor.id
  && (actor.role === 'platform_admin' || draft.org_id === actor.org_id) && !draftExpired(draft, now);
/** Deterministic campaign id: a repeated submit of one draft can only ever address one campaign. */
export const draftCampaignId = (draftId: string) => 'cmp_' + createHash('sha256').update(JSON.stringify(['campaign_draft', draftId])).digest('hex').slice(0, 32);

const LABELS: Record<string, string> = {
  advertiser_id: 'advertiser', name: 'campaign name', starts_at: 'start date', ends_at: 'end date', screen_ids: 'screens',
  creative_ids: 'creatives', rate_type: 'rate type', rate_value: 'rate per play', committed_budget: 'committed budget',
};
/** Fields a draft must have before submit, in step order. Absent or null counts as missing; zero is a value. */
export function missingForSubmit(draft: any): string | null {
  const f = draft.fields || {};
  if (!draft.advertiser_id) return 'advertiser_id';
  for (const key of ['name', 'starts_at', 'ends_at']) if (typeof f[key] !== 'string' || !f[key].trim()) return key;
  if (!Array.isArray(f.screen_ids) || !f.screen_ids.length) return 'screen_ids';
  if (!Array.isArray(f.creative_ids) || !f.creative_ids.length) return 'creative_ids';
  if (!f.rate_type) return 'rate_type';
  if (f.rate_type === 'per_play' && typeof f.rate_value !== 'number') return 'rate_value';
  if (typeof f.committed_budget !== 'number') return 'committed_budget';
  return null;
}
export const missingMessage = (key: string) => `Add the ${LABELS[key] || key} before submitting (missing: ${key})`;

/**
 * The POST /campaign body for a complete draft. Only keys that route already accepts.
 * A flat-fee campaign has no per-play rate: it is sent as 0, the existing builder's convention for "not
 * applicable", never as a guess for an unknown per-play price (per-play drafts require an entered rate).
 */
export function draftCampaignBody(draft: any, status: 'pending' | 'active') {
  const f = draft.fields || {};
  return {
    org_id: draft.org_id, advertiser_id: draft.advertiser_id, campaign_type: draft.campaign_type, name: f.name.trim(),
    starts_at: f.starts_at, ends_at: f.ends_at, rate_type: f.rate_type, rate_value: f.rate_type === 'flat' ? (typeof f.rate_value === 'number' ? f.rate_value : 0) : f.rate_value,
    committed_budget: f.committed_budget, screen_ids: [...f.screen_ids], creative_ids: [...f.creative_ids], status,
    bookings: f.screen_ids.map((id: string) => {
      const b = (f.bookings || []).find((x: any) => x.screen_id === id);
      return { screen_id: id, rotation_weight: b?.rotation_weight ?? 1 };
    }),
    ...(Array.isArray(f.dayparts) && f.dayparts.length ? { dayparts: f.dayparts.map((w: any) => ({ from: w.from, to: w.to })) } : {}),
  };
}
