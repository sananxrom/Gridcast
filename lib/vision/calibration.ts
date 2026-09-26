import type { Observation } from './metrics';
const median = (values:number[]) => { const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.floor(sorted.length/2)]; };
/** Only offsets leave this short-lived sampler; no per-face samples are stored or exported. */
export class GazeCalibration {
  private samples: {at:number;yaw:number;pitch:number}[]=[];
  private multiple=false;
  constructor(private startedAt:number) {}
  observe(observation:Observation) {
    if (!Number.isFinite(observation.at) || observation.at<this.startedAt || observation.at>this.startedAt+3000 || !observation.faces?.ok) return;
    if (observation.faces.faces.length>1) this.multiple=true;
    const pose=observation.calibration;
    if (observation.faces.faces.length!==1 || !pose || !Number.isFinite(pose.yaw) || !Number.isFinite(pose.pitch)) return;
    if (this.samples.length && observation.at<=this.samples[this.samples.length-1].at) return;
    if (this.samples.length<64) this.samples.push({at:observation.at,yaw:pose.yaw,pitch:pose.pitch});
  }
  finish():{yaw:number;pitch:number} { const result=this.finishDetailed(); return {yaw:result.yaw,pitch:result.pitch}; }
  finishDetailed(){
    if (this.multiple) throw Error('More than one face was visible. Calibrate with one person in view. Previous calibration kept.');
    const s=this.samples;
    if (s.length<5 || s[s.length-1].at-s[0].at<1000) throw Error('Not enough clear face readings. Face the centre dot with your eyes open and try again. Previous calibration kept.');
    const yaw=median(s.map(v=>v.yaw)),pitch=median(s.map(v=>v.pitch));
    const spread=(key:'yaw'|'pitch')=>{const a=s.map(v=>v[key]).sort((a,b)=>a-b);return a[Math.floor((a.length-1)*.9)]-a[Math.floor((a.length-1)*.1)];};
    if (spread('yaw')>12 || spread('pitch')>10) throw Error('Face direction moved too much. Hold still, look at the centre dot and retry. Previous calibration kept.');
    if (Math.abs(yaw)>45 || Math.abs(pitch)>45) throw Error('Camera angle is too far off-centre. Reposition it and retry. Previous calibration kept.');
    return {yaw:Math.round(yaw*10)/10,pitch:Math.round(pitch*10)/10,samples:s.length,span_ms:Math.round(s[s.length-1].at-s[0].at),yaw_spread_tenths:Math.round(spread('yaw')*10),pitch_spread_tenths:Math.round(spread('pitch')*10)};
  }
}
