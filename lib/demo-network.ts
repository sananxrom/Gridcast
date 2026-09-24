/** Additive demo preparation. The supplied request must use an authenticated platform-admin session.
 * Media is supplied by the caller; this module never searches for ads, invents durations, or uploads files.
 */
export type DemoRequest = (method: 'GET' | 'POST', path: string, body?: Record<string, any>) => Promise<any>;
type YoutubeMedia = { youtube_id: string; duration_s: number; verification: { reference: string; verified_at: string }; approved_for_demo: true };
type UploadedMedia = { creative_id: string };
export type DemoManifest = { starts_at: string; ends_at: string; media: Record<string, YoutubeMedia | UploadedMedia> };
const prefix = 'gridcast.demo.v1';
const key = (kind: string, slug: string) => `${prefix}.${kind}.${slug}`;
export const DEMO_ADVERTISERS = [
  {slug:'coca-cola',name:'Coca-Cola India',category:'beverage'},
  {slug:'mercedes',name:'Mercedes-Benz India',category:'automotive'},
  {slug:'oreo',name:'Oreo India',category:'snack'},
  {slug:'nike',name:'Nike India',category:'apparel'},
  {slug:'amul',name:'Amul',category:'dairy'},
  {slug:'swiggy',name:'Swiggy',category:'delivery'},
] as const;
export const DEMO_CAMPAIGNS = [
  {slug:'coca-cola-rotation',advertiser:'coca-cola',media:['coca-cola-a','coca-cola-b'],rate:.15,budget:3000},
  {slug:'coca-cola-refresh',advertiser:'coca-cola',media:['coca-cola-refresh'],rate:.18,budget:3500},
  {slug:'mercedes-brand',advertiser:'mercedes',media:['mercedes-brand'],rate:.3,budget:6000},
  {slug:'mercedes-drive',advertiser:'mercedes',media:['mercedes-drive'],rate:.35,budget:7000},
  {slug:'oreo',advertiser:'oreo',media:['oreo'],rate:.12,budget:2500},
  {slug:'nike-rotation',advertiser:'nike',media:['nike-a','nike-b'],rate:.22,budget:4500},
  {slug:'nike-running',advertiser:'nike',media:['nike-running'],rate:.25,budget:5000},
  {slug:'amul',advertiser:'amul',media:['amul'],rate:.1,budget:2000},
  {slug:'swiggy',advertiser:'swiggy',media:['swiggy'],rate:.2,budget:4000},
] as const;
export const DEMO_MEDIA_KEYS = DEMO_CAMPAIGNS.flatMap(c => [...c.media]);
const operatorSpecs = [
  {slug:'sector17',name:'Sector 17 Media',fee:10,screens:3},
  {slug:'tricity',name:'Tricity Screens',fee:12,screens:3},
  {slug:'mohali',name:'Mohali Retail Media',fee:10,screens:2},
];
const entities = ['orgs','screens','advertisers','creatives','campaigns'] as const;
type Entity = typeof entities[number];
const reject = (message: string): never => {throw new Error(`Demo seed: ${message}`);};
function calendar(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return reject('flight dates must be YYYY-MM-DD');
  const at=Date.parse(value+'T00:00:00Z');
  if (!Number.isFinite(at) || new Date(at).toISOString().slice(0,10)!==value) return reject('invalid flight date');
  return at;
}
function validateManifest(manifest: DemoManifest) {
  if (!manifest?.media || DEMO_MEDIA_KEYS.some(k=>!manifest.media[k]) || Object.keys(manifest.media).length!==11) reject('supply all 11 real media entries before seeding');
  const start=calendar(manifest.starts_at), end=calendar(manifest.ends_at);
  const today=calendar(new Date(Date.now()+330*60000).toISOString().slice(0,10));
  if (start>end || start>today || end<today) reject('flight dates must include today in India');
  const ids=new Set<string>();
  for (const slot of DEMO_MEDIA_KEYS) {
    const media=manifest.media[slot];
    if ('creative_id' in media) {
      if (typeof media.creative_id!=='string' || !media.creative_id.trim() || ids.has(media.creative_id)) reject(`${slot} requires a distinct existing creative`);
      ids.add(media.creative_id);continue;
    }
    if (!/^[a-zA-Z0-9_-]{11}$/.test(media.youtube_id || '') || typeof media.duration_s!=='number' || !Number.isFinite(media.duration_s) || media.duration_s<10 || media.duration_s>20) reject(`${slot} needs a real YouTube ID and a verified 10–20 second duration`);
    if (media.approved_for_demo!==true || typeof media.verification?.reference!=='string' || !media.verification.reference.trim() || !Number.isFinite(Date.parse(media.verification?.verified_at))) reject(`${slot} needs a verification reference, timestamp and explicit demo approval`);
  }
}
async function directory(request: DemoRequest, entity: Entity) {
  const rows:any[]=[],seen=new Set<string>();let after='';
  do {
    const page=await request('GET',`/directory?entity=${entity}&limit=100${after?'&after='+encodeURIComponent(after):''}`);
    if (!Array.isArray(page?.items)) reject(`invalid ${entity} directory response`);
    rows.push(...page.items);
    if (!page.has_more) break;
    if (typeof page.next_cursor!=='string' || !page.next_cursor || seen.has(page.next_cursor)) reject(`invalid ${entity} pagination cursor`);
    after=page.next_cursor;seen.add(after);
  } while(true);
  return rows;
}
/** Throws before any mutation when media is absent, unverified, foreign-owned or inconsistent.
 * Existing records are reused unchanged. Interrupted runs may leave a pending creative: approve it through
 * the normal review workflow before retrying; this helper never overrides an existing approval decision.
 */
