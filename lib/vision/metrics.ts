/** Local evaluation only. No recognition, persistence, frame export or billing authority. */
export type Box = [number, number, number, number];
export type Face = { box: Box; looking: boolean | null; smiling: boolean | null; unavailable_reason?: 'too_small' | 'unclear' };
export type Observation = {
  at: number;
  bodies?: { ok: boolean; boxes: Box[]; saturated: boolean };
  faces?: { ok: boolean; faces: Face[]; saturated: boolean };
};
export type ObservationStatus = 'ok' | 'error' | 'stale' | 'unavailable';
export const EVALUATION_LIMITS = Object.freeze({body_max_age_ms:750,face_max_age_ms:500,track_loss_ms:2000,max_tracks:40,max_bodies:20,max_faces:5,max_completed_plays:20,exposure_threshold_s:1,attention_threshold_s:2});
export type PlaySummary = {
  play_id:string; playing_s:number; body_observed_s:number; body_unknown_s:number; body_saturated_s:number;
  face_observed_s:number; face_unknown_s:number; face_saturated_s:number;
  attention_observed_s:number; attention_unknown_s:number; expression_observed_s:number; expression_unknown_s:number;
  presence_person_s:number|null; attention_person_s:number|null; smile_person_s:number|null;
  face_observable_person_s:number; expression_observable_person_s:number;
  avg_people:number|null; avg_looking:number|null; visible_smile_rate:number|null;
  estimated_impressions:number|null; attentive_impressions:number|null; dwell_person_s:number|null;
  longest_look_s:number|null; tracked_visits:number; right_censored_visits:number;
};
export type EvaluationSnapshot = {
  version:'gridcast-attention-eval/1'; current:PlaySummary|null; completed:PlaySummary[];
  live:{people:number|null;face_assessable:number|null;looking:number|null;smiling:number|null;
    body_status:ObservationStatus;face_status:ObservationStatus;body_saturated:boolean;face_saturated:boolean;uncertain_associations:number};
  limits:typeof EVALUATION_LIMITS;
};
/** Deliberately separate from exportable aggregates; identifiers and geometry are local display only. */
export type FaceView = {box:Box;track_key:number|null;looking:boolean|null;reason:'too_small'|'unclear'|'unmatched'|null};
export type TrackView = {key:number;box:Box;looking:boolean|null;smiling:boolean|null;uncertain:boolean;dwell_s:number;looking_s:number;smiling_s:number;longest_look_s:number};
type Track = {key:number;box:Box;seen:number;created:number;vx:number;vy:number;uncertain:boolean};
type Visit = {dwell:number;looking:number;smiling:number;streak:number;longest:number};
type Accumulator = {play_id:string;playing_s:number;body_observed_s:number;body_unknown_s:number;body_saturated_s:number;
  face_observed_s:number;face_unknown_s:number;face_saturated_s:number;attention_observed_s:number;attention_unknown_s:number;expression_observed_s:number;expression_unknown_s:number;
  presence:number;attention:number;smile:number;face_observable_person_s:number;expression_observable_person_s:number;
  visits:Map<number,Visit>;finished:{count:number;exposures:number;attentive:number;longest:number}};
