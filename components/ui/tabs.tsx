'use client';
import * as React from 'react';
import { cn } from '@/lib/utils';

export type TabItem = { id: string; label: React.ReactNode };

/** Accessible tab list: roving tabindex, Left/Right/Home/End keys, scrolls horizontally on narrow screens. */
export function TabList({ tabs, value, onChange, label, idBase, className }: {
  tabs: TabItem[]; value: string; onChange: (id: string) => void; label: string; idBase: string; className?: string;
}) {
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const onKeyDown = (event: React.KeyboardEvent, index: number) => {
    const last = tabs.length - 1;
    const next = event.key === 'ArrowRight' ? (index === last ? 0 : index + 1)
      : event.key === 'ArrowLeft' ? (index === 0 ? last : index - 1)
      : event.key === 'Home' ? 0 : event.key === 'End' ? last : -1;
    if (next < 0) return;
    event.preventDefault();
    onChange(tabs[next].id);
    refs.current[next]?.focus();
  };
  return (
    <div role="tablist" aria-label={label} aria-orientation="horizontal" className={cn('no-sb flex overflow-x-auto border-b border-border', className)}>
      {tabs.map((tab, index) => {
        const selected = tab.id === value;
        return (
          <button key={tab.id} ref={el => { refs.current[index] = el; }} type="button" role="tab"
            id={`${idBase}-tab-${tab.id}`} aria-selected={selected} aria-controls={selected ? `${idBase}-panel-${tab.id}` : undefined}
            tabIndex={selected ? 0 : -1} onClick={() => onChange(tab.id)} onKeyDown={event => onKeyDown(event, index)}
            className={cn('-mb-px shrink-0 whitespace-nowrap rounded-t-md border-b-2 px-3 py-2 text-[13px] font-medium transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
              selected ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}>
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

/** The panel for the selected tab. Render only the active panel so hidden tabs do not mount their content. */
export function TabPanel({ idBase, id, className, children }: { idBase: string; id: string; className?: string; children: React.ReactNode }) {
  return <div role="tabpanel" id={`${idBase}-panel-${id}`} aria-labelledby={`${idBase}-tab-${id}`} tabIndex={0} className={cn('pt-4 focus-visible:outline-none', className)}>{children}</div>;
}
