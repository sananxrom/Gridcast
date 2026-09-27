import { createHash } from 'node:crypto';
import { PRESENCE_V2_PROFILE } from './presence-v2-profile';
export { PRESENCE_V2_PROFILE } from './presence-v2-profile';

/** Immutable provenance for the independently scheduled body/face production pipeline. */
export type PresenceBindingConfig = {
  profile: typeof PRESENCE_V2_PROFILE.id;
  config_version: string | number;
  calibration_revision: string | null;
  calibration: { yaw: number; pitch: number } | null;
  camera_policy: 'local-camera';
  body_input_px: number;
  face_input_px: number;
  body_interval_ms: number;
  face_interval_ms: number;
  body_max: number;
  face_max: number;
  count_ceiling: number;
  confidence: number;
  metrics: typeof PRESENCE_V2_PROFILE.metric_schema;
};

const canonical = (value: any): string => Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
  : value && typeof value === 'object' ? `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}` : JSON.stringify(value);
const digest = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
// Explicitly approved released provenance remains valid for issued bindings and
// queued receipts. Add each released pin here before a future runtime pin is deployed.
const APPROVED_BINDING_PROVENANCE = [
  { manifest_sha256:PRESENCE_V2_PROFILE.manifest_sha256, pipeline_sha256:PRESENCE_V2_PROFILE.pipeline_sha256,
    model_versions:{body:PRESENCE_V2_PROFILE.body_model,face:PRESENCE_V2_PROFILE.face_model,runtime:PRESENCE_V2_PROFILE.runtime} }, // current candidate 0.10.4
  { manifest_sha256:PRESENCE_V2_PROFILE.manifest_sha256, pipeline_sha256:'a6de272583e9697e5e9577c9f724567b6acfaac2eb5d1d3648dfa5caa8ac0def',
    model_versions:{body:PRESENCE_V2_PROFILE.body_model,face:PRESENCE_V2_PROFILE.face_model,runtime:PRESENCE_V2_PROFILE.runtime}, legacy_id:true }, // deployed 0.10.3
  { manifest_sha256:PRESENCE_V2_PROFILE.manifest_sha256, pipeline_sha256:'906b881633dd9a5fcf7347790fd18ce81f0d768255f63198cab21334ae335d77',
    model_versions:{body:PRESENCE_V2_PROFILE.body_model,face:PRESENCE_V2_PROFILE.face_model,runtime:PRESENCE_V2_PROFILE.runtime}, legacy_id:true }, // deployed 0.10.1/0.10.2 receipt provenance
  { manifest_sha256:PRESENCE_V2_PROFILE.manifest_sha256, pipeline_sha256:'7d8e7edd31110372295e909b8ba8b75c91b2bbd9a83a5862771189eed1c96016',
    model_versions:{body:PRESENCE_V2_PROFILE.body_model,face:PRESENCE_V2_PROFILE.face_model,runtime:PRESENCE_V2_PROFILE.runtime}, legacy_id:true }, // 0.10.0
];
function legacyPresenceBindingId(assignmentId:string, config:PresenceBindingConfig) {
  return `measurement_${digest([assignmentId, config.profile, config, config.calibration_revision])}`;
}
function provenancePresenceBindingId(assignmentId:string,config:PresenceBindingConfig,provenance:{manifest_sha256:string;pipeline_sha256:string;model_versions:{body:string;face:string;runtime:string}}) {
  return `measurement_${digest([assignmentId,config.profile,config,config.calibration_revision,provenance.manifest_sha256,provenance.pipeline_sha256,
    provenance.model_versions.body,provenance.model_versions.face,provenance.model_versions.runtime])}`;
}