export async function seedDemo(request: DemoRequest, manifest: DemoManifest) {
  validateManifest(manifest);
  const rows=Object.fromEntries(await Promise.all(entities.map(async e=>[e,await directory(request,e)]))) as Record<Entity,any[]>;
  const gridcasts=rows.orgs.filter(o=>o.type==='gridcast');
  if (gridcasts.length!==1 || gridcasts[0].status==='disabled') reject('exactly one active existing Gridcast organisation is required');
  const gridcast=gridcasts[0];
  const found=(entity:Entity, externalKey:string,orgId?:string)=>rows[entity].find(r=>r.external_key===externalKey && (!orgId || r.org_id===orgId));
  const advertisers:Record<string,any>={}, creatives:Record<string,any>={};
  // Resolve and validate every existing media/advertiser relationship before creating anything.
  for(const spec of DEMO_ADVERTISERS) {
    const supplied=DEMO_CAMPAIGNS.filter(c=>c.advertiser===spec.slug).flatMap(c=>[...c.media]).map(slot=>manifest.media[slot]).filter((m):m is UploadedMedia=>'creative_id' in m);
    const ids=new Set(supplied.map(m=>rows.creatives.find(c=>c.id===m.creative_id)?.advertiser_id));
    if(ids.size>1 || ids.has(undefined)) reject(`${spec.name} media must belong to one existing advertiser`);
    const existing=ids.size ? rows.advertisers.find(a=>a.id===[...ids][0]) : found('advertisers',key('advertiser',spec.slug),gridcast.id);
    if(existing && (existing.org_id!==gridcast.id || existing.status==='archived' || existing.name!==spec.name || existing.category!==spec.category)) reject(`${spec.name} existing advertiser does not match the demo`);
    if(ids.size && !existing) reject(`${spec.name} advertiser was not found`);
    if(existing)advertisers[spec.slug]=existing;
  }
  for(const campaign of DEMO_CAMPAIGNS)for(const slot of campaign.media) {
    const media=manifest.media[slot];
    const existing='creative_id' in media ? rows.creatives.find(c=>c.id===media.creative_id) : found('creatives',key('creative',slot),gridcast.id);
    if(!existing)continue;
    const advertiser=advertisers[campaign.advertiser];
    if(!advertiser || existing.org_id!==gridcast.id || existing.advertiser_id!==advertiser.id || existing.approval_status!=='approved') reject(`${slot} existing creative must be approved and belong to its Gridcast advertiser`);
    if('creative_id' in media) {
      if(existing.metadata_source!=='server_ffprobe' || !existing.assets?.length || existing.assets.some((a:any)=>a.metadata_source!=='server_ffprobe' || !(a.duration_s>=10 && a.duration_s<=20)) || !(existing.duration_s>=10 && existing.duration_s<=20)) reject(`${slot} existing upload needs server-verified 10–20 second media`);
    } else if(existing.youtube_id!==media.youtube_id || existing.duration_s!==media.duration_s) reject(`${slot} existing media differs; it will not be overwritten`);
    creatives[slot]=existing;
  }
  const before=Object.fromEntries(entities.map(e=>[e,rows[e].length]));
  const created=Object.fromEntries(entities.map(e=>[e,0])) as Record<Entity,number>;
  const createdRows:Record<Entity,string[]>={orgs:[],screens:[],advertisers:[],creatives:[],campaigns:[]};
  async function create(entity:Entity,path:string,body:any) {
    const existing=found(entity,body.external_key,entity==='orgs'?undefined:body.org_id);
    if(existing)return existing;
    const response=await request('POST',path,body), row=entity==='screens'?response?.screen:response;
    if(!row?.id)reject(`invalid ${entity} creation response`);
    rows[entity].push(row);
    if(!response.reused){created[entity]++;createdRows[entity].push(row.id);}
    return row;
  }
  const orgs=[gridcast];
  for(const o of operatorSpecs)orgs.push(await create('orgs','/org',{external_key:key('org',o.slug),name:o.name,type:'operator',platform_fee_pct:o.fee,fee_basis:'gross'}));
  const screens:any[]=[];
  for(let orgIndex=0;orgIndex<orgs.length;orgIndex++)for(let n=0;n<(orgIndex===0?4:operatorSpecs[orgIndex-1].screens);n++) {
    const org=orgs[orgIndex],slug=orgIndex===0?'gridcast':operatorSpecs[orgIndex-1].slug,venue=['cafe','gym','kirana','salon'][(orgIndex+n)%4];
    screens.push(await create('screens','/screens',{external_key:key('screen',`${slug}-${n+1}`),org_id:org.id,name:`Demo ${org.name} ${n+1}`,venue_name:`Demo ${venue} ${n+1}`,address:'Demo venue — Chandigarh Tricity',city:'Chandigarh',venue_type:venue,size_in:[32,43,50,55][(orgIndex+n)%4],orientation:'landscape',aspect:'16:9',loop_length_s:600,slot_duration_s:10,advertiser_slots:10,network_available:true,network_slots:6,has_camera:true,owner_share_pct:20,operating_hours:{from:'09:00',to:'21:00'},tags:{demo:'gridcast-v1'}}));
  }
  for(const spec of DEMO_ADVERTISERS)advertisers[spec.slug] ||= await create('advertisers','/advertiser',{external_key:key('advertiser',spec.slug),org_id:gridcast.id,name:spec.name,category:spec.category});
  for(const campaign of DEMO_CAMPAIGNS)for(const slot of campaign.media) {
    if(creatives[slot])continue;
    const source=manifest.media[slot];if('creative_id' in source)reject(`${slot} uploaded creative missing`);
    const media=source as YoutubeMedia;
    const spec=DEMO_ADVERTISERS.find(a=>a.slug===campaign.advertiser)!;
    const creative=await create('creatives','/creative',{external_key:key('creative',slot),org_id:gridcast.id,advertiser_id:advertisers[spec.slug].id,name:`Demo ${spec.name} ${slot}`,category:spec.category,youtube_id:media.youtube_id,duration_s:media.duration_s,aspect:'16:9'});
    // Never change an existing rejection/pending decision, including a record won by a concurrent run.
    if(!createdRows.creatives.includes(creative.id) && creative.approval_status!=='approved')reject(`${slot} requires normal creative approval before retrying`);
    creatives[slot]=createdRows.creatives.includes(creative.id)?await request('POST',`/creative/${encodeURIComponent(creative.id)}/approve`,{status:'approved'}):creative;
  }
  const campaigns:any[]=[];
  for(const spec of DEMO_CAMPAIGNS)campaigns.push(await create('campaigns','/campaign',{external_key:key('campaign',spec.slug),org_id:gridcast.id,campaign_type:'network',advertiser_id:advertisers[spec.advertiser].id,name:`Demo ${spec.slug}`,status:'active',rate_type:'per_play',rate_value:spec.rate,committed_budget:spec.budget,starts_at:manifest.starts_at,ends_at:manifest.ends_at,screen_ids:screens.map(s=>s.id),creative_ids:spec.media.map(s=>creatives[s].id),bookings:screens.map(s=>({screen_id:s.id,slots_per_loop:1}))}));
  const cohort={orgs:orgs.map(o=>o.id),screens:screens.map(s=>s.id),advertisers:Object.values(advertisers).map(a=>a.id),creatives:Object.values(creatives).map(c=>c.id),campaigns:campaigns.map(c=>c.id)};
  return {created,before,cohort,existing_non_demo:Object.fromEntries(entities.map(e=>[e,rows[e].filter(r=>!cohort[e].includes(r.id)).length])),media_provenance:DEMO_MEDIA_KEYS.map(slot=>({slot,...('creative_id' in manifest.media[slot]?{source:'server_ffprobe_existing_upload'}:{source:'operator_declared_youtube',verification:(manifest.media[slot] as YoutubeMedia).verification})})),notes:['12 demo screens are additive; existing Test screens and paired devices are preserved.','YouTube duration verification is supplied by the manifest, not performed by this helper.','No users, credentials, pairing codes, existing approvals, or existing entity settings are changed.','Eligibility, actual playback and a 72-hour endurance run require separate verification.']};
}
