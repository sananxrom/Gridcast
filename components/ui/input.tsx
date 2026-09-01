import * as React from 'react';
import { cn } from '@/lib/utils';

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => (
    <input type={type} ref={ref}
      className={cn('flex h-9 w-full rounded-md border border-input bg-card px-3 py-1 text-[13px] shadow-xs transition-colors placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-ring disabled:opacity-50', className)}
      {...props} />
  )
);
Input.displayName = 'Input';

const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, ...props }, ref) => (
    <select ref={ref}
      className={cn('flex h-9 w-full rounded-md border border-input bg-card px-3 py-1 text-[13px] shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', className)}
      {...props} />
  )
);
Select.displayName = 'Select';

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn('block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70 mb-1.5', className)} {...props} />;
}
export function Field({ label, children, className }: { label?: string; children: React.ReactNode; className?: string }) {
  return <div className={cn('flex-1 min-w-[140px]', className)}>{label && <Label>{label}</Label>}{children}</div>;
}
export { Input, Select };
