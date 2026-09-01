import { api, table, stat, pill, bar, inr, esc, $ } from '/assets/app.js';

export const ytId = (u) => {
  const s = String(u || '').trim();
  const m = s.match(/(?:youtu\.be\/|v=|embed\/|shorts\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : (/^[A-Za-z0-9_-]{11}$/.test(s) ? s : null);
};
const days = (a, b) => Math.max(1, Math.round((new Date(b) - new Date(a)) / 86400000));

/* ---------------- detail ---------------- */
export async function renderDetail(id, canEdit) {
  const d = await api('/campaign/' + id);
  const c = d.campaign;
  const pct = c.committed_budget ? Math.round(c.accrued_spend / c.committed_budget * 100) : 0;
  const rate = c.rate_type === 'flat'
    ? `${inr(c.committed_budget)} flat · ${days(c.starts_at, c.ends_at)} days`
    : `${inr(c.rate_value)} per play`;

  return `
  <div class="phead">
    <div>
      <a href="#campaigns" class="t-sub" style="font-size:12.5px">← Campaigns</a>
      <h1 style="margin-top:4px">${esc(c.name)}</h1>
      <p class="sub">${esc(d.advertiser?.name || '—')} · ${esc(d.org?.name || '')} ·
        <span class="mono">${c.starts_at} → ${c.ends_at}</span></p>
    </div>
    <div style="display:flex;gap:8px;align-items:center">
      ${pill(c.status === 'active' ? 'p-ok' : 'p-off', c.status)}
      ${canEdit ? `<button class="btn ghost sm" data-toggle="${c.id}" data-to="${c.status === 'active' ? 'paused' : 'active'}">
        ${c.status === 'active' ? 'Pause' : 'Resume'}</button>` : ''}
    </div>
  </div>

  <div class="grid g4">
    ${stat('Plays delivered', d.totals.plays.toLocaleString('en-IN'), `across ${d.byScreen.length} screen${d.byScreen.length === 1 ? '' : 's'}`)}
    ${stat('Avg people / play', d.totals.avg === null ? '—' : d.totals.avg.toFixed(1), 'while the ad was on screen')}
    ${stat('Measured', `${d.totals.measured}<span style="font-size:15px;color:var(--ink-3)"> / ${d.totals.plays}</span>`, 'plays with a working camera')}
    ${stat('Spend', inr(c.accrued_spend), `of ${inr(c.committed_budget)} · ${rate}`)}
  </div>
  <div style="margin:10px 0 0">${bar(pct, pct >= 80)}</div>

  <h2>Per-screen delivery</h2>
  ${table([
    { label:'Screen', render:r => `<span class="t-main">${esc(r.screen.name)}</span><br><span class="t-sub">${esc(r.screen.address)}</span>` },
    { label:'Venue', render:r => `${pill('p-off', r.screen.venue_type)} <span class="t-sub">${r.screen.size_in}"</span>` },
    { label:'Plays', num:true, render:r => r.plays },
    { label:'Share', num:true, render:r => { const p = d.totals.plays ? Math.round(r.plays / d.totals.plays * 100) : 0;
      return `${p}%${bar(p)}`; } },
    { label:'Avg people', num:true, render:r => r.avg === null ? '<span class="t-sub">—</span>' : `<strong>${r.avg.toFixed(1)}</strong>` },
    { label:'Measured', num:true, render:r => `<span class="t-sub">${r.measured}/${r.plays}</span>` }
  ], d.byScreen, 'No screens on this campaign')}

  <h2>Per-creative performance</h2>
  ${table([
    { label:'Creative', render:r => `<span class="t-main">${esc(r.creative.name)}</span><br><span class="t-sub mono">yt:${esc(r.creative.youtube_id)} · ${r.creative.duration_s}s</span>` },
    { label:'Approval', render:r => r.creative.approval_status === 'approved' ? pill('p-ok','approved')
        : r.creative.approval_status === 'rejected' ? pill('p-bad','rejected') : pill('p-warn','pending') },
    { label:'Plays', num:true, render:r => r.plays },
    { label:'Avg people', num:true, render:r => r.avg === null ? '<span class="t-sub">—</span>' : `<strong>${r.avg.toFixed(1)}</strong>` }
  ], d.byCreative, 'No creatives on this campaign')}

  <h2>Play log <span class="t-sub" style="font-weight:400">· every play, auditable</span></h2>
  ${table([
    { label:'When', render:p => `<span class="mono t-sub">${new Date(p.ended_at).toLocaleString('en-IN',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',second:'2-digit'})}</span>` },
    { label:'Screen', render:p => esc((d.byScreen.find(s => s.screen.id === p.screen_id)?.screen.name) || '—') },
    { label:'Creative', render:p => esc((d.byCreative.find(c2 => c2.creative.id === p.creative_id)?.creative.name) || '—') },
    { label:'Duration', num:true, render:p => `${Math.round(p.duration_ms/1000)}s` },
    { label:'People present', num:true, render:p => p.presence && p.presence.measured
        ? `<strong>${p.presence.avg_persons.toFixed(1)}</strong> <span class="t-sub">(${p.presence.sample_count} samples)</span>`
        : '<span class="t-sub">not measured</span>' }
  ], d.plays, 'No plays recorded yet — pair a player to one of these screens')}`;
}

/* ---------------- builder ---------------- */
export function builderHTML(d) {
  const today = new Date().toISOString().slice(0,10);
  const end = new Date(Date.now() + 30*86400000).toISOString().slice(0,10);
  return `
  <div class="phead"><div><a href="#campaigns" class="t-sub" style="font-size:12.5px">← Campaigns</a>
    <h1 style="margin-top:4px">New campaign</h1>
    <p class="sub">Budget is entered manually — the platform records what was agreed, it does not take payment.</p></div></div>

  <div class="card" style="margin-bottom:14px">
    <h3 style="margin:0 0 12px;font-size:14px">1 · Client &amp; dates</h3>
    <div class="row">
      <div class="field"><label>Advertiser</label>
        <select id="f_adv">${d.advertisers.map(a => `<option value="${a.id}">${esc(a.name)}</option>`).join('')}
        <option value="__new">+ New advertiser…</option></select></div>
      <div class="field"><label>Campaign name</label><input id="f_name" placeholder="Fitline — Oct push"></div>
    </div>
    <div id="newadv"></div>
    <div class="row">
      <div class="field"><label>Starts</label><input type="date" id="f_start" value="${today}"></div>
      <div class="field"><label>Ends</label><input type="date" id="f_end" value="${end}"></div>
    </div>
  </div>

  <div class="card" style="margin-bottom:14px">
    <h3 style="margin:0 0 12px;font-size:14px">2 · Rate &amp; budget</h3>
    <div class="row">
      <div class="field"><label>Rate type</label>
        <select id="f_rtype"><option value="per_play">Per play</option><option value="flat">Flat fee</option></select></div>
      <div class="field" id="w_rval"><label>Rate per play (₹)</label><input type="number" step="0.01" id="f_rval" value="0.93"></div>
      <div class="field"><label>Committed budget (₹)</label><input type="number" id="f_budget" value="12000"></div>
    </div>
    <p class="t-sub" id="rate_hint" style="margin:0"></p>
  </div>

  <div class="card" style="margin-bottom:14px">
    <h3 style="margin:0 0 12px;font-size:14px">3 · Screens</h3>
    ${d.groups?.length ? `<div class="field"><label>Quick select by group</label>
      <div class="row" style="gap:6px">${d.groups.map(g =>
        `<button class="btn ghost sm" data-grp="${g.id}" style="flex:0 0 auto">${esc(g.name)}
         <span class="t-sub">${g.group_type}</span></button>`).join('')}
        <button class="btn ghost sm" data-grp="__none" style="flex:0 0 auto">Clear</button></div></div>` : ''}
    <div class="tw" style="box-shadow:none"><table><thead><tr>
      <th style="width:36px"></th><th>Screen</th><th>Venue</th><th class="num">Slots/loop</th><th class="num">Price / slot / mo</th>
    </tr></thead><tbody>
      ${d.screens.map(s => `<tr><td><input type="checkbox" class="scr" value="${s.id}" data-price="${s.slot_price_month}" style="width:auto"></td>
        <td><span class="t-main">${esc(s.name)}</span><br><span class="t-sub">${esc(s.address)}</span></td>
        <td>${pill('p-off', s.venue_type)} <span class="t-sub">${s.size_in}"</span></td>
        <td class="num">${s.advertiser_slots}</td>
        <td class="num">${inr(s.slot_price_month)}</td></tr>`).join('')}
    </tbody></table></div>
    <p class="t-sub" style="margin:10px 0 0" id="scr_sum">No screens selected</p>
  </div>

  <div class="card" style="margin-bottom:14px">
    <h3 style="margin:0 0 12px;font-size:14px">4 · Creatives</h3>
    <div class="field"><label>Add a new one — paste a YouTube URL</label>
      <div class="row"><input id="f_yt" placeholder="https://youtube.com/watch?v=…" style="flex:3">
        <input id="f_ytname" placeholder="Creative name" style="flex:2">
        <input id="f_ytdur" type="number" value="10" placeholder="secs" style="flex:0 0 90px">
        <button class="btn ghost" id="addcr" style="flex:0 0 auto">Add</button></div>
      <p class="t-sub" id="yt_err" style="margin:6px 0 0"></p></div>
    <label>Use existing</label>
    <div id="crlist"></div>
    <p class="t-sub" style="margin:10px 0 0">New creatives start as <em>pending</em> and must be approved before they play.</p>
  </div>

  <div style="display:flex;gap:10px;align-items:center">
    <button class="btn" id="savecmp">Create campaign</button>
    <a class="btn ghost" href="#campaigns">Cancel</a>
    <span class="t-sub" id="save_err"></span>
  </div>`;
}

export function wireBuilder(d, user, onDone) {
  const sel = () => [...document.querySelectorAll('.scr:checked')];
  const advId = () => $('#f_adv').value;

  const drawCreatives = () => {
    const list = d.creatives.filter(c => c.advertiser_id === advId());
    $('#crlist').innerHTML = list.length
      ? list.map(c => `<label style="display:flex;gap:9px;align-items:center;text-transform:none;
          letter-spacing:0;font-size:13.5px;color:var(--ink);font-weight:400;padding:5px 0">
          <input type="checkbox" class="cr" value="${c.id}" style="width:auto">
          <span>${esc(c.name)} <span class="t-sub mono">yt:${esc(c.youtube_id)} · ${c.duration_s}s</span>
          ${c.approval_status !== 'approved' ? pill('p-warn', c.approval_status) : ''}</span></label>`).join('')
      : '<p class="t-sub" style="margin:0">No creatives yet for this advertiser — add one above.</p>';
  };
  const sum = () => {
    const s = sel();
    const total = s.reduce((a, b) => a + Number(b.dataset.price), 0);
    $('#scr_sum').innerHTML = s.length
      ? `<strong>${s.length}</strong> screen${s.length === 1 ? '' : 's'} selected · combined list price
         <strong>${inr(total)}</strong> / month at one slot each`
      : 'No screens selected';
  };
  const rateHint = () => {
    const t = $('#f_rtype').value;
    $('#w_rval').style.display = t === 'flat' ? 'none' : '';
    $('#rate_hint').textContent = t === 'flat'
      ? 'Flat fee: spend accrues evenly across the campaign dates.'
      : 'Per play: spend accrues each time a creative plays. Budget is a cap you are alerted at, not an automatic stop.';
  };

  $('#f_adv').onchange = () => {
    $('#newadv').innerHTML = advId() === '__new'
      ? `<div class="row"><div class="field"><label>New advertiser name</label><input id="f_advnew" placeholder="Acme Motors"></div>
         <div class="field"><label>Contact</label><input id="f_advc" placeholder="Rahul"></div></div>` : '';
    drawCreatives();
  };
  $('#f_rtype').onchange = rateHint;
  document.addEventListener('change', e => { if (e.target.classList.contains('scr')) sum(); });

  document.querySelectorAll('[data-grp]').forEach(b => b.onclick = async () => {
    const id = b.dataset.grp;
    if (id === '__none') { document.querySelectorAll('.scr').forEach(c => c.checked = false); return sum(); }
    const r = await api('/group/resolve', { org_id: user.org_id, group_id: id });
    document.querySelectorAll('.scr').forEach(c => { if (r.screen_ids.includes(c.value)) c.checked = true; });
    sum();
  });

  $('#addcr').onclick = async () => {
    const id = ytId($('#f_yt').value);
    if (!id) { $('#yt_err').textContent = 'That does not look like a YouTube URL or video ID.'; return; }
    if (advId() === '__new') { $('#yt_err').textContent = 'Save the new advertiser first — pick an existing one, or create the campaign and add creatives after.'; return; }
    $('#yt_err').textContent = '';
    const cr = await api('/creative', { org_id: user.org_id, advertiser_id: advId(),
      name: $('#f_ytname').value || 'Untitled creative', category: 'general',
      youtube_id: id, duration_s: Number($('#f_ytdur').value) || 10, aspect: '16:9' });
    d.creatives.push(cr); drawCreatives();
    $('#f_yt').value = ''; $('#f_ytname').value = '';
  };

  $('#savecmp').onclick = async () => {
    const err = $('#save_err'); err.textContent = '';
    let adv = advId();
    if (adv === '__new') {
      const name = $('#f_advnew')?.value?.trim();
      if (!name) { err.textContent = 'Enter the new advertiser name.'; return; }
      const a = await api('/advertiser', { org_id: user.org_id, name, contact: $('#f_advc')?.value || '', category: 'general' });
      d.advertisers.push(a); adv = a.id;
    }
    const screen_ids = sel().map(x => x.value);
    const creative_ids = [...document.querySelectorAll('.cr:checked')].map(x => x.value);
    if (!screen_ids.length) { err.textContent = 'Pick at least one screen.'; return; }
    if (!creative_ids.length) { err.textContent = 'Pick or add at least one creative.'; return; }
    const rate_type = $('#f_rtype').value;
    const c = await api('/campaign', {
      org_id: user.org_id, origin_org_id: user.org_id, advertiser_id: adv,
      name: $('#f_name').value || 'Untitled campaign',
      starts_at: $('#f_start').value, ends_at: $('#f_end').value,
      committed_budget: Number($('#f_budget').value) || 0,
      rate_type, rate_value: rate_type === 'per_play' ? Number($('#f_rval').value) || 0 : 0,
      screen_ids, creative_ids
    });
    onDone(c);
  };

  drawCreatives(); rateHint(); sum();
}
