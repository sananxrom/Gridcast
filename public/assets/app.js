export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const el = (h) => { const t = document.createElement('template'); t.innerHTML = h.trim(); return t.content.firstElementChild; };
export const inr = (n) => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
export const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export async function api(p, body) {
  const r = await fetch('/api' + p, body
    ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    : undefined);
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
  return r.json();
}
export const session = {
  get: () => JSON.parse(localStorage.getItem('gc_user') || 'null'),
  set: (u) => localStorage.setItem('gc_user', JSON.stringify(u)),
  clear: () => localStorage.removeItem('gc_user')
};
export function requireUser(roles) {
  const u = session.get();
  if (!u || (roles && !roles.includes(u.role))) { location.href = '/'; throw new Error('redirect'); }
  return u;
}
export function rail(active, items, user) {
  return `<nav class="rail">
    <div class="brandmark"><span class="dot"></span> Gridcast</div>
    ${items.map(i => i.cat ? `<div class="cat">${i.cat}</div>`
      : `<a href="${i.href}" class="${i.id === active ? 'on' : ''}">${i.label}</a>`).join('')}
    <div class="foot">${esc(user.name)}<br><span style="opacity:.6">${esc(user.orgName || '')}</span><br>
      <a href="#" id="signout" style="color:#8B6E82">Sign out</a></div></nav>`;
}
export function mountRail(html) {
  document.body.classList.add('has-rail');
  document.body.insertAdjacentHTML('afterbegin', html);
  const so = $('#signout');
  if (so) so.onclick = (e) => { e.preventDefault(); session.clear(); location.href = '/'; };
}
export const pill = (cls, text, blip) => `<span class="pill ${cls}">${blip ? '<span class="blip"></span>' : ''}${esc(text)}</span>`;
export function bar(pct, hot) {
  const p = Math.max(0, Math.min(100, pct));
  return `<div class="bar"><i class="${hot ? 'hot' : ''}" style="width:${p}%"></i></div>`;
}
export function table(cols, rows, emptyMsg = 'Nothing here yet') {
  if (!rows.length) return `<div class="tw"><div class="empty">${esc(emptyMsg)}</div></div>`;
  return `<div class="tw"><table><thead><tr>${cols.map(c =>
    `<th class="${c.num ? 'num' : ''}">${esc(c.label)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(r => `<tr>${cols.map(c =>
      `<td class="${c.num ? 'num' : ''}">${c.render(r)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
export const stat = (k, v, d) => `<div class="card stat"><div class="k">${esc(k)}</div><div class="v">${v}</div>${d ? `<div class="d">${d}</div>` : ''}</div>`;
