'use client';
import { DataTable } from '@/components/ui/table';
import { Card } from '@/components/ui/card';

const rupees=(paise:number)=>'₹'+(paise/100).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
export function Settlement({buckets=[],campaigns=[],screens=[]}:{buckets?:any[];campaigns?:any[];screens?:any[]}) {
  const name=(rows:any[],id:string)=>rows.find(row=>row.id===id)?.name??id;
  return <>
    <DataTable rows={buckets} rowId={(r:any)=>r.id} exportName="verified-settlement" empty="No verified settlement yet. Billable per-play receipts will appear here."
      cols={[
        {label:'Campaign / screen',render:(r:any)=><><div className="font-medium">{name(campaigns,r.campaign_id)}</div><div className="text-xs text-muted-foreground">{name(screens,r.screen_id)}</div></>},
        {label:'Delivery month',render:(r:any)=>r.period},
        {label:'Billable plays',num:true,render:(r:any)=>r.billable_plays.toLocaleString('en-IN')},
        {label:'Gross',num:true,render:(r:any)=>rupees(r.gross_paise)},
        {label:'Platform fee',num:true,render:(r:any)=><><span>{rupees(r.fee_paise)}</span><div className="text-xs text-muted-foreground">{r.platform_fee_pct}% · {r.fee_basis==='net_of_owner_share'?'after owner share':'of gross'}</div></>},
        {label:'Screen owner',num:true,render:(r:any)=><><span>{rupees(r.owner_paise)}</span><div className="text-xs text-muted-foreground">{r.owner_share_pct}%</div></>},
        {label:'Operator net',num:true,render:(r:any)=><b>{rupees(r.net_paise)}</b>},
        {label:'Agreed terms',render:(r:any)=><span className="text-xs text-muted-foreground">Rate: {r.rate_version}<br/>Fee: {r.fee_version}<br/>Terms: {r.econ_version}</span>},
      ]}/>
    <Card className="mt-3 p-3.5 text-xs text-muted-foreground">Verified per-play settlement, grouped by screen, delivery month and agreed terms. Gross equals platform fee + screen owner share + operator net. Late reports are added to the month they played. Historical records without frozen terms and flat-rate commitments are not estimated here.</Card>
  </>;
}
