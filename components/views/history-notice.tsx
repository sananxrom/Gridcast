'use client';
import {Card} from '@/components/ui/card';
export function HistoryNotice({history}:{history:any}) {
  if(!history)return null;
  const limited=history.complete===false||history.truncated===true;
  const demo=history.scope==='local_demo';
  if(!limited&&!demo)return null;
  return <Card className="mb-4 border-primary/25 bg-primary/[0.04] px-4 py-3 text-sm" role="note">
    {limited?<><b>Recent records only.</b> Counts and averages on this page cover the loaded records, not complete historical delivery. Campaign budgets and accrued spend may include earlier activity.</>:<><b>Local demo data.</b> Sample records are synthetic and are not evidence of advertising delivery.</>}
    <p className="mt-1 text-xs text-muted-foreground">Play reports can include incomplete or non-billable playback. Presence counts describe average people in frame; they do not establish unique viewers.</p>
  </Card>;
}
