const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ts=require('typescript');
const source=fs.readFileSync(path.join(__dirname,'../lib/vision/performance-telemetry.ts'),'utf8');
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const mod={exports:{}};new Function('module','exports',js)(mod,mod.exports);
const {PresencePerformanceTelemetry,sanitizePresenceDiagnostic,upsertPresenceDiagnosticHistory,PRESENCE_DIAGNOSTIC_HISTORY}=mod.exports;

test('slow and failed inference latency is counted before freshness rejection',()=>{
 const t=new PresencePerformanceTelemetry();
 t.attempted('face');t.completed('face',640,500,true);
 t.attempted('face');t.completed('face',140,500,false);
 const report=sanitizePresenceDiagnostic(t.snapshot());
 assert.ok(report);const face=report.windows[0].face;
 assert.equal(face.attempted,2);assert.equal(face.completed,2);assert.equal(face.accepted,0);assert.equal(face.slow_rejected,1);assert.equal(face.failed,1);
 assert.equal(face.latency_count,2);assert.equal(face.latency_sum_ms,780);assert.deepEqual(face.latency_histogram,[0,0,1,0,1,0,0,0]);
});

test('coverage reasons are aggregate-only and history upserts are idempotent and bounded',()=>{
 const t=new PresencePerformanceTelemetry();
 t.coverage({body_status:'ok',face_status:'ok',faces_detected:2,faces_assessable:1,faces_unmatched:1,faces_too_small:0,faces_unclear:0,uncertain_associations:1,fresh_empty_scene:false});
 const first=sanitizePresenceDiagnostic(t.snapshot());assert.ok(first);
 const withUntrustedGeometry={...t.snapshot(),camera_frame:{pixels:'must never persist'}};
 const clean=sanitizePresenceDiagnostic(withUntrustedGeometry);assert.ok(clean);assert.equal('camera_frame' in clean,false);
 let history=[];history=upsertPresenceDiagnosticHistory(history,clean);history=upsertPresenceDiagnosticHistory(history,clean);
 assert.equal(history.length,1);assert.equal(history[0].reasons.faces_unmatched,1);
 const stale={...clean,windows:clean.windows.map(w=>({...w,revision:w.revision-1,body:{...w.body,attempted:999}}))};
 history=upsertPresenceDiagnosticHistory(history,stale);assert.equal(history[0].body.attempted,0);
 for(let i=0;i<PRESENCE_DIAGNOSTIC_HISTORY+8;i++){
  const next={...clean,session_id:require('node:crypto').randomUUID(),session_started_at:new Date(Date.now()+i).toISOString(),windows:clean.windows.map(w=>({...w,window_id:`w${i}`,revision:1,started_at:new Date(Date.now()+i).toISOString(),ended_at:new Date(Date.now()+i).toISOString()}))};
  const sanitized=sanitizePresenceDiagnostic(next,Date.now()+i+1);assert.ok(sanitized);history=upsertPresenceDiagnosticHistory(history,sanitized);
 }
 assert.equal(history.length,PRESENCE_DIAGNOSTIC_HISTORY);
});

test('diagnostics reject unbounded or inconsistent aggregates',()=>{
 const t=new PresencePerformanceTelemetry(),snapshot=t.snapshot();
 assert.equal(sanitizePresenceDiagnostic({...snapshot,windows:Array(3).fill(snapshot.windows[0])}),null);
 assert.equal(sanitizePresenceDiagnostic({...snapshot,windows:snapshot.windows.map(w=>({...w,face:{...w.face,latency_histogram:[999999999,0,0,0,0,0,0,0]}}))}),null);
});

test('window revisions stay valid and monotonic beyond the old million-update ceiling',()=>{
 const t=new PresencePerformanceTelemetry();t.snapshot();t.windows.get(0).revision=1_000_000;t.attempted('face');
 const snapshot=t.snapshot();assert.equal(snapshot.windows[0].revision,1_000_001);assert.ok(sanitizePresenceDiagnostic(snapshot));
});