type ModelState<T> = {at:number;ok:boolean;saturated:boolean;values:T[]} | null;
const validTime = (at:number) => Number.isFinite(at) && at >= 0;
const center = (b:Box) => [(b[0]+b[2])/2,(b[1]+b[3])/2];
const area = (b:Box) => (b[2]-b[0])*(b[3]-b[1]);
function intersection(a:Box,b:Box) { return Math.max(0,Math.min(a[2],b[2])-Math.max(a[0],b[0])) * Math.max(0,Math.min(a[3],b[3])-Math.max(a[1],b[1])); }
function iou(a:Box,b:Box) { const n=intersection(a,b);return n/(area(a)+area(b)-n || 1); }
function box(value:Box):Box|null {
  if (!Array.isArray(value) || value.length !== 4 || !value.every(Number.isFinite)) return null;
  const b=value.map(v=>Math.max(0,Math.min(1,v))) as Box;
  return b[2]>b[0] && b[3]>b[1] ? b : null;
}
const status = (state:ModelState<unknown>,at:number,maxAge:number):ObservationStatus => !state ? 'unavailable' : !state.ok ? 'error' : at-state.at>maxAge ? 'stale' : 'ok';
function accumulator(play_id:string):Accumulator {
  return {play_id,playing_s:0,body_observed_s:0,body_unknown_s:0,body_saturated_s:0,face_observed_s:0,face_unknown_s:0,face_saturated_s:0,
    attention_observed_s:0,attention_unknown_s:0,expression_observed_s:0,expression_unknown_s:0,presence:0,attention:0,smile:0,face_observable_person_s:0,expression_observable_person_s:0,
    visits:new Map(),finished:{count:0,exposures:0,attentive:0,longest:0}};
}
const qualifies = (seconds:number,threshold:number) => seconds+1e-9>=threshold;
const newVisit = ():Visit => ({dwell:0,looking:0,smiling:0,streak:0,longest:0});

/**
 * One body-led track set. A retained unmatched track never contributes to the current count.
 * Valid samples are held only while fresh. A single interval ending beyond freshness is
 * conservatively unknown in full; UI snapshot frequency cannot manufacture observed time.
 */
export class EvaluationMetrics {
  private bodies:ModelState<number>=null;
  private faces:ModelState<Face>=null;
  private tracks=new Map<number,Track>();
  private nextKey=1;
  private at:number|null=null;
  private playing=false;
  private current:Accumulator|null=null;
  private completed:PlaySummary[]=[];

  observe(obs:Observation):void {
    if (!validTime(obs.at) || (this.at !== null && obs.at<this.at)) return;
    this.advance(obs.at);
    if (obs.bodies) {
      const input=obs.bodies, values=Array.isArray(input.boxes) ? input.boxes.slice(0,EVALUATION_LIMITS.max_bodies).map(box) : [null];
      const ok=input.ok === true && values.every(v=>v!==null);
      const keys=ok ? this.matchBodies(values as Box[],obs.at) : [];
      this.bodies={at:obs.at,ok,saturated:input.saturated === true || (Array.isArray(input.boxes) && input.boxes.length>=EVALUATION_LIMITS.max_bodies),values:keys};
    }
    if (obs.faces) {
      const input=obs.faces, values=Array.isArray(input.faces) ? input.faces.slice(0,EVALUATION_LIMITS.max_faces).map(f=>({unavailable_reason:f?.unavailable_reason === 'too_small' ? 'too_small' as const : f?.unavailable_reason === 'unclear' ? 'unclear' as const : undefined,box:box(f?.box),looking:typeof f?.looking==='boolean'?f.looking:null,smiling:typeof f?.smiling==='boolean'?f.smiling:null})) : [{box:null,looking:null,smiling:null}];
      const ok=input.ok === true && values.every(v=>v.box!==null);
      this.faces={at:obs.at,ok,saturated:input.saturated === true || (Array.isArray(input.faces) && input.faces.length>=EVALUATION_LIMITS.max_faces),values:ok ? values as Face[] : []};
    }
    // A known empty scene, failure or unresolved face ends a continuous look immediately.
    const seen=this.associated(obs.at);
    for (const [key,visit] of this.current?.visits || []) if (seen.find(s=>s.track.key===key)?.looking !== true) visit.streak=0;
  }

  boundary(playId:string|null,playing:boolean,at:number):void {
    if (!validTime(at) || (this.at !== null && at<this.at)) return;
    if (playId !== null && (typeof playId!=='string' || !playId || playId.length>128)) throw new Error('Use a nonempty local play ID of at most 128 characters');
    this.advance(at);
    if (playId !== this.current?.play_id) {
      if (this.current) {
        this.completed.push(this.summarize(this.current));
        if (this.completed.length>EVALUATION_LIMITS.max_completed_plays) this.completed.shift();
      }
      this.current=playId===null ? null : accumulator(playId);
    }
    if (!playing) for (const visit of this.current?.visits.values() || []) visit.streak=0;
    this.playing=playId!==null && playing;
  }

