/** Public readiness vocabulary; safe for an unattended paired player. */
const REASONS: Record<string, string> = {
  eligible: 'Ready to play',
  no_campaign: 'No campaign is assigned to this screen.',
  no_creative: 'Assigned campaigns have no creative yet.',
  screen_not_targeted: 'This screen is not selected for delivery.',
  screen_not_active: 'This screen is paused or inactive.',
  campaign_not_active: 'Assigned campaigns are not active.',
  campaign_dates_invalid: 'Campaign dates need correcting.',
  outside_campaign_dates: 'Outside the campaign dates.',
  outside_operating_hours: 'Outside the screen’s operating hours.',
  operating_hours_invalid: 'Screen operating hours need correcting.',
  outside_campaign_daypart: 'Outside the campaign’s daily delivery window.',
  campaign_daypart_invalid: 'The campaign’s daily window needs correcting.',
  creative_not_approved: 'An assigned creative is missing or awaiting approval.',
  advertiser_archived: 'The advertiser is archived.',
  platform_category_block: 'Content is blocked by platform policy.',
  screen_category_block: 'Content category is blocked on this screen.',
  screen_advertiser_block: 'The advertiser is blocked on this screen.',
  advertiser_venue_block: 'The advertiser excludes this venue.',
  competitive_separation: 'Competing advertisers cannot share this loop.',
  screen_aspect_invalid: 'Screen orientation or aspect needs correcting.',
  no_playable_asset: 'No playable video is available.',
  budget_exhausted_manual_action: 'Budget reached. Delivery continues until manually paused.',
  budget_80_percent: 'At least 80% of the agreed budget has been used.',
  operating_window_unconfigured: 'Operating hours do not specify a daily window.',
  unavailable: 'Delivery is not ready. Check the screen’s readiness details.',
};
export function reasonLabel(code: unknown): string { return REASONS[String(code)] || REASONS.unavailable; }
export type Readiness = { ready: boolean; code: string; message: string; warnings: string[] };
export function summarizeReadiness(screen: any, campaigns: any[], decisions: any[], itemCount: number): Readiness {
  const targeted = campaigns.filter(c => c.screen_ids?.includes(screen.id));
  const warnings = [...new Set<string>(decisions.flatMap(d => Array.isArray(d.warnings) ? d.warnings : []))]
    .filter(code => ['budget_exhausted_manual_action', 'budget_80_percent', 'operating_window_unconfigured'].includes(code));
  const code = screen.status !== 'active' ? 'screen_not_active'
    : !targeted.length ? 'no_campaign'
    : !targeted.some(c => c.creative_ids?.length) ? 'no_creative'
    : itemCount > 0 ? 'eligible'
    : decisions.find(d => !d.eligible && Object.hasOwn(REASONS, d.reason))?.reason || 'unavailable';
  // Commercial warnings stay on authenticated management surfaces, not the public player.
  return { ready: code === 'eligible', code, message: reasonLabel(code), warnings };
}
export function playerReadiness(value: unknown): Omit<Readiness, 'warnings'> | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const code = String((value as Readiness).code);
  const safe = Object.hasOwn(REASONS, code) && !code.startsWith('budget_') ? code : 'unavailable';
  return { ready: safe === 'eligible', code: safe, message: reasonLabel(safe) };
}
