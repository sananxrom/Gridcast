import {
  Search, LayoutDashboard, Inbox, Activity, Monitor, Layers, Users, Megaphone, Film,
  Wallet, Settings, Building2, CreditCard, UserCog, Terminal, Blocks, LogOut, User,
  ShieldCheck, HardDrive, FileBarChart,
} from 'lucide-react';
import type { NavGroupData, NavItemData } from '@/components/ui/sidebar-nav';

const settingsItem = (): NavItemData => ({
  id: 'settings', title: 'Settings', icon: Settings, shortcut: '⌘,',
  children: [
    { id: 'set-org', title: 'Organisation', icon: Building2 },
    { id: 'set-billing', title: 'Billing & payouts', icon: CreditCard, soon: true },
    { id: 'set-team', title: 'Team & users', icon: UserCog, soon: true },
    { id: 'set-api', title: 'API keys', icon: Terminal, soon: true },
    { id: 'set-hooks', title: 'Webhooks', icon: Blocks, soon: true },
  ],
});
const accountItems = (): NavItemData[] => [
  settingsItem(),
  { id: 'profile', title: 'Profile & account', icon: User },
  { id: 'logout', title: 'Log out', icon: LogOut },
];

export function operatorNav(badges: { inbox: number }): { groups: NavGroupData[]; bottom: NavItemData[] } {
  return {
    groups: [
      { items: [
        { id: 'search', title: 'Search', icon: Search, shortcut: '⌘K' },
        { id: 'overview', title: 'Overview', icon: LayoutDashboard },
        { id: 'inbox', title: 'Inbox', icon: Inbox, badge: badges.inbox },
        { id: 'analytics', title: 'Analytics', icon: Activity },
      ] },
      { heading: 'Network', items: [
        { id: 'screens', title: 'My screens', icon: Monitor },
        { id: 'groups', title: 'Screen groups', icon: Layers },
      ] },
      { heading: 'Sales', items: [
        { id: 'advertisers', title: 'Advertisers', icon: Users },
        { id: 'campaigns', title: 'Campaigns', icon: Megaphone },
        { id: 'creatives', title: 'Creatives', icon: Film },
      ] },
      { heading: 'Money', items: [
        { id: 'settlement', title: 'Settlement', icon: Wallet },
        { id: 'reports', title: 'Reports', icon: FileBarChart, soon: true },
      ] },
    ],
    bottom: accountItems(),
  };
}

export function adminNav(badges: { inbox: number; approvals: number }): { groups: NavGroupData[]; bottom: NavItemData[] } {
  return {
    groups: [
      { items: [
        { id: 'search', title: 'Search', icon: Search, shortcut: '⌘K' },
        { id: 'overview', title: 'Overview', icon: LayoutDashboard },
        { id: 'inbox', title: 'Inbox', icon: Inbox, badge: badges.inbox },
        { id: 'analytics', title: 'Analytics', icon: Activity },
      ] },
      { heading: 'Platform', items: [
        { id: 'orgs', title: 'Organisations', icon: Building2 },
        { id: 'screens', title: 'All screens', icon: Monitor },
        { id: 'devices', title: 'Device health', icon: HardDrive },
      ] },
      { heading: 'Demand', items: [
        { id: 'campaigns', title: 'Campaigns', icon: Megaphone },
        { id: 'approvals', title: 'Approvals', icon: ShieldCheck, badge: badges.approvals },
      ] },
      { heading: 'Developers', items: [
        { id: 'set-api', title: 'API keys', icon: Terminal, soon: true },
        { id: 'set-hooks', title: 'Webhooks', icon: Blocks, soon: true },
      ] },
    ],
    bottom: accountItems(),
  };
}

export function advertiserNav(): { groups: NavGroupData[]; bottom: NavItemData[] } {
  return {
    groups: [
      { items: [
        { id: 'search', title: 'Search', icon: Search, shortcut: '⌘K' },
        { id: 'overview', title: 'Delivery', icon: LayoutDashboard },
        { id: 'screens', title: 'Where it ran', icon: Monitor },
        { id: 'reports', title: 'Reports', icon: FileBarChart, soon: true },
      ] },
    ],
    bottom: [
      { id: 'profile', title: 'Profile & account', icon: User },
      { id: 'logout', title: 'Log out', icon: LogOut },
    ],
  };
}