export function presenceBindingConfig(configVersion: string | number, countCeiling?: number, confidence?: number, calibration?: any): PresenceBindingConfig {
  const confidenceValue = Number(confidence);
  const ceilingValue = Number(countCeiling);
  return {
    profile: PRESENCE_V2_PROFILE.id,
    config_version: configVersion,
    calibration_revision: typeof calibration?.revision === 'string' ? calibration.revision : null,
    calibration: typeof calibration?.revision === 'string' && Number.isFinite(calibration.yaw_tenths) && Number.isFinite(calibration.pitch_tenths)
      ? { yaw: calibration.yaw_tenths / 10, pitch: calibration.pitch_tenths / 10 } : null,
    camera_policy: 'local-camera',
    body_input_px: PRESENCE_V2_PROFILE.body_input_px,
    face_input_px: PRESENCE_V2_PROFILE.face_input_px,
    body_interval_ms: PRESENCE_V2_PROFILE.body_interval_ms,
    face_interval_ms: PRESENCE_V2_PROFILE.face_interval_ms,
    body_max: PRESENCE_V2_PROFILE.body_max,
    face_max: PRESENCE_V2_PROFILE.face_max,
    count_ceiling: Number.isInteger(ceilingValue) ? Math.max(1, Math.min(500, ceilingValue)) : PRESENCE_V2_PROFILE.count_ceiling_default,
    confidence: Number.isFinite(confidenceValue) ? Math.max(0.01, Math.min(1, confidenceValue)) : PRESENCE_V2_PROFILE.confidence_default,
    metrics: PRESENCE_V2_PROFILE.metric_schema,
  };
}

export function presenceBindingId(assignmentId: string, config: PresenceBindingConfig): string {
  return provenancePresenceBindingId(assignmentId,config,{manifest_sha256:PRESENCE_V2_PROFILE.manifest_sha256,pipeline_sha256:PRESENCE_V2_PROFILE.pipeline_sha256,
    model_versions:{body:PRESENCE_V2_PROFILE.body_model,face:PRESENCE_V2_PROFILE.face_model,runtime:PRESENCE_V2_PROFILE.runtime}});
}

export function makePresenceBinding(assignment: any, device: any, screen: any, config: PresenceBindingConfig, now: string) {
  const id = presenceBindingId(assignment.id, config);
  return {
    id,
    assignment_id: assignment.id,
    device_id: device.id,
    screen_id: screen.id,
    org_id: screen.org_id,
    profile: config.profile,
    config: structuredClone(config),
    model_versions: { body: PRESENCE_V2_PROFILE.body_model, face: PRESENCE_V2_PROFILE.face_model, runtime: PRESENCE_V2_PROFILE.runtime },
    manifest_url: PRESENCE_V2_PROFILE.manifest_url,
    manifest_sha256: PRESENCE_V2_PROFILE.manifest_sha256,
    pipeline_sha256: PRESENCE_V2_PROFILE.pipeline_sha256,
    created_at: now,
  };
}

export function validatePresenceBinding(binding: any, assignment: any, device: any, screen: any, claimedId: unknown): boolean {
  if (!binding || binding.id !== claimedId || binding.assignment_id !== assignment?.id || binding.device_id !== device?.id || binding.screen_id !== screen?.id || binding.org_id !== screen?.org_id) return false;
  const config = binding.config;
  if (!config || config.profile !== PRESENCE_V2_PROFILE.id || config.metrics !== PRESENCE_V2_PROFILE.metric_schema || config.config_version !== assignment?.config_version) return false;
  if (config.calibration_revision === null ? config.calibration !== null : !config.calibration || !Number.isFinite(config.calibration.yaw) || !Number.isFinite(config.calibration.pitch)) return false;
  const versions=binding.model_versions;
  if(!versions||typeof versions.body!=='string'||typeof versions.face!=='string'||typeof versions.runtime!=='string')return false;
  const provenance=APPROVED_BINDING_PROVENANCE.find(p=>p.manifest_sha256===binding.manifest_sha256&&p.pipeline_sha256===binding.pipeline_sha256
    &&p.model_versions.body===versions.body&&p.model_versions.face===versions.face&&p.model_versions.runtime===versions.runtime);
  if(!provenance)return false;
  return binding.id===provenancePresenceBindingId(assignment.id,config,provenance)
    || (provenance.legacy_id===true&&binding.id===legacyPresenceBindingId(assignment.id,config));
}

export function sameBinding(a: any, b: any): boolean {
  const stable = (v: any): string => Array.isArray(v) ? `[${v.map(stable).join(',')}]`
    : v && typeof v === 'object' ? `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}` : JSON.stringify(v);
  const clean = (v: any) => { const { created_at: _created_at, ...rest } = v || {}; return rest; };
  return stable(clean(a)) === stable(clean(b));
}
