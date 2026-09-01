import { api, table, stat, pill, bar, inr, esc, $ } from '/assets/app.js';

export const thumb = (yt) => `https://i.ytimg.com/vi/${yt}/hqdefault.jpg`;

// thumbnail that degrades to a clean grey block if the image cannot load
export const thumbImg = (yt, w, extra = '') =>
  `<img src="${thumb(yt)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'"
    style="width:${w};aspect-ratio:16/9;object-fit:cover;border-radius:${w === '210px' ? 'var(--r)' : '4px'};
    border:1px solid var(--rule);background:var(--surface-2);display:block;${extra}">`;

export const statusPill = (st) => {
  const m = { live:['p-live','on air',true], stalled:['p-warn','not responding',false],
              offline:['p-bad','offline',false], unpaired:['p-off','not paired',false] };
  const [cls, label, blip] = m[st?.state] || m.unpaired;
  return pill(cls, label, blip);
};

let timer = null;
export function stopScreenPoll() { if (timer) { clearInterval(timer); timer = null; } }

export async function renderScreen(id) {
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
    <div style="display:flex;gap:8px;align-items:center">${statusPill(st)}</div>
  </div>

  <div class="card" id="npcard" style="margin-bottom:16px">${npBlock}</div>

  <div class="grid g4">
    ${stat('Live campaigns', d.stats.liveCampaigns, `of ${s.advertiser_slots} slots`)}
    ${stat('Plays today', d.stats.playsToday, `${d.stats.plays} all time`)}
    ${stat('Avg people / play', d.stats.avg === null ? '—' : d.stats.avg.toFixed(1), `${d.stats.measured} measured`)}
    ${stat('Price', inr(s.slot_price_month), 'per slot per month')}
  </div>

  <h2>Campaigns on this screen <span class="t-sub" style="font-weight:400">· ${d.campaigns.length} total, ${live.length} live</span></h2>
  <div class="grid g2" id="camps">
    ${d.campaigns.length ? d.campaigns.map(c => `
      <div class="card" ${c.live ? 'style="border-color:var(--brand)"' : ''}>
        <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start">
          <div><a href="#c/${c.id}" class="t-main" style="font-size:15px">${esc(c.name)}</a>
            <div class="t-sub">${esc(c.advertiser)} · <span class="mono">${c.starts_at} → ${c.ends_at}</span></div></div>
          ${c.live ? pill('p-live','live',true) : pill('p-off', c.status)}
        </div>
        <div style="display:flex;gap:8px;margin:12px 0 10px;overflow-x:auto">
          ${c.creatives.map(cr => `<div style="flex:0 0 110px" title="${esc(cr.name)}">
            ${thumbImg(cr.youtube_id, '110px')}
            <div class="t-sub" style="font-size:11px;margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
              ${esc(cr.name)}</div></div>`).join('')}
        </div>
        <div class="tw" style="box-shadow:none"><table style="min-width:0"><tbody>
          <tr><td class="t-sub">Plays on this screen</td><td class="num"><strong>${c.plays}</strong></td></tr>
          <tr><td class="t-sub">Avg people / play</td><td class="num">${c.avg === null ? '<span class="t-sub">—</span>' : '<strong>'+c.avg.toFixed(1)+'</strong>'}</td></tr>
          <tr><td class="t-sub">Budget used</td><td class="num">${inr(c.accrued_spend)} / ${inr(c.committed_budget)}</td></tr>
        </tbody></table></div>
      </div>`).join('')
      : '<div class="tw"><div class="empty">No campaigns booked on this screen yet.</div></div>'}
  </div>

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
