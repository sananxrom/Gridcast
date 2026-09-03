'use client';
import * as React from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { Command as CommandPrimitive } from 'cmdk';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;

export function PopoverContent({ className, align = 'start', sideOffset = 4, ...props }:
  React.ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content align={align} sideOffset={sideOffset}
        className={cn(
          'z-50 rounded-lg border border-border bg-card p-0 text-foreground shadow-lg outline-none',
          'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
          className)}
        {...props} />
    </PopoverPrimitive.Portal>
  );
}

export type Choice = { value: string; label: string; hint?: string; dot?: string };

/**
 * A value you can change from wherever it is shown — the list row, a card, a
 * detail header. Renders as its current value until clicked.
 */
export function InlineSelect({
  value, choices, onChange, placeholder = 'Set…', className, children, disabled,
}: {
  value: string;
  choices: Choice[];
  onChange: (value: string) => Promise<void> | void;
  placeholder?: string;
  className?: string;
  /** Custom trigger content; defaults to the matching choice's label. */
  children?: React.ReactNode;
  disabled?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const current = choices.find(c => c.value === value);

  const pick = async (v: string) => {
    setOpen(false);
    if (v === value) return;
    setBusy(true);
    try { await onChange(v); } finally { setBusy(false); }
  };

  if (disabled) return <span className={className}>{children ?? current?.label ?? '—'}</span>;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" disabled={busy}
          className={cn('inline-flex max-w-full items-center gap-1 rounded-md px-1 py-0.5 -mx-1 text-left transition-colors hover:bg-muted disabled:opacity-50',
            open && 'bg-muted', className)}>
          {children ?? <span className="truncate">{current?.label ?? placeholder}</span>}
          <svg viewBox="0 0 12 12" className="size-2.5 shrink-0 text-muted-foreground/50" fill="none" stroke="currentColor" strokeWidth="1.6">
            <path d="M3 4.5 6 7.5 9 4.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-56">
        <CommandPrimitive className="overflow-hidden rounded-lg">
          {choices.length > 6 && (
            <div className="border-b border-border px-2.5">
              <CommandPrimitive.Input placeholder={placeholder}
                className="h-9 w-full bg-transparent text-[13px] outline-none placeholder:text-muted-foreground/60" />
            </div>
          )}
          <CommandPrimitive.List className="max-h-[260px] overflow-y-auto p-1">
            <CommandPrimitive.Empty className="px-2 py-6 text-center text-[12.5px] text-muted-foreground">No match.</CommandPrimitive.Empty>
            {choices.map(c => (
              <CommandPrimitive.Item key={c.value} value={`${c.label} ${c.value}`} onSelect={() => pick(c.value)}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[13px] outline-none data-[selected=true]:bg-muted">
                {c.dot && <span className="size-1.5 shrink-0 rounded-full" style={{ background: c.dot }} />}
                <span className="flex-1 truncate">{c.label}</span>
                {c.hint && <span className="text-[11.5px] text-muted-foreground">{c.hint}</span>}
                {c.value === value && <Check className="size-3.5 shrink-0 text-primary" />}
              </CommandPrimitive.Item>
            ))}
          </CommandPrimitive.List>
        </CommandPrimitive>
      </PopoverContent>
    </Popover>
  );
}
