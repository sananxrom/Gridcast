/**
 * Who can do what. Roles are coarse on purpose — a person should be able to
 * answer "what can Priya reach" by reading one word, not a grid of checkboxes.
 */

export type Cap =
  | 'screens'      // pair, edit, configure
  | 'sales'        // advertisers, campaigns, creatives
  | 'money'        // settlement, payouts, billing, tax identity
  | 'team'         // invite, change roles, disable
  | 'org'          // organisation profile
  | 'platform';    // Gridcast network administration

export type RoleDef = { id: string; label: string; hint: string; caps: Cap[] };

export const ROLES: RoleDef[] = [
  { id: 'owner', label: 'Owner', hint: 'Everything, including money and the team',
    caps: ['screens', 'sales', 'money', 'team', 'org'] },
  { id: 'manager', label: 'Manager', hint: 'Runs the day to day. No settlement, payouts or tax details',
    caps: ['screens', 'sales', 'team', 'org'] },
  { id: 'sales', label: 'Sales', hint: 'Advertisers, campaigns and creatives only',
    caps: ['sales'] },
  { id: 'installer', label: 'Installer', hint: 'Screens, configs and pairing. Sees no money',
    caps: ['screens'] },
];

export const PLATFORM_ADMIN = 'platform_admin';
export const ADVERTISER = 'advertiser_viewer';

const CAPS: Record<string, Cap[]> = {
  ...Object.fromEntries(ROLES.map(r => [r.id, r.caps])),
  // the pre-roles operator account is an owner
  org_admin: ['screens', 'sales', 'money', 'team', 'org'],
  [PLATFORM_ADMIN]: ['screens', 'sales', 'money', 'team', 'org', 'platform'],
  [ADVERTISER]: [],
};

export const can = (role: string | undefined, cap: Cap) => !!role && (CAPS[role] ?? []).includes(cap);

export const roleLabel = (role: string) =>
  role === PLATFORM_ADMIN ? 'Platform admin'
  : role === ADVERTISER ? 'Advertiser'
  : role === 'org_admin' ? 'Owner'
  : ROLES.find(r => r.id === role)?.label ?? role;

/** Which sign-in tab an account belongs to. */
export const tabFor = (role: string) =>
  role === PLATFORM_ADMIN ? 'platform' : role === ADVERTISER ? 'advertiser' : 'operator';

/** Roles one person may hand out — nobody can create someone above themselves. */
export function assignable(myRole: string): RoleDef[] {
  if (myRole === PLATFORM_ADMIN || myRole === 'owner' || myRole === 'org_admin') return ROLES;
  if (myRole === 'manager') return ROLES.filter(r => r.id !== 'owner');
  return [];
}

/** Where a role belongs after signing in. */
export const homeFor = (role: string) =>
  tabFor(role) === 'platform' ? '/admin' : tabFor(role) === 'advertiser' ? '/advertiser' : '/operator';
