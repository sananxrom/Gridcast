// Deliberately maximum-width candidate fields, not claims about unbounded legacy IDs.
const {DRAFT_PROFILE,DRAFT_LIMITS}=require('./load-lib.cjs')('vision/contracts-draft');
const attention=(patch={})=>({schema:'attention-draft/1',profile:DRAFT_PROFILE.id,calibration_revision:'r'.repeat(64),
 playing_ms:DRAFT_LIMITS.playing_ms,body:[3601000,0,3601000],face:[3601000,0,3601000],attention:[3601000,0],expression:[3601000,0],
 presence_person_ms:72020000,looking_person_ms:18005000,smile_person_ms:18005000,face_assessable_person_ms:18005000,expression_assessable_person_ms:18005000,
 estimated_impressions:72020,attentive_impressions:9002,tracked_visits:1000000,right_censored_visits:1000000,longest_look_ms:3601000,...patch});
const legacy=(media='image',measured=true)=>({play_uid:'p'.repeat(128),assignment_id:'a'.repeat(64),campaign_id:'c'.repeat(64),creative_id:'v'.repeat(64),
 config_version:Number.MAX_SAFE_INTEGER,started_at_device:'2026-09-26T00:00:00.000Z',ended_at_device:'2026-09-26T01:00:00.000Z',kind:'filler',
 media_evidence:media==='image'?'image_decode':'media_timeline',...(media==='image'?{decoded_width:8192,decoded_height:8192,visible_duration_ms:3601000}:{}),
 playing_duration_ms:3601000,media_started_s:0.12345678901234568,media_ended_s:3600.1234567890123,ended_reason:'duration_observed',server_clock_offset_ms:-86400000.12345679,
 measured,avg_persons:measured?9999.999999999998:null,sample_count:measured?100000:0,model_ver:measured?DRAFT_PROFILE.legacy_source:null});
const calibration=()=>({schema:'calibration-draft/1',profile:DRAFT_PROFILE.id,revision:'r'.repeat(64),device_id:'device',screen_id:'screen',camera_ref:'opaque-installation-camera',
 width:1920,height:1080,rotation:0,method:'guided-3s',yaw_tenths:-80,pitch_tenths:35,samples:12,span_ms:2200,yaw_spread_tenths:20,pitch_spread_tenths:15,completed_at:'2026-09-26T00:00:00.000Z'});
module.exports={attention,legacy,calibration};
