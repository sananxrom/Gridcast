'use client';
import React, { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/client';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Select } from '@/components/ui/input';

type Device = { id: string; status: string; paired_at?: string; revoked_at?: string };
type Grant = { id: string; device_id: string; screen_id: string; org_id: string; status: string; expires_at: string };
type Issued = { grant: Grant; code: string };
const validUntil = (grant: Grant, now: number) => Number.isFinite(Date.parse(grant.expires_at)) && Date.parse(grant.expires_at) > now;
const openGrant = (grant: Grant, now: number) => ['pending', 'active'].includes(grant.status) && validUntil(grant, now);
const when = (value: string) => Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : 'Unknown';

// Keyed by screen in ScreenDetail so a navigation never renders another screen's code.
export function ScreenMaintenance({ screenId }: { screenId: string }) {
  const [devices, setDevices] = useState<Device[]>([]), [grants, setGrants] = useState<Grant[]>([]);
  const [selected, setSelected] = useState(''), [issued, setIssued] = useState<Issued | null>(null);
  const [ready, setReady] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());
  const epoch = useRef(0), active = useRef(false), operation = useRef(false);
  const path = `/screens/${encodeURIComponent(screenId)}/maintenance`;

  async function refresh(generation: number) {
    const result = await api<{ devices: Device[]; grants: Grant[] }>(path, undefined, { quiet: true });
    if (!active.current || epoch.current !== generation) return;
    if (!Array.isArray(result.devices) || !Array.isArray(result.grants)) throw new Error('Maintenance details are unavailable. Refresh before issuing access.');
    setDevices(result.devices); setGrants(result.grants); setReady(true);
    setSelected(value => result.devices.some(device => device.id === value) ? value : '');
    setIssued(value => value && result.grants.some(grant => grant.id === value.grant.id && grant.status === 'pending' && validUntil(grant, Date.now())) ? value : null);
  }
  function failed(reason: unknown, generation: number) {
    if (!active.current || epoch.current !== generation) return;
    setError(reason instanceof Error ? reason.message : 'Maintenance access could not be checked. Try again.');
    setReady(false); setIssued(null); setGrants([]); setDevices([]);
  }
  useEffect(() => {
    active.current = true; const generation = ++epoch.current;
    setSelected(''); setIssued(null); setReady(false); setError(''); setDevices([]); setGrants([]);
    refresh(generation).catch(reason => failed(reason, generation));
    const timer = setInterval(() => {
      setNow(Date.now());
      setIssued(value => value && validUntil(value.grant, Date.now()) ? value : null);
    }, 1000);
    const poll = setInterval(() => { if (!operation.current) refresh(generation).catch(reason => failed(reason, generation)); }, 10000);
    return () => { active.current = false; ++epoch.current; clearInterval(timer); clearInterval(poll); };
    // The parent also keys this component by screen identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screenId]);

  async function issue() {
    if (!ready || operation.current || !devices.some(device => device.id === selected)) return;
    operation.current = true; setBusy(true); setError(''); setIssued(null);
    const generation = epoch.current, deviceId = selected;
    try {
      const result = await api<Issued>(path, { device_id: deviceId });
      if (!active.current || epoch.current !== generation) return;
      if (!result.grant?.id || result.grant.device_id !== deviceId || result.grant.screen_id !== screenId || !result.code?.trim() || !validUntil(result.grant, Date.now())) {
        throw new Error('The code response was incomplete. Access may have been created; refresh and revoke it before trying again.');
      }
      setIssued(result); await refresh(generation);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Could not create access.';
      failed(new Error(`${message} If creation reached the server, a grant may exist. Retry maintenance access to check before creating another.`), generation);
    } finally {
      operation.current = false;
      if (active.current && epoch.current === generation) setBusy(false);
    }
  }
  async function revoke(grant: Grant) {
    if (!ready || operation.current) return;
    operation.current = true; setBusy(true); setError('');
    const generation = epoch.current;
    try {
      await api(`${path}/${encodeURIComponent(grant.id)}/revoke`, {});
      if (!active.current || epoch.current !== generation) return;
      setIssued(value => value?.grant.id === grant.id ? null : value);
      await refresh(generation);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Could not revoke access.';
      failed(new Error(`${message} Revocation could not be confirmed. Access may remain active until expiry; retry to check.`), generation);
    } finally {
      operation.current = false;
      if (active.current && epoch.current === generation) setBusy(false);
    }
  }
  async function retry() {
    if (operation.current) return;
    const generation = epoch.current; setError('');
    try { await refresh(generation); } catch (reason) { failed(reason, generation); }
  }

  const secret = issued && issued.grant.device_id === selected && validUntil(issued.grant, now) ? issued : null;
  return <Card className="mb-4 space-y-3 p-4" aria-label="Player maintenance">
    <h3 className="font-semibold">Saved records and player maintenance</h3>
    <p className="text-sm text-muted-foreground">Authorize access to records saved in one player browser. Select the exact device identity, including an older unpaired device when recovering its records. This does not authorize playback or accept records for billing.</p>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {!ready && <div className="flex items-center gap-3"><p className="text-sm">{error ? 'Maintenance access is unavailable until permissions and connection can be checked.' : 'Checking maintenance access…'}</p>{error && <Button size="sm" variant="outline" onClick={retry}>Retry maintenance access</Button>}</div>}
    {ready && <>
      {devices.length ? <div className="space-y-2">
        <label htmlFor={`maintenance-device-${screenId}`} className="block text-sm font-medium">Device identity to authorize</label>
        <Select id={`maintenance-device-${screenId}`} value={selected} disabled={busy} onChange={event => { setSelected(event.target.value); setIssued(null); }}>
          <option value="">Choose a device identity</option>
          {devices.map(device => <option key={device.id} value={device.id}>{device.id} · {device.status === 'revoked' ? 'Historical / unpaired' : device.status}{device.paired_at ? ` · paired ${when(device.paired_at)}` : ''}</option>)}
        </Select>
        {devices.find(device => device.id === selected)?.status === 'revoked' && <p className="text-sm text-muted-foreground">Historical recovery only. Open maintenance in the browser that still holds this device’s saved records. The old playback credential remains revoked.</p>}
        <Button disabled={busy || !selected} onClick={issue}>{busy ? 'Working…' : 'Create maintenance code'}</Button>
      </div> : <p className="text-sm">No device identities are available for this screen yet.</p>}
      {secret && <div className="space-y-2 rounded-lg border border-primary/30 bg-primary/5 p-3" aria-label="Maintenance code">
        <p className="text-sm font-medium">One-time code for {secret.grant.device_id}</p>
        <p className="select-all break-all font-mono text-lg tracking-wide">{secret.code}</p>
        <p className="text-sm">Expires {when(secret.grant.expires_at)}. The tools close at this same deadline, even if the code is entered later.</p>
        <p className="text-sm">In the player’s browser, open <a className="text-primary underline" href="/player/maintenance" target="_blank" rel="noreferrer">/player/maintenance</a> and enter this code. Keep your dashboard login on your own device.</p>
        <p className="text-xs text-muted-foreground">The authorization window is at most 10 minutes. This code is shown only now; refreshing the dashboard hides it. Sharing it gives access to this identity’s locally saved records. Downloading records does not delete them or guarantee an accepted delivery.</p>
      </div>}
      {grants.length > 0 && <div className="space-y-2 border-t pt-3"><h4 className="text-sm font-medium">Maintenance access</h4>{grants.map(grant => <div key={grant.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <p className="break-all">{grant.device_id} · {openGrant(grant, now) ? grant.status === 'pending' ? 'Code awaiting use' : 'Tools open' : ['pending', 'active'].includes(grant.status) ? 'Expired' : grant.status} · ends {when(grant.expires_at)}</p>
        {openGrant(grant, now) && <Button size="sm" variant="outline" disabled={busy} onClick={() => revoke(grant)} aria-label={`Revoke maintenance access for ${grant.device_id}`}>Revoke access</Button>}
      </div>)}</div>}
    </>}
  </Card>;
}
