import { cn } from '@/lib/utils';

/** Original Gridcast vector mark in the site's solid gold. */
export function BrandMark({ className, label = '' }: { className?: string; label?: string }) {
  return <img src="/brand/gridcast-mark.svg?v=solid" width={417} height={413} alt={label}
    className={cn('size-8 shrink-0 object-contain', className)} draggable={false} />;
}

/** Consistent proportions wherever the mark sits beside the Gridcast wordmark. */
export function BrandLogo({ className, compact = false, suffix = '' }: { className?: string; compact?: boolean; suffix?: string }) {
  return <div className={cn('flex items-center gap-2.5', className)}>
    <BrandMark className={compact ? 'size-6' : 'size-7'} />
    <span className={cn('font-semibold leading-none tracking-tight', compact ? 'text-xl' : 'text-2xl')}>Gridcast{suffix}</span>
  </div>;
}