  snapshot(at:number):EvaluationSnapshot {
    const now=validTime(at) ? Math.max(at,this.at ?? at) : this.at ?? 0;
    const current=this.project(now), associated=this.associated(now);
    const bs=status(this.bodies,now,EVALUATION_LIMITS.body_max_age_ms),fs=status(this.faces,now,EVALUATION_LIMITS.face_max_age_ms);
    const empty=bs==='ok' && associated.length===0 && this.faces?.values.length===0;
    const look=associated.filter(s=>s.looking!==null),smile=associated.filter(s=>s.smiling!==null);
    return {version:'gridcast-attention-eval/1',current:current ? this.summarize(current) : null,completed:this.completed.map(p=>({...p})),
      live:{people:bs==='ok' ? associated.length : null,face_assessable:bs==='ok' && fs==='ok' ? look.length : null,
        looking:bs==='ok' && fs==='ok' && (look.length>0 || empty) ? look.filter(s=>s.looking).length : null,
        smiling:bs==='ok' && fs==='ok' && (smile.length>0 || empty) ? smile.filter(s=>s.smiling).length : null,
        body_status:bs,face_status:fs,body_saturated:bs==='ok' && !!this.bodies?.saturated,face_saturated:fs==='ok' && !!this.faces?.saturated,
        uncertain_associations:associated.filter(s=>s.uncertain).length},limits:EVALUATION_LIMITS};
  }

  liveTracks(at:number):TrackView[] {
    const now=validTime(at) ? Math.max(at,this.at ?? at) : this.at ?? 0,acc=this.project(now);
    return this.associated(now).map(s=>{const v=acc?.visits.get(s.track.key);return {key:s.track.key,box:[...s.track.box] as Box,looking:s.looking,smiling:s.smiling,uncertain:s.uncertain,dwell_s:v?.dwell || 0,looking_s:v?.looking || 0,smiling_s:v?.smiling || 0,longest_look_s:v?.longest || 0};});
  }

  /** Display only: fresh face geometry and the same conservative body association used by metrics. */
  liveFaces(at:number):FaceView[] {
    const now=validTime(at) ? Math.max(at,this.at ?? at) : this.at ?? 0;
    if (status(this.faces,now,EVALUATION_LIMITS.face_max_age_ms)!=='ok') return [];
    const associated=this.associated(now);
    return (this.faces?.values || []).map(face=>{
      const match=associated.find(s=>s.face===face && !s.uncertain);
      return {box:[...face.box] as Box,track_key:match?.track.key ?? null,looking:match?.looking ?? null,
        reason:!match ? 'unmatched' : face.looking===null ? face.unavailable_reason || 'unclear' : null};
    });
  }

  reset():void { this.bodies=null;this.faces=null;this.tracks.clear();this.nextKey=1;this.at=null;this.playing=false;this.current=null;this.completed=[]; }

