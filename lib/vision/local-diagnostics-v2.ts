import type { FaceView, TrackView } from './metrics';

/** Display-only estimates matching the supplied tracker defaults. Nothing from here is serialized. */
export type LocalTrackDiagnostics = { key:number;distance_cm:number|null;distance_band:'near'|'mid'|'far'|null;speed_body_heights_s:number|null;stopped:boolean|null };
const DEG=Math.PI/180,HFOV_DEG=65,AVERAGE_PERSON_CM=165,STILL_SPEED_BODY_HEIGHTS_S=.15,STILL_MIN_S=2.5;
type State={box:[number,number,number,number];seen:number;speed:number;ema:number;still:boolean;stillStart:number|null;rawStillSince:number|null;bodyDistance:number|null;faceDistance:number|null;faceAt:number};
const center=(b:[number,number,number,number])=>[(b[0]+b[2])/2,(b[1]+b[3])/2];
const bodyDistance=(box:[number,number,number,number],width:number,height:number)=>{
  const vfov=HFOV_DEG*(height/Math.max(1,width));
  const personHeight=Math.max(1e-6,box[3]-box[1]);
  return AVERAGE_PERSON_CM/(2*Math.tan((vfov/2)*DEG)*personHeight);
};
const distanceBand=(cm:number|null):LocalTrackDiagnostics['distance_band']=>cm===null||!Number.isFinite(cm)?null:cm<300?'near':cm<=600?'mid':'far';

export class PresenceV2LocalDiagnostics {
  private states=new Map<number,State>();
  private lastBodyAt=-Infinity;
  observeBodies(at:number,tracks:TrackView[],width:number,height:number){
    if(!Number.isFinite(at)||at<=this.lastBodyAt||width<1||height<1)return;
    for(const track of tracks){
      const prior=this.states.get(track.key),[x,y]=center(track.box),bodyH=Math.max(1e-6,track.box[3]-track.box[1]);
      let speed=0,ema=0,stillStart:number|null=null,rawStillSince:number|null=null,still=false;
      if(prior){
        const dt=Math.max(.001,(at-prior.seen)/1000),[px,py]=center(prior.box),previousH=Math.max(1e-6,prior.box[3]-prior.box[1]);
        speed=Math.hypot(x-px,y-py)/((bodyH+previousH)/2)/dt;
        ema=prior.ema;stillStart=prior.stillStart;rawStillSince=prior.rawStillSince;still=prior.still;
        const raw=speed<STILL_SPEED_BODY_HEIGHTS_S;
        if(raw){if(rawStillSince===null)rawStillSince=prior.seen;}else rawStillSince=null;
        ema+=((raw?1:0)-ema)*(1-Math.exp(-dt/1));
        if(!still&&ema>.6){still=true;stillStart=rawStillSince??at;}
        else if(still&&ema<.4){still=false;stillStart=null;}
      }else{speed=0;rawStillSince=at;}
      const state:State={box:[...track.box],seen:at,speed,ema,still,stillStart,rawStillSince,
        bodyDistance:bodyDistance(track.box,width,height),faceDistance:prior?.faceDistance??null,faceAt:prior?.faceAt??-Infinity};
      this.states.set(track.key,state);
    }
    const live=new Set(tracks.map(t=>t.key));for(const [key,state]of this.states)if(at-state.seen>2000&&!live.has(key))this.states.delete(key);
    this.lastBodyAt=at;
  }
  observeFaces(at:number,faces:Array<{box:[number,number,number,number];distance_cm?:number|null}>,views:FaceView[]){
    if(!Number.isFinite(at))return;
    faces.forEach((face,index)=>{const key=views[index]?.track_key,cm=face.distance_cm;if(key===null||key===undefined||!Number.isFinite(cm))return;const state=this.states.get(key);if(state){state.faceDistance=cm!;state.faceAt=at;}});
  }
  snapshot(at:number,tracks:TrackView[]):LocalTrackDiagnostics[]{
    return tracks.flatMap(track=>{const s=this.states.get(track.key);if(!s||at-s.seen>750)return[];const cm=s.faceDistance!==null&&at-s.faceAt<=500?s.faceDistance:s.bodyDistance;
      return[{key:track.key,distance_cm:cm===null?null:Math.round(cm),distance_band:distanceBand(cm),speed_body_heights_s:Number.isFinite(s.speed)?Math.round(s.speed*100)/100:null,
        stopped:s.still&&s.stillStart!==null&&(at-s.stillStart)/1000>=STILL_MIN_S}];});
  }
  reset(){this.states.clear();this.lastBodyAt=-Infinity;}
}
