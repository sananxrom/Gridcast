import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors whitespace-nowrap',
  {
    variants: {
      variant: {
        default: 'bg-primary/10 text-primary',
        muted: 'bg-black/5 dark:bg-white/10 text-muted-foreground',
        // solid, because with one accent hue a live screen has to separate
        // from every other warm pill by weight rather than colour
        onair: 'bg-onair text-onair-foreground shadow-sm',
        ok: 'bg-ok/12 text-ok ring-1 ring-inset ring-ok/25',
        warn: 'bg-warn/12 text-warn',
        destructive: 'bg-destructive/10 text-destructive',
        outline: 'border border-border/70 text-muted-foreground',
      },
    },
    defaultVariants: { variant: 'muted' },
  }
);

export function Badge({ className, variant, blip, children, ...props }:
  React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants> & { blip?: boolean }) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props}>
      {blip && <span className="size-1.5 rounded-full bg-current animate-blip" />}
      {children}
    </span>
  );
}
export { badgeVariants };
