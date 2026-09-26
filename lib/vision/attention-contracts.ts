/** Production Attention V1 evidence contract. These fields are analytics-only and have no billing authority. */
export const ATTENTION_PROFILE = Object.freeze({
  id: 'attention-v1/mediapipe-1.0.1',
  manifest_sha256: '43e32807c30b4ad5e6d11148e8284ef2f9e9889832e2dc38f6899628e97fd8a5',
  worker_url: '/vision-lab/worker-attention-v1.js', worker_sha256: 'dc52b9e4d8f5839f933f508ad687ab03a4c7381f6aea6df228efaad0f1e10a0b',
  pipeline_sha256: '6aee3da6c8c1027d91885f5ccc4f7564bab3f21d8826a8baad4f5d02b526222f',
  runtime: 'mediapipe-tasks-vision@1.0.1', body: 'efficientdet-lite0-int8/1', face: 'face-landmarker-float16/1',
  body_delegate: 'CPU', face_delegate: 'CPU', max_bodies: 20, max_faces: 5,
  legacy_source: 'coco-ssd@2.2.3/lite_mobilenet_v2',
} as const);
export const ATTENTION_LIMITS = Object.freeze({ event_bytes: 4096, target_bytes: 3584, playing_ms: 3601000, visits: 1000000 });
/** Observed + unknown = playing time. Saturation is a subset of observed, not an extra interval. */
type Coverage = [observed_ms: number, unknown_ms: number];
type DetectorCoverage = [observed_ms: number, unknown_ms: number, saturated_ms: number];
export type AttentionSummary = {
  schema: 'attention-v1/1'; profile: typeof ATTENTION_PROFILE.id; attention_mode?: 'default' | 'guided'; calibration_revision: string | null;
  playing_ms: number; body: DetectorCoverage; face: DetectorCoverage; attention: Coverage; expression: Coverage;
  presence_person_ms: number | null; looking_person_ms: number | null; smile_person_ms: number | null;
  face_assessable_person_ms: number | null; expression_assessable_person_ms: number | null;
  estimated_impressions: number | null; attentive_impressions: number | null;
  tracked_visits: number | null; right_censored_visits: number | null; longest_look_ms: number | null;
};
export type AttentionCalibration = {
  schema: 'calibration-v1/1'; profile: typeof ATTENTION_PROFILE.id; revision: string;
  device_id: string; screen_id: string; camera_ref: string;
  width: number; height: number; rotation: 0 | 90 | 180 | 270;
  method: 'guided-3s'; yaw_tenths: number; pitch_tenths: number;
  samples: number; span_ms: number; yaw_spread_tenths: number; pitch_spread_tenths: number;
  completed_at: string;
};
export type CalibrationBinding = Pick<AttentionCalibration, 'profile' | 'device_id' | 'screen_id' | 'camera_ref' | 'width' | 'height' | 'rotation'>;
const fields = (value: any, names: string[]) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === names.length && names.every(k => Object.prototype.hasOwnProperty.call(value, k));
const integer = (v: unknown, max: number) => Number.isSafeInteger(v) && (v as number) >= 0 && (v as number) <= max;
const identifier = (v: unknown) => typeof v === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(v);
export function validateAttentionCalibration(value: unknown, binding: CalibrationBinding): value is AttentionCalibration {
  const v = value as AttentionCalibration;
  if (!fields(v, ['schema','profile','revision','device_id','screen_id','camera_ref','width','height','rotation','method','yaw_tenths','pitch_tenths','samples','span_ms','yaw_spread_tenths','pitch_spread_tenths','completed_at'])) return false;
  if (v.schema !== 'calibration-v1/1' || v.profile !== ATTENTION_PROFILE.id || v.method !== 'guided-3s') return false;
  if (![v.revision,v.device_id,v.screen_id,v.camera_ref].every(identifier)) return false;
  if (!integer(v.width,8192) || !v.width || !integer(v.height,8192) || !v.height || ![0,90,180,270].includes(v.rotation)) return false;
  if (!Number.isSafeInteger(v.yaw_tenths) || Math.abs(v.yaw_tenths)>450 || !Number.isSafeInteger(v.pitch_tenths) || Math.abs(v.pitch_tenths)>450) return false;
  if (!integer(v.samples,64) || v.samples<5 || !integer(v.span_ms,3000) || v.span_ms<1000 || !integer(v.yaw_spread_tenths,120) || !integer(v.pitch_spread_tenths,100)) return false;
  if (typeof v.completed_at !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v.completed_at)
    || !Number.isFinite(Date.parse(v.completed_at)) || new Date(v.completed_at).toISOString() !== v.completed_at) return false;
  return (['profile','device_id','screen_id','camera_ref','width','height','rotation'] as const).every(k => v[k] === binding[k]);
}
/** Authorized revision/profile lookup remains a future server responsibility, not client self-attestation. */
export function validateAttentionSummary(value: unknown, playingMs: number, revision: string | null, expectedMode?: 'default' | 'guided'): value is AttentionSummary {
  const v = value as AttentionSummary;
  const legacyFields=['schema','profile','calibration_revision','playing_ms','body','face','attention','expression','presence_person_ms','looking_person_ms','smile_person_ms','face_assessable_person_ms','expression_assessable_person_ms','estimated_impressions','attentive_impressions','tracked_visits','right_censored_visits','longest_look_ms'];
  const currentFields=['schema','profile','attention_mode',...legacyFields.slice(2)];
  const current=fields(v,currentFields), legacy=fields(v,legacyFields);
  if (!current && !legacy) return false;
  const mode=current?v.attention_mode:'guided';
  if (current && mode!=='default' && mode!=='guided') return false;
  if (expectedMode && mode!==expectedMode) return false;
  const revisionValid=mode==='default' ? v.calibration_revision===null && revision===null : typeof v.calibration_revision==='string' && identifier(v.calibration_revision) && v.calibration_revision===revision;
  if (v.schema !== 'attention-v1/1' || v.profile !== ATTENTION_PROFILE.id || !revisionValid
    || !integer(playingMs,ATTENTION_LIMITS.playing_ms) || v.playing_ms !== playingMs) return false;
  for (const [key,length] of [['body',3],['face',3],['attention',2],['expression',2]] as const) {
    const c=v[key];
    if (!Array.isArray(c) || c.length !== length || !Array.from(c).every(n => integer(n,playingMs)) || c[0]+c[1] !== playingMs || (length===3 && (c as number[])[2]>c[0])) return false;
  }
  if (v.attention[0]>Math.min(v.body[0],v.face[0]) || v.expression[0]>Math.min(v.body[0],v.face[0])) return false;
  const metric = (n: unknown, observed: number, capacity: number) => observed===0 ? n===null : integer(n,observed*capacity);
  if (!metric(v.presence_person_ms,v.body[0],20) || !metric(v.looking_person_ms,v.attention[0],5) || !metric(v.smile_person_ms,v.expression[0],5)
    || !metric(v.face_assessable_person_ms,v.attention[0],5) || !metric(v.expression_assessable_person_ms,v.expression[0],5)
    || !metric(v.longest_look_ms,v.attention[0],1)) return false;
  if ((v.looking_person_ms??0)>(v.face_assessable_person_ms??0) || (v.smile_person_ms??0)>(v.expression_assessable_person_ms??0)
    || (v.face_assessable_person_ms??0)>(v.presence_person_ms??0) || (v.expression_assessable_person_ms??0)>(v.presence_person_ms??0)
    || (v.longest_look_ms??0)>(v.looking_person_ms??0)) return false;
  for (const key of ['tracked_visits','right_censored_visits','estimated_impressions'] as const) {
    if (v.body[0]===0 ? v[key]!==null : !integer(v[key],ATTENTION_LIMITS.visits)) return false;
  }
  if (v.attention[0]===0 ? v.attentive_impressions!==null : !integer(v.attentive_impressions,ATTENTION_LIMITS.visits)) return false;
  if ((v.right_censored_visits??0)>(v.tracked_visits??0) || (v.estimated_impressions??0)>(v.tracked_visits??0)
    || (v.attentive_impressions??0)>(v.estimated_impressions??0)
    || (v.estimated_impressions??0)*1000>(v.presence_person_ms??0)
    || (v.attentive_impressions??0)*2000>(v.looking_person_ms??0)) return false;
  return true;
}
export const attentionJsonBytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
/** Queue adds seq_no after its current size check: budget for the largest legal sequence up front. */
export const attentionQueuedEventBytes = (event: Record<string, unknown>) => attentionJsonBytes({...event,seq_no:Number.MAX_SAFE_INTEGER});
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze);Object.freeze(value); }
  return value;
}
/** Production FIRST-enqueue decision only. Never call for a queued receipt or strip fields on retry.
 * Invalid/oversize analytics return a frozen byte-equivalent copy of the original delivery event.
 * The caller must surface the local reason; there is deliberately no fallback upload or queue here.
 */
export function prepareAttentionEnvelope(legacy: Record<string, unknown>, attention: unknown, revision: string | null, mode: 'default' | 'guided' = revision ? 'guided' : 'default') {
  if ('seq_no' in legacy || 'attention' in legacy) throw new Error('Attention may only be attached to a new, unqueued event');
  const base = JSON.parse(JSON.stringify(legacy)) as Record<string, unknown>;
  if (attentionQueuedEventBytes(base)>ATTENTION_LIMITS.event_bytes) throw new Error('Legacy evidence exceeds queue limit; retain and pause');
  if (attention===undefined) return {event:freeze(base),outcome:'absent' as const};
  if (!validateAttentionSummary(attention,base.playing_duration_ms as number,revision,mode)) return {event:freeze(base),outcome:'invalid' as const};
  const event={...base,attention:JSON.parse(JSON.stringify(attention)) as AttentionSummary};
  if (attentionQueuedEventBytes(event)>ATTENTION_LIMITS.target_bytes) return {event:freeze(base),outcome:'size_limit' as const};
  return {event:freeze(event),outcome:'included' as const};
}
