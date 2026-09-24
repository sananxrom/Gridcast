import React from 'react';
import {fmtDate} from '@/lib/utils';
export function CameraReadiness({screen,devices}:{screen:any;devices:any[]}) {
  const device=devices?.find(d=>d.screen_id===screen.id&&d.status!=='revoked'), v=device?.vision;
  const stale=v?.reported_at && Date.now()-Date.parse(v.reported_at)>5*60*1000;
  return <div className="text-xs text-muted-foreground"><p>{device?'Paired':'Not paired'} · Camera {screen.has_camera?'enabled':'disabled'}</p><p>{v?`Reported camera: ${v.camera_state} · Model: ${v.model_state}`:'Camera / model: not reported'}</p>{v&&<p>Last sample: {v.last_sample_at?fmtDate(v.last_sample_at):'not reported'}{stale?' · stale report':''}</p>}</div>;
}
