import { cn } from '@/lib/utils';
import { Card } from './card';

export function Stat({ label, value, hint, className }: { label: string; value: React.ReactNode; hint?: React.ReactNode; className?: string }) {
  return (
    <Card className={cn('p-4', className)}>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">{label}</div>
      <div className="mt-1.5 text-[26px] font-semibold tracking-tight tnum leading-none">{value}</div>
      {hint && <div className="mt-1.5 text-[12px] text-muted-foreground">{hint}</div>}
    </Card>
  );
}

export function Progress({ value, hot, className }: { value: number; hot?: boolean; className?: string }) {
  const v = Math.max(0, Math.min(100, value || 0));
  return (
    <div className={cn('h-1.5 w-full min-w-[64px] rounded-full bg-black/5 dark:bg-white/10 overflow-hidden', className)}>
      <div className={cn('h-full rounded-full transition-all', hot ? 'bg-onair' : 'bg-primary')} style={{ width: `${v}%` }} />
    </div>
  );
}
