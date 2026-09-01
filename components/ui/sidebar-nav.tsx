'use client';
import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export type NavItemData = {
  id: string;
  title: string;
  icon: React.ElementType;
  badge?: number | string;
  shortcut?: string;
  soon?: boolean;
  children?: NavItemData[];
};
export type NavGroupData = { heading?: string; items: NavItemData[] };

export type OrgOption = { id: string; name: string; type: string };

function OrgSwitcher({ orgs, current, onSelect, collapsed }: {
  orgs: OrgOption[]; current: OrgOption; onSelect: (id: string) => void; collapsed: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (collapsed) {
    return (
      <div className="mb-4 flex justify-center">
        <div className="grid size-8 place-items-center rounded-md bg-primary text-[13px] font-semibold text-primary-foreground shadow-sm">
          {current.name.charAt(0)}
        </div>
      </div>
    );
  }
  return (
    <div className="relative">
      <div onClick={() => setOpen(!open)}
        className="group mb-4 flex cursor-pointer select-none items-center justify-between rounded-lg px-2 py-2 transition-colors hover:bg-black/5 dark:hover:bg-white/5">
        <div className="flex items-center gap-3 overflow-hidden">
          <div className="grid size-8 shrink-0 place-items-center rounded-md bg-primary text-[13px] font-semibold text-primary-foreground shadow-sm">
            {current.name.charAt(0)}
          </div>
          <div className="flex flex-col overflow-hidden">
            <span className="mb-1 max-w-[130px] truncate text-[13px] font-medium leading-none">{current.name}</span>
            <span className="text-[11px] leading-none text-muted-foreground">
              {current.type === 'gridcast' ? 'Platform' : 'Operator'}
            </span>
          </div>
        </div>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground/50 transition-colors group-hover:text-foreground/70" strokeWidth={1.5} />
      </div>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-[52px] z-50 flex w-full flex-col gap-0.5 rounded-lg border border-border/60 bg-card py-1 shadow-xl">
            {orgs.map(o => (
              <div key={o.id} onClick={() => { onSelect(o.id); setOpen(false); }}
                className={cn('mx-1 flex cursor-pointer items-center justify-between rounded-md px-3 py-2 text-[13px] transition-colors',
                  o.id === current.id ? 'bg-primary/10 font-medium text-primary' : 'text-foreground/80 hover:bg-black/5 dark:hover:bg-white/5')}>
                <span className="truncate">{o.name}</span>
                {o.id === current.id && <Check className="size-3.5 shrink-0" strokeWidth={2.5} />}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function NavItem({ item, activeId, onSelect, level = 0, collapsed }: {
  item: NavItemData; activeId: string; onSelect: (id: string) => void; level?: number; collapsed: boolean;
}) {
  const isActive = activeId === item.id || (item.children?.some(c => c.id === activeId) ?? false);
  const hasChildren = !!item.children;
  const [open, setOpen] = useState(item.children?.some(c => c.id === activeId) ?? false);

  if (collapsed) {
    return (
      <div title={item.title} onClick={() => !hasChildren && onSelect(item.id)}
        className={cn('mx-auto grid size-9 cursor-pointer place-items-center rounded-md transition-colors',
          activeId === item.id ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-black/5 hover:text-foreground dark:hover:bg-white/5')}>
        <item.icon className="size-[17px]" strokeWidth={1.5} />
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col">
      <div onClick={() => (hasChildren ? setOpen(!open) : onSelect(item.id))}
        style={{ paddingLeft: `${level * 12 + 10}px` }}
        className={cn('group flex cursor-pointer select-none items-center justify-between rounded-md py-[7px] pr-2.5 transition-all duration-200',
          activeId === item.id
            ? 'bg-black/5 font-medium text-foreground dark:bg-white/10'
            : 'text-muted-foreground hover:bg-black/5 hover:text-foreground/90 dark:hover:bg-white/5',
          isActive && activeId !== item.id && 'text-foreground/80')}>
        <div className="flex items-center gap-2.5 overflow-hidden">
          <item.icon className={cn('size-4 shrink-0 transition-colors',
            activeId === item.id ? 'text-primary' : 'text-muted-foreground/70 group-hover:text-foreground/70')} strokeWidth={1.5} />
          <span className="truncate text-[13px] tracking-wide">{item.title}</span>
          {item.soon && <span className="rounded bg-black/5 px-1 py-px text-[9px] font-medium uppercase tracking-wider text-muted-foreground/70 dark:bg-white/10">soon</span>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {item.shortcut && (
            <kbd className="hidden h-5 items-center justify-center rounded border border-border/60 bg-background/50 px-1.5 font-mono text-[10px] font-medium text-muted-foreground/60 group-hover:inline-flex">
              {item.shortcut}
            </kbd>
          )}
          {item.badge != null && item.badge !== 0 && (
            <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-primary/10 px-1.5 text-[10px] font-medium text-primary">
              {item.badge}
            </span>
          )}
          {hasChildren && (
            <ChevronRight className={cn('size-3.5 text-muted-foreground/50 transition-transform duration-200', open && 'rotate-90')} strokeWidth={2} />
          )}
        </div>
      </div>
      {hasChildren && (
        <div className={cn('grid transition-[grid-template-rows,opacity] duration-300 ease-in-out', open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0')}>
          <div className="relative mt-0.5 flex min-h-0 flex-col gap-0.5 overflow-hidden">
            <div className="absolute bottom-0 top-0 border-l border-black/5 dark:border-white/5" style={{ left: `${level * 12 + 17.5}px` }} />
            {item.children!.map(c => (
              <NavItem key={c.id} item={c} activeId={activeId} onSelect={onSelect} level={level + 1} collapsed={collapsed} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function SidebarNav({ groups, bottom, activeId, onSelect, orgs, currentOrg, onOrgSelect, collapsed }: {
  groups: NavGroupData[]; bottom: NavItemData[]; activeId: string; onSelect: (id: string) => void;
  orgs: OrgOption[]; currentOrg: OrgOption; onOrgSelect: (id: string) => void; collapsed: boolean;
}) {
  return (
    <div className={cn('flex h-full flex-col border-r border-border/60 bg-card/50 p-3', collapsed ? 'w-[64px]' : 'w-[260px]')}>
      <OrgSwitcher orgs={orgs} current={currentOrg} onSelect={onOrgSelect} collapsed={collapsed} />
      <div className="no-sb mt-2 flex flex-1 flex-col gap-4 overflow-y-auto">
        {groups.map((g, i) => (
          <div key={i} className="flex flex-col gap-0.5">
            {g.heading && !collapsed && (
              <span className="mb-1 px-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/50">{g.heading}</span>
            )}
            {g.heading && collapsed && <div className="mx-auto my-1 h-px w-6 bg-border" />}
            {g.items.map(it => <NavItem key={it.id} item={it} activeId={activeId} onSelect={onSelect} collapsed={collapsed} />)}
          </div>
        ))}
      </div>
      <div className="mt-auto flex flex-col gap-0.5 border-t border-border/60 pt-4">
        {bottom.map(it => <NavItem key={it.id} item={it} activeId={activeId} onSelect={onSelect} collapsed={collapsed} />)}
      </div>
    </div>
  );
}
