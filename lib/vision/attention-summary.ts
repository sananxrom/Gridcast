import { summaryForReceipt } from './production';
import type { PlaySummary } from './metrics';
/** Same pinned metric calculation as guided receipts, with explicit actual mode and no invented revision. */
export function summaryForAttentionMode(summary:PlaySummary, playingMs:number, mode:'default'|'guided', revision:string|null){
  const {calibration_revision:_discarded,...metrics}=summaryForReceipt(summary,playingMs,'');
  if(metrics.attention[0]===0){metrics.looking_person_ms=null;metrics.face_assessable_person_ms=null;metrics.longest_look_ms=null;}
  if(metrics.expression[0]===0){metrics.smile_person_ms=null;metrics.expression_assessable_person_ms=null;}
  return {...metrics,attention_mode:mode,calibration_revision:mode==='guided'?revision:null};
}
