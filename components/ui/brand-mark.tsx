import { cn } from '@/lib/utils';

/** Original Gridcast vector mark, in the site's gold/ochre brand ramp. */
export function BrandMark({ className, label = '' }: { className?: string; label?: string }) {
  return <img src="/brand/gridcast-mark.svg" width={417} height={413} alt={label}
    className={cn('size-8 shrink-0 object-contain', className)} draggable={false} />;
}