  private advance(at:number) {
    if (this.at!==null && this.current && this.playing) this.integrate(this.current,this.at,at);
    this.at=at;
    for (const track of this.tracks.values()) if (at-track.seen>EVALUATION_LIMITS.track_loss_ms) this.retire(track.key);
  }
  private retire(key:number) {
    const v=this.current?.visits.get(key);
    if (v && this.current) { const f=this.current.finished;f.count++;f.exposures+=Number(qualifies(v.dwell,EVALUATION_LIMITS.exposure_threshold_s));f.attentive+=Number(qualifies(v.dwell,EVALUATION_LIMITS.exposure_threshold_s) && qualifies(v.looking,EVALUATION_LIMITS.attention_threshold_s));f.longest=Math.max(f.longest,v.longest);this.current.visits.delete(key); }
    this.tracks.delete(key);
  }
  private matchBodies(boxes:Box[],at:number):number[] {
    const used=new Set<number>(),keys:number[]=[],candidates:{index:number;key:number;score:number;ambiguous:boolean}[]=[];
    boxes.forEach((b,index)=>{
      const [x,y]=center(b);
      const scores=[...this.tracks.values()].flatMap(t=>{
        const dt=Math.min(500,at-t.seen),[tx,ty]=center(t.box),px=tx+t.vx*dt,py=ty+t.vy*dt;
        const distance=Math.hypot(x-px,y-py),scale=Math.max(.08,Math.hypot(b[2]-b[0],b[3]-b[1]));
        const overlap=iou(b,t.box);
        if (distance>Math.min(.3,scale*.55) && overlap<.15) return [];
        return [{key:t.key,score:overlap*.55+Math.max(0,1-distance/scale)*.45}];
      }).sort((a,b)=>b.score-a.score);
      if (scores[0]) candidates.push({index,key:scores[0].key,score:scores[0].score,ambiguous:!!scores[1] && scores[0].score-scores[1].score<.1});
    });
    // Greedy one-to-one motion/overlap assignment. Ambiguous crossings split instead
    // of pretending to know a visitor identity; the UI marks that observation uncertain.
    const assigned=new Map<number,{key:number;uncertain:boolean}>();
    for (const c of candidates.sort((a,b)=>b.score-a.score)) if (!c.ambiguous && !used.has(c.key)) { used.add(c.key);assigned.set(c.index,{key:c.key,uncertain:false}); }
    boxes.forEach((b,index)=>{
      const chosen=assigned.get(index),candidate=candidates.find(c=>c.index===index);
      let track=chosen ? this.tracks.get(chosen.key) : undefined;
      if (!track) {
        if (this.tracks.size>=EVALUATION_LIMITS.max_tracks) {
          const oldest=[...this.tracks.values()].filter(t=>!used.has(t.key)).sort((a,b)=>a.seen-b.seen)[0];
          if (oldest) this.retire(oldest.key);
        }
        track={key:this.nextKey++,box:b,seen:at,created:at,vx:0,vy:0,uncertain:!!candidate};this.tracks.set(track.key,track);
      } else {
        const dt=at-track.seen,[x,y]=center(b),[px,py]=center(track.box);
        track.vx=dt>0 ? Math.max(-.002,Math.min(.002,(x-px)/dt)) : track.vx;
        track.vy=dt>0 ? Math.max(-.002,Math.min(.002,(y-py)/dt)) : track.vy;
        track.box=b;track.seen=at;track.uncertain=false;
      }
      used.add(track.key);keys.push(track.key);
    });
    return keys;
  }
  private associated(at:number) {
    if (status(this.bodies,at,EVALUATION_LIMITS.body_max_age_ms)!=='ok') return [];
    const result=(this.bodies?.values || []).flatMap(key=>{const track=this.tracks.get(key);return track ? [{track,face:null as Face|null,looking:null as boolean|null,smiling:null as boolean|null,uncertain:track.uncertain}] : [];});
    if (status(this.faces,at,EVALUATION_LIMITS.face_max_age_ms)!=='ok') return result;
    const assigned=new Set<number>();
    for (const face of this.faces?.values || []) {
      const [fx,fy]=center(face.box);
      const candidates=result.map((s,index)=>{
        if (this.faces!.at<s.track.created) return null;
        const b=s.track.box,w=b[2]-b[0],h=b[3]-b[1];
        if (intersection(b,face.box)/area(face.box)<.6 || fy>b[1]+h*.6) return null;
        const score=Math.hypot((fx-(b[0]+b[2])/2)/w,(fy-(b[1]+h*.18))/h);
        return {index,score};
      }).filter((c):c is {index:number;score:number}=>c!==null).sort((a,b)=>a.score-b.score);
      if (!candidates[0]) continue;
      if (candidates[1] && candidates[1].score-candidates[0].score<.08) { for (const c of candidates.slice(0,2)) result[c.index].uncertain=true;continue; }
      const selected=candidates[0].index;
      if (assigned.has(selected)) { result[selected].looking=null;result[selected].smiling=null;result[selected].uncertain=true;continue; }
      assigned.add(selected);
      if (!result[selected].uncertain) { result[selected].face=face;result[selected].looking=face.looking;result[selected].smiling=face.smiling; }
    }
    return result;
  }
  private integrate(acc:Accumulator,start:number,end:number) {
    const dt=(end-start)/1000;if (dt<=0) return;
    acc.playing_s+=dt;
    const bodyOk=status(this.bodies,end,EVALUATION_LIMITS.body_max_age_ms)==='ok',faceOk=status(this.faces,end,EVALUATION_LIMITS.face_max_age_ms)==='ok';
    acc[bodyOk?'body_observed_s':'body_unknown_s']+=dt;
    acc[faceOk?'face_observed_s':'face_unknown_s']+=dt;
    if (bodyOk && this.bodies?.saturated) acc.body_saturated_s+=dt;
    if (faceOk && this.faces?.saturated) acc.face_saturated_s+=dt;
    const seen=this.associated(end),look=seen.filter(s=>s.looking!==null),smile=seen.filter(s=>s.smiling!==null);
    const empty=seen.length===0 && this.faces?.values.length===0;
    const attentionOk=bodyOk && faceOk && (empty || look.length>0),expressionOk=bodyOk && faceOk && (empty || smile.length>0);
    acc[attentionOk?'attention_observed_s':'attention_unknown_s']+=dt;
    acc[expressionOk?'expression_observed_s':'expression_unknown_s']+=dt;
    if (bodyOk) acc.presence+=seen.length*dt;
    if (attentionOk) { acc.attention+=look.filter(s=>s.looking).length*dt;acc.face_observable_person_s+=look.length*dt; }
    if (expressionOk) { acc.smile+=smile.filter(s=>s.smiling).length*dt;acc.expression_observable_person_s+=smile.length*dt; }
    const contributing=new Set<number>();
    for (const s of seen) {
      const v=acc.visits.get(s.track.key) || newVisit();acc.visits.set(s.track.key,v);contributing.add(s.track.key);v.dwell+=dt;
      if (s.looking===true) { v.looking+=dt;v.streak+=dt;v.longest=Math.max(v.longest,v.streak); } else v.streak=0;
      if (s.smiling===true) v.smiling+=dt;
    }
    for (const [key,v] of acc.visits) if (!contributing.has(key)) v.streak=0;
  }
  private project(at:number):Accumulator|null {
    if (!this.current) return null;
    const acc={...this.current,visits:new Map([...this.current.visits].map(([key,v])=>[key,{...v}])),finished:{...this.current.finished}};
    if (this.playing && this.at!==null) this.integrate(acc,this.at,at);
    return acc;
  }
  private summarize(acc:Accumulator):PlaySummary {
    const visits=[...acc.visits.values()],body=acc.body_observed_s>0,attention=acc.attention_observed_s>0,expression=acc.expression_observed_s>0;
    const {visits:_v,finished:_f,presence,attention:_a,smile,...common}=acc;
    return {...common,presence_person_s:body?presence:null,attention_person_s:attention?acc.attention:null,smile_person_s:expression?smile:null,
      avg_people:body?presence/acc.body_observed_s:null,avg_looking:attention?acc.attention/acc.attention_observed_s:null,
      visible_smile_rate:acc.expression_observable_person_s>0?smile/acc.expression_observable_person_s:null,
      estimated_impressions:body?acc.finished.exposures+visits.filter(v=>qualifies(v.dwell,EVALUATION_LIMITS.exposure_threshold_s)).length:null,
      attentive_impressions:attention?acc.finished.attentive+visits.filter(v=>qualifies(v.dwell,EVALUATION_LIMITS.exposure_threshold_s) && qualifies(v.looking,EVALUATION_LIMITS.attention_threshold_s)).length:null,
      dwell_person_s:body?presence:null,longest_look_s:attention?Math.max(acc.finished.longest,...visits.map(v=>v.longest),0):null,
      tracked_visits:acc.finished.count+visits.length,right_censored_visits:visits.length};
  }
}
