import { api, table, stat, pill, bar, inr, esc, $ } from '/assets/app.js';

export const thumb = (yt) => `https://i.ytimg.com/vi/${yt}/hqdefault.jpg`;

// thumbnail that degrades to a clean grey block if the image cannot load
const BLANK = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
export const thumbImg = (yt, w, extra = '') =>
  `<img src="${thumb(yt)}" alt="" loading="lazy"
    onerror="this.onerror=null;this.src='${BLANK}';this.style.borderStyle='dashed'"
    style="width:${w};aspect-ratio:16/9;object-fit:cover;border-radius:${w === '210px' ? 'var(--r)' : '4px'};
    border:1px solid var(--rule);background:var(--surface-2);display:block;flex:none;${extra}">`;

export const statusPill = (st) => {
  const m = { live:['p-live','on air',true], stalled:['p-warn','not responding',false],
              offline:['p-bad','offline',false], unpaired:['p-off','not paired',false] };
  const [cls, label, blip] = m[st?.state] || m.unpaired;
  return pill(cls, label, blip);
};

let timer = null;
export function stopScreenPoll() { if (timer) { clearInterval(timer); timer = null; } }

export async function renderScreen(id, canEdit) {
  const d = await api('/screen/' + id);
  const s = d.screen, st = d.status;
  const live = d.campaigns.filter(c => c.live);

  const npBlock = d.nowPlaying ? (() => {
    const n = d.nowPlaying;
    const pctPlayed = Math.min(100, Math.round(n.elapsed_s / (n.duration_s || 10) * 100));
    return `<div style="display:grid;grid-template-columns:210px 1fr;gap:16px;align-items:start">
      ${thumbImg(n.creative?.youtube_id, '210px')}
      <div>
        <div class="t-sub" style="font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;font-weight:600;color:var(--live)">
          <span class="pill p-live" style="padding:1px 7px"><span class="blip"></span>now playing</span></div>
        <div style="font-size:17px;font-weight:700;margin:8px 0 2px;letter-spacing:-.01em">${esc(n.creative?.name || '—')}</div>
        <div class="t-sub">${esc(n.advertiser)} · ${esc(n.campaign?.name || '—')}</div>
        <div style="margin-top:12px;max-width:340px">${bar(pctPlayed, true)}
          <div class="t-sub mono" style="font-size:11.5px;margin-top:4px">
            ${Math.min(n.duration_s, Math.round(n.elapsed_s))}s / ${n.duration_s}s</div></div>
      </div></div>`;
  })() : `<div class="empty" style="padding:26px">
      ${st.state === 'live' ? 'Paired and responding — waiting for the next play.'
        : st.state === 'unpaired' ? `Nothing paired yet. Enter code <span class="code" style="font-size:15px">${esc(s.code)}</span> in the player.`
        : `Last seen ${st.age_s > 3600 ? Math.round(st.age_s/3600)+'h' : Math.round(st.age_s/60)+'m'} ago.`}</div>`;

  return `
  <div class="phead">
    <div><a href="#screens" class="t-sub" style="font-size:12.5px">← My screens</a>
      <h1 style="margin-top:4px">${esc(s.name)}</h1>
      <p class="sub">${esc(s.venue_name)} · ${esc(s.address)} ·
        <span class="mono">${esc(s.code)}</span></p></div>
    <div style="display:flex;gap:8px;align-items:center">${statusPill(st)}
      ${canEdit ? '<button class="btn ghost sm" id="scredit">Edit screen</button>' : ''}</div>
  </div>
  ${canEdit ? editScreenPanel(s) : ''}

  <div class="card" id="npcard" style="margin-bottom:16px">${npBlock}</div>

  <div class="grid g4">
    ${stat('Live campaigns', d.stats.liveCampaigns, `of ${s.advertiser_slots} slots`)}
    ${stat('Plays today', d.stats.playsToday, `${d.stats.plays} all time`)}
    ${stat('Avg people / play', d.stats.avg === null ? '—' : d.stats.avg.toFixed(1), `${d.stats.measured} measured`)}
    ${stat('Price', inr(s.slot_price_month), 'per slot per month')}
  </div>

  <h2>Campaigns on this screen <span class="t-sub" style="font-weight:400">· ${d.campaigns.length} total, ${live.length} live</span></h2>
  ${table([
    { label:'Campaign', render:c => `<a href="#c/${c.id}" class="t-main">${esc(c.name)}</a><br><span class="t-sub">${esc(c.advertiser)}</span>` },
    { label:'Creatives', render:c => `<span style="display:flex;gap:5px">${c.creatives.map(cr =>
        `<span title="${esc(cr.name)} · ${cr.duration_s}s">${thumbImg(cr.youtube_id, '58px')}</span>`).join('')}</span>` },
    { label:'Dates', render:c => `<span class="mono t-sub">${c.starts_at}<br>→ ${c.ends_at}</span>` },
    { label:'Status', render:c => c.live ? pill('p-live','live',true) : pill('p-off', c.status) },
    { label:'Plays here', num:true, render:c => `<strong>${c.plays}</strong>` },
    { label:'Avg people', num:true, render:c => c.avg === null ? '<span class="t-sub">—</span>' : `<strong>${c.avg.toFixed(1)}</strong>` },
    { label:'Budget', num:true, render:c => { const p = c.committed_budget ? Math.round(c.accrued_spend / c.committed_budget * 100) : 0;
      return `${inr(c.accrued_spend)} / ${inr(c.committed_budget)}${bar(p, p >= 80)}`; } }
  ], d.campaigns, 'No campaigns booked on this screen yet')}

  <h2>Recent plays</h2>
  ${table([
    { label:'When', render:p => `<span class="mono t-sub">${new Date(p.ended_at).toLocaleString('en-IN',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',second:'2-digit'})}</span>` },
    { label:'Creative', render:p => p.creative
        ? `<span style="display:flex;align-items:center;gap:9px">${thumbImg(p.creative.youtube_id, '52px')}
           <span>${esc(p.creative.name)}</span></span>` : '—' },
    { label:'Duration', num:true, render:p => `${Math.round(p.duration_ms/1000)}s` },
    { label:'People present', num:true, render:p => p.presence && p.presence.measured
        ? `<strong>${p.presence.avg_persons.toFixed(1)}</strong>` : '<span class="t-sub">not measured</span>' }
  ], d.recent, 'No plays on this screen yet')}`;
}

function editScreenPanel(s) {
  const tags = Object.entries(s.tags || {}).map(([k, v]) => `${k}:${v}`).join(', ');
  const ex = s.exclusions || { categories: [], advertisers: [] };
  return `<div class="card" id="scrpanel" hidden style="margin-bottom:16px;border-color:var(--brand)">
    <h3 style="margin:0 0 12px;font-size:14px">Edit screen</h3>
    <div class="row">
      <div class="field"><label>Name</label><input id="s_name" value="${esc(s.name)}"></div>
      <div class="field"><label>Venue</label><input id="s_venue" value="${esc(s.venue_name)}"></div>
      <div class="field"><label>Address</label><input id="s_addr" value="${esc(s.address)}"></div>
    </div>
    <h4 style="font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-3);margin:14px 0 8px">
      Rate factors — value = base × size × location × exposure</h4>
    <div class="row">
      <div class="field"><label>Venue base ₹</label><input type="number" id="s_base" value="${s.venue_base}"></div>
      <div class="field"><label>Size factor</label><input type="number" step="0.1" id="s_size" value="${s.size_factor}"></div>
      <div class="field"><label>Location factor</label><input type="number" step="0.1" id="s_loc" value="${s.location_factor}"></div>
      <div class="field"><label>Exposure factor</label><input type="number" step="0.05" id="s_exp" value="${s.exposure_factor}"></div>
      <div class="field"><label>Advertiser slots</label><input type="number" id="s_slots" value="${s.advertiser_slots}"></div>
    </div>
    <p class="t-sub mono" id="s_preview" style="margin:0 0 4px"></p>
    <h4 style="font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-3);margin:14px 0 8px">Loop &amp; share</h4>
    <div class="row">
      <div class="field"><label>Loop length (s)</label><input type="number" id="s_loop" value="${Math.round(s.loop_length_s)}"></div>
      <div class="field"><label>Slot duration (s)</label><input type="number" id="s_slotdur" value="${s.slot_duration_s}"></div>
      <div class="field"><label>Operating hours</label><input type="number" id="s_hours" value="${s.operating_hours}"></div>
      <div class="field"><label>Owner share %</label><input type="number" id="s_owner" value="${s.owner_share_pct}"></div>
      <div class="field"><label>Slots released to network</label><input type="number" id="s_net" value="${s.network_slots || 0}"></div>
    </div>
    <h4 style="font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-3);margin:14px 0 8px">Tags &amp; exclusions</h4>
    <div class="row">
      <div class="field"><label>Tags (key:value, comma separated)</label><input id="s_tags" value="${esc(tags)}"></div>
      <div class="field"><label>Blocked categories (comma separated)</label><input id="s_exc" value="${esc((ex.categories || []).join(', '))}"></div>
    </div>
    <div style="margin-top:12px;display:flex;gap:10px;align-items:center">
      <button class="btn" id="s_save">Save screen</button>
      <button class="btn ghost" id="s_cancel">Cancel</button>
      <span class="t-sub" id="s_err"></span>
    </div>
  </div>`;
}

export function wireScreenEdit(id, onSaved) {
  const btn = $('#scredit'), panel = $('#scrpanel');
  if (!btn || !panel) return;
  const preview = () => {
    const v = Math.round(Number($('#s_base').value) * Number($('#s_size').value)
      * Number($('#s_loc').value) * Number($('#s_exp').value));
    const n = Math.max(1, Number($('#s_slots').value) || 1);
    $('#s_preview').textContent = `→ ${inr(v)} / month  ·  ${inr(Math.round(v / n))} per slot per month`;
  };
  ['s_base','s_size','s_loc','s_exp','s_slots'].forEach(k => { const el = $('#' + k); if (el) el.oninput = preview; });
  preview();
  btn.onclick = () => { panel.hidden = !panel.hidden; if (!panel.hidden) panel.scrollIntoView({ behavior:'smooth', block:'nearest' }); };
  $('#s_cancel').onclick = () => { panel.hidden = true; };
  $('#s_save').onclick = async () => {
    const tags = {};
    $('#s_tags').value.split(',').map(x => x.trim()).filter(Boolean).forEach(pair => {
      const i = pair.indexOf(':'); if (i > 0) tags[pair.slice(0, i).trim()] = pair.slice(i + 1).trim();
    });
    await api('/screen/' + id, {
      name: $('#s_name').value, venue_name: $('#s_venue').value, address: $('#s_addr').value,
      venue_base: Number($('#s_base').value), size_factor: Number($('#s_size').value),
      location_factor: Number($('#s_loc').value), exposure_factor: Number($('#s_exp').value),
      advertiser_slots: Number($('#s_slots').value) || 10,
      loop_length_s: Number($('#s_loop').value), slot_duration_s: Number($('#s_slotdur').value),
      operating_hours: Number($('#s_hours').value), owner_share_pct: Number($('#s_owner').value),
      network_slots: Number($('#s_net').value) || 0,
      network_available: (Number($('#s_net').value) || 0) > 0, tags
    });
    await api('/screen/' + id + '/exclusions', { exclusions: {
      categories: $('#s_exc').value.split(',').map(x => x.trim()).filter(Boolean), advertisers: [] } });
    onSaved();
  };
}

/* live ticker — repaints the now-playing card and status without a full re-render */
export function startScreenPoll(id) {
  stopScreenPoll();
  timer = setInterval(async () => {
    if (!location.hash.includes('s/' + id)) return stopScreenPoll();
    try {
      const d = await api('/screen/' + id);
      const card = $('#npcard'); if (!card) return stopScreenPoll();
      const n = d.nowPlaying;
      if (n) {
        const pct = Math.min(100, Math.round(n.elapsed_s / (n.duration_s || 10) * 100));
        card.innerHTML = `<div style="display:grid;grid-template-columns:210px 1fr;gap:16px;align-items:start">
          ${thumbImg(n.creative?.youtube_id, '210px')}
          <div><div><span class="pill p-live" style="padding:1px 7px"><span class="blip"></span>now playing</span></div>
            <div style="font-size:17px;font-weight:700;margin:8px 0 2px;letter-spacing:-.01em">${esc(n.creative?.name || '—')}</div>
            <div class="t-sub">${esc(n.advertiser)} · ${esc(n.campaign?.name || '—')}</div>
            <div style="margin-top:12px;max-width:340px">${bar(pct, true)}
              <div class="t-sub mono" style="font-size:11.5px;margin-top:4px">
                ${Math.min(n.duration_s, Math.round(n.elapsed_s))}s / ${n.duration_s}s</div></div>
          </div></div>`;
      }
      const sp = document.querySelector('.phead .pill');
      if (sp) sp.outerHTML = statusPill(d.status);
      document.querySelectorAll('[data-livecount]').forEach(el => el.textContent = d.stats.playsToday);
    } catch (e) { /* keep polling */ }
  }, 3000);
}
