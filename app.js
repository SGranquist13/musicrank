// MusicRank — static app, no build step. Catalog data from the iTunes Search API (JSONP, no key needed).
// You listen wherever you like; here you rate each song S–F. Album ratings are computed from your
// song ratings, and you can override any album you disagree with. Everything else is automatic.
const $ = (s, el = document) => el.querySelector(s);
const view = $('#view');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const art = (url, size = 600) => (url || '').replace(/\d+x\d+bb/, `${size}x${size}bb`);
const year = d => (d || '').slice(0, 4);
const fmt = ms => ms ? `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}` : '';
const TIERS = ['S', 'A', 'B', 'C', 'D', 'F'];
const SCORE = { S: 6, A: 5, B: 4, C: 3, D: 2, F: 1 };
const scoreTier = s => s == null ? null : TIERS[Math.min(5, Math.max(0, Math.round(6 - s)))];

// ---------- storage ----------
// Songs are keyed by normalized title and albums by base title, so a rating carries over between
// the standard and deluxe editions of the same album.
const KEY = 'musicrank:v1';
let store;
try { store = JSON.parse(localStorage.getItem(KEY)) || {}; } catch { store = {}; }
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch {} };
const prefs = (store._prefs ||= { deluxe: false });
function artistState(id) {
  const s = (store[id] ||= {});
  s.name ||= ''; s.art ||= ''; s.tiers ||= {};
  for (const k of ['albums', 'songs']) { s.tiers[k] ||= {}; TIERS.forEach(t => s.tiers[k][t] ||= []); }
  return s;
}
const tierOf = (st, kind, id) => TIERS.find(t => st.tiers[kind][t].includes(String(id))) || null;
function setTier(st, kind, id, tier) {
  id = String(id);
  TIERS.forEach(t => { const a = st.tiers[kind][t]; const i = a.indexOf(id); if (i >= 0) a.splice(i, 1); });
  if (tier) st.tiers[kind][tier].push(id);
  save();
}
const baseTitle = n => n.toLowerCase()
  .replace(/\s*[\(\[][^\)\]]*[\)\]]/g, '').replace(/ - (single|ep)$/, '')
  .replace(/&/g, 'and').replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
const songKey = t => 's:' + t.trackName.toLowerCase()
  .replace(/\s*[\(\[](feat|with|ft)\.?[^\)\]]*[\)\]]/g, '').replace(/\s+-\s+.*remaster.*$/, '')
  .replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
const albumKey = a => 'a:' + (a.groupKey || baseTitle(a.collectionName));
// One-time move of ratings saved under the old numeric ids.
function migrate(st, kind, item, oldId, key) {
  const t = tierOf(st, kind, oldId);
  if (t) { setTier(st, kind, oldId, null); if (!tierOf(st, kind, key)) setTier(st, kind, key, t); }
}

// ---------- api ----------
let cb = 0;
function itunes(path, params) {
  return new Promise((resolve, reject) => {
    const name = `__it${++cb}`;
    const s = document.createElement('script');
    const t = setTimeout(() => { cleanup(); reject(new Error('timeout')); }, 15000);
    const cleanup = () => { clearTimeout(t); delete window[name]; s.remove(); };
    window[name] = d => { cleanup(); resolve(d); };
    s.onerror = () => { cleanup(); reject(new Error('network')); };
    s.src = `https://itunes.apple.com/${path}?${new URLSearchParams({ ...params, callback: name })}`;
    document.body.appendChild(s);
  });
}
const cache = {};
// iTunes has no album-type field, so classify by name + size.
function kindOf(a) {
  const n = a.collectionName;
  if (/\b(live|unplugged)\b|in concert|greatest hits|best of|the essential|anthology|collection|remix|\bmix\)|\bRMX\b|\bdis[ck] \d|instrumentals?\b|karaoke|tribute|b-sides|rarities|a cappella/i.test(n)) return 'other';
  if (/ - single$/i.test(n) || a.trackCount <= 3) return 'single';
  if (/ - ep$|\bEP\b/i.test(n) || a.trackCount <= 6) return 'ep';
  return 'album';
}
const KINDS = [['album', 'Albums'], ['ep', 'EPs'], ['single', 'Singles'], ['other', 'Live & other']];
async function getDiscography(artistId) {
  const ck = artistId + (prefs.deluxe ? ':dlx' : ':std');
  if (cache[ck]) return cache[ck];
  const d = cache['raw' + artistId] ||= await itunes('lookup', { id: artistId, entity: 'album', limit: 200 });
  const artist = d.results.find(r => r.wrapperType === 'artist');
  const all = d.results.filter(r => r.wrapperType === 'collection' && String(r.artistId) === String(artistId))
    .map(r => ({ ...r, kind: kindOf(r) }))
    .sort((a, b) => a.releaseDate.localeCompare(b.releaseDate));
  // Group editions of the same release: "(Deluxe)", "(Bonus)", clean/explicit, and
  // reissues named after the original ("OK Computer OKNOTOK", "KID A MNESIA").
  const groups = new Map();
  for (const a of all) {
    let base = baseTitle(a.collectionName);
    if (a.kind === 'album') {
      const orig = [...groups.values()].find(g => g.kind === 'album' && base !== g.base && base.startsWith(g.base + ' '));
      if (orig) base = orig.base;
    }
    const gk = a.kind === 'other' ? 'o' + a.collectionId : (a.kind === 'album' || a.kind === 'ep' ? 'r' : a.kind) + ':' + base;
    if (!groups.has(gk)) groups.set(gk, { base, kind: a.kind, items: [] });
    groups.get(gk).items.push(a);
  }
  const albums = [...groups.values()].map(g => {
    const byTracks = [...g.items].sort((a, b) => a.trackCount - b.trackCount || a.collectionName.length - b.collectionName.length);
    const pick = prefs.deluxe ? byTracks.at(-1) : byTracks[0];
    const kind = g.items.some(x => x.kind === 'album') ? 'album' : g.kind;
    return { ...pick, kind, groupKey: g.base, firstDate: g.items[0].releaseDate, eds: g.items };
  }).sort((a, b) => a.firstDate.localeCompare(b.firstDate));
  const main = albums.filter(a => a.kind === 'album');
  return (cache[ck] = { artist, albums, all, main: main.length ? main : albums });
}
async function getTracks(collectionId) {
  const key = 'c' + collectionId;
  if (cache[key]) return cache[key];
  const d = await itunes('lookup', { id: collectionId, entity: 'song' });
  return (cache[key] = d.results.filter(r => r.wrapperType === 'track').sort((a, b) => a.discNumber - b.discNumber || a.trackNumber - b.trackNumber));
}
async function tracksFor(albums) { return Promise.all(albums.map(a => getTracks(a.collectionId).catch(() => []))); }
function uniqueSongs(trackLists) {
  const seen = new Set();
  return trackLists.flat().filter(t => { const k = songKey(t); if (seen.has(k)) return false; seen.add(k); return true; });
}
// Albums only by default; the toggle adds EPs and singles to the review flow and rankings.
const scopeOf = (st, d) => st.withSingles ? d.albums.filter(a => a.kind !== 'other') : d.main;

// ---------- album rating: auto from songs, optional override ----------
function albumRating(st, a, tracks) {
  const vals = (tracks || []).map(t => tierOf(st, 'songs', songKey(t))).filter(Boolean).map(x => SCORE[x]);
  const avg = vals.length ? vals.reduce((p, q) => p + q, 0) / vals.length : null;
  const auto = scoreTier(avg), mine = tierOf(st, 'albums', albumKey(a));
  const total = (tracks || []).length || a.trackCount;
  return { avg, auto, mine, final: mine || auto, value: mine ? SCORE[mine] : avg, rated: vals.length, total, done: !!mine || (total > 0 && vals.length >= total) };
}
function rankAlbums(st, albums, trackLists) {
  return albums.map((a, i) => ({ a, tracks: trackLists[i], ...albumRating(st, a, trackLists[i]) }))
    .filter(r => r.value != null)
    .sort((x, y) => y.value - x.value || (y.avg ?? 0) - (x.avg ?? 0) || x.a.firstDate.localeCompare(y.a.firstDate));
}
// Keep one snapshot per day of the album ranking so you can see how it shifts.
function snapshot(st, ranked) {
  const order = ranked.map(r => albumKey(r.a));
  st.history ||= [];
  const day = new Date().toISOString().slice(0, 10);
  const last = st.history.at(-1);
  if (last?.day === day) last.order = order;
  else if (!last || last.order.join() !== order.join()) st.history.push({ day, order });
  save();
}

const listenLinks = (artistName, title, appleUrl) => {
  const q = encodeURIComponent(`${artistName} ${title}`);
  return `<div class="links"><span class="muted">Listen on</span>
    <a target="_blank" rel="noopener" href="https://open.spotify.com/search/${q}">Spotify</a>
    ${appleUrl ? `<a target="_blank" rel="noopener" href="${esc(appleUrl)}">Apple Music</a>` : ''}
    <a target="_blank" rel="noopener" href="https://music.youtube.com/search?q=${q}">YouTube Music</a></div>`;
};

// ---------- theme + album-art color ----------
// ?theme=paper|night|art previews a theme (and remembers it).
const qTheme = new URLSearchParams(location.search).get('theme');
if (qTheme) { prefs.theme = qTheme; save(); }
document.documentElement.dataset.theme = prefs.theme || 'swiss';
const DEFAULT_ACCENT = getComputedStyle(document.documentElement).getPropertyValue('--accent');
// Pick the most vibrant color from a tiny copy of the cover and make it readable on the dark base.
const tintCache = {};
async function tint(url) {
  const root = document.documentElement.style;
  if (!url || (prefs.theme || 'art') !== 'art') { root.removeProperty('--accent'); root.removeProperty('--accent-ink'); return; }
  const small = art(url, 40);
  let c = tintCache[small];
  if (!c) {
    try {
      const img = new Image(); img.crossOrigin = 'anonymous'; img.src = small; await img.decode();
      const cv = document.createElement('canvas'); cv.width = cv.height = 40;
      const x = cv.getContext('2d'); x.drawImage(img, 0, 0, 40, 40);
      const d = x.getImageData(0, 0, 40, 40).data; let best = null, bestScore = -1;
      for (let i = 0; i < d.length; i += 4) {
        const [h, s, l] = rgbToHsl(d[i], d[i + 1], d[i + 2]);
        const score = s * (1 - Math.abs(l - .5) * 1.6);
        if (score > bestScore) { bestScore = score; best = [h, s, l]; }
      }
      // Low-saturation covers (black & white art) fall back to the warm default.
      c = tintCache[small] = best && best[1] > .25 ? `hsl(${Math.round(best[0] * 360)} ${Math.round(Math.min(.85, Math.max(.55, best[1])) * 100)}% 64%)` : null;
    } catch { c = null; }
  }
  if (c) { root.setProperty('--accent', c); root.setProperty('--accent-ink', '#14100b'); }
  else { root.removeProperty('--accent'); root.removeProperty('--accent-ink'); }
}
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const dd = mx - mn, s = l > .5 ? dd / (2 - mx - mn) : dd / (mx + mn);
  const h = mx === r ? (g - b) / dd + (g < b ? 6 : 0) : mx === g ? (b - r) / dd + 2 : (r - g) / dd + 4;
  return [h / 6, s, l];
}
const backdrop = url => `<div class="backdrop" style="--art:url('${esc(art(url, 300))}')"></div>`;

// ---------- optional preview player ----------
const audio = $('#audio');
let playing = null;
function play(track) {
  if (playing === track.trackId && !audio.paused) { audio.pause(); return; }
  if (playing !== track.trackId) {
    audio.src = track.previewUrl; playing = track.trackId;
    $('#pArt').src = art(track.artworkUrl100, 100);
    $('#pTitle').textContent = track.trackName;
    $('#pSub').textContent = `${track.artistName} — ${track.collectionName} (30s preview)`;
    $('#player').classList.remove('hidden');
  }
  audio.play();
}
audio.onplay = audio.onpause = () => {
  $('#pToggle').textContent = audio.paused ? '▶' : '❚❚';
  document.querySelectorAll('.play').forEach(b => b.classList.toggle('on', !audio.paused && +b.dataset.id === playing));
};
audio.ontimeupdate = () => { $('#pProg').style.width = (audio.currentTime / (audio.duration || 30)) * 100 + '%'; };
$('#pToggle').onclick = () => audio.paused ? audio.play() : audio.pause();

// ---------- tier buttons ----------
const tbadge = t => `<span class="tbadge ${t ? 't-' + t : ''}">${t || '–'}</span>`;
const tierBtns = (st, kind, id) => `<div class="tierbtns" data-kind="${kind}" data-id="${esc(id)}">${TIERS.map(t =>
  `<button class="t-${t} ${tierOf(st, kind, id) === t ? 'on' : ''}" data-tier="${t}">${t}</button>`).join('')}</div>`;
function wireTierBtns(root, st, after) {
  root.addEventListener('click', e => {
    const b = e.target.closest('.tierbtns button'); if (!b) return;
    const box = b.parentNode, { kind, id } = box.dataset;
    const t = tierOf(st, kind, id) === b.dataset.tier ? null : b.dataset.tier; // tap again to clear
    setTier(st, kind, id, t);
    box.querySelectorAll('button').forEach(x => x.classList.toggle('on', x.dataset.tier === t));
    const badge = box.closest('.row')?.querySelector('.tbadge');
    if (badge) badge.outerHTML = tbadge(t);
    after?.(kind, id, t);
  });
}
function songRow(t, st, lead, sub) {
  const k = songKey(t);
  return `<li class="row" data-id="${esc(k)}">
    <span class="rk">${lead}</span>
    ${sub ? `<img loading="lazy" src="${esc(art(t.artworkUrl100, 100))}" alt="">` : ''}
    <div class="info"><div>${esc(t.trackName)}</div><div class="s">${sub ? esc(sub) + ' · ' : ''}${fmt(t.trackTimeMillis)}</div></div>
    ${t.previewUrl ? `<button class="play" data-id="${t.trackId}" title="30s preview">▶</button>` : ''}
    ${tierBtns(st, 'songs', k)}${tbadge(tierOf(st, 'songs', k))}</li>`;
}
function wireSongRows(ul, tracks, st, after) {
  ul.addEventListener('click', e => { const p = e.target.closest('.play'); if (p) play(tracks.find(t => t.trackId === +p.dataset.id)); });
  wireTierBtns(ul, st, after);
}

// ---------- views ----------
function home() {
  const mine = Object.entries(store).filter(([k, s]) => k !== '_prefs' && s.name);
  tint(null);
  view.innerHTML = `<div class="empty"><h1>Listen anywhere.<br><em>Rate it here.</em></h1>
    <p class="muted">Pick an artist and play their albums wherever you listen. Tap S–F on each song as it plays.<br>
    Album ratings and rankings build themselves from your song ratings. Override any you disagree with.</p></div>
    ${mine.length ? `<h2>Your artists</h2><div class="grid">${mine.map(([id, s]) => `
      <a class="card" href="#/artist/${id}"><img src="${esc(s.art)}" alt=""><div class="t">${esc(s.name)}</div></a>`).join('')}</div>` : ''}`;
}

async function search(q) {
  tint(null);
  view.innerHTML = `<p class="muted">Searching…</p>`;
  const d = await itunes('search', { term: q, entity: 'musicArtist', limit: 12 });
  if (!d.results.length) { view.innerHTML = `<p class="muted">No artists found for “${esc(q)}”.</p>`; return; }
  const covers = await Promise.all(d.results.map(a => itunes('lookup', { id: a.artistId, entity: 'album', limit: 1 }).then(r => r.results.find(x => x.wrapperType === 'collection')?.artworkUrl100).catch(() => '')));
  view.innerHTML = `<h2>Artists matching “${esc(q)}”</h2><div class="grid">${d.results.map((a, i) => `
    <a class="card" href="#/artist/${a.artistId}"><img src="${esc(art(covers[i], 300))}" alt="">
    <div class="t">${esc(a.artistName)}</div><div class="s">${esc(a.primaryGenreName || '')}</div></a>`).join('')}</div>`;
}

const toggles = st => `<div class="toggles">
  <label class="switch"><input type="checkbox" data-pref="withSingles" ${st.withSingles ? 'checked' : ''}><span></span>Include EPs &amp; singles</label>
  <label class="switch"><input type="checkbox" data-pref="deluxe" ${prefs.deluxe ? 'checked' : ''}><span></span>Prefer deluxe editions</label></div>`;
function wireToggles(st, rerender) {
  view.querySelectorAll('[data-pref]').forEach(c => c.onchange = () => {
    if (c.dataset.pref === 'deluxe') prefs.deluxe = c.checked; else st.withSingles = c.checked;
    save(); rerender();
  });
}

const TABS = [['albums', 'Discography'], ['rank', 'Album ranking'], ['songs', 'Song ranking'], ['time', 'Over time']];

async function artistPage(id, tab = 'albums', sub) {
  view.innerHTML = `<p class="muted">Loading discography…</p>`;
  const disco = await getDiscography(id);
  const { artist, albums } = disco;
  if (!artist) { view.innerHTML = `<p class="muted">Artist not found.</p>`; return; }
  const st = artistState(id);
  disco.all.forEach(a => migrate(st, 'albums', a, a.collectionId, albumKey(albums.find(x => x.groupKey === baseTitle(a.collectionName)) || a)));
  const main = scopeOf(st, disco);
  const unit = st.withSingles ? 'releases' : 'albums';
  const latest = main.at(-1);
  st.name = artist.artistName; st.art = art(latest?.artworkUrl100, 300); save();
  const lists = await tracksFor(main);
  lists.flat().forEach(t => migrate(st, 'songs', t, t.trackId, songKey(t)));
  const ratings = main.map((a, i) => albumRating(st, a, lists[i]));
  const done = ratings.filter(r => r.done).length;
  const pct = main.length ? Math.round((done / main.length) * 100) : 0;
  const nextUp = main.find((a, i) => !ratings[i].done);

  tint(latest.artworkUrl100);
  view.innerHTML = `${backdrop(latest.artworkUrl100)}
    <div class="hero"><a href="#/album/${id}/${latest.collectionId}"><img src="${esc(art(latest.artworkUrl100, 400))}" alt=""></a>
      <div><div class="eyebrow">Artist</div><h1>${esc(artist.artistName)}</h1>
      <div class="muted">Latest: <a href="#/album/${id}/${latest.collectionId}"><b>${esc(latest.collectionName)}</b></a> (${year(latest.firstDate)})</div>
      <div class="prog"><div style="width:${pct}%"></div></div>
      <div class="muted">${done} / ${main.length} ${unit} fully rated</div>
      <div class="tools">${nextUp
        ? `<a class="btn primary" href="#/album/${id}/${nextUp.collectionId}">${done ? 'Continue' : 'Start'}: ${esc(nextUp.collectionName)} →</a>`
        : `<a class="btn primary" href="#/artist/${id}/rank">All rated. See your ranking →</a>`}</div>
      ${toggles(st)}</div></div>
    <div class="tabs">${TABS.map(([k, l]) => `<button data-tab="${k}" class="${tab === k ? 'on' : ''}">${l}</button>`).join('')}</div><div id="tab"></div>`;
  wireToggles(st, () => artistPage(id, tab, sub));
  view.querySelector('.tabs').onclick = e => { const t = e.target.dataset.tab; if (t) location.hash = `#/artist/${id}/${t}`; };
  const el = $('#tab');

  if (tab === 'albums') {
    const kind = sub || 'album';
    const list = albums.filter(a => a.kind === kind).reverse(); // newest first
    const counts = Object.fromEntries(KINDS.map(([k]) => [k, albums.filter(a => a.kind === k).length]));
    el.innerHTML = `<div class="chips">${KINDS.filter(([k]) => counts[k]).map(([k, l]) =>
        `<a class="chipf ${k === kind ? 'on' : ''}" href="#/artist/${id}/albums/${k}">${l} <span>${counts[k]}</span></a>`).join('')}</div>
      <div class="grid">${list.map(a => {
        const i = main.indexOf(a), r = i >= 0 ? ratings[i] : { final: tierOf(st, 'albums', albumKey(a)) };
        return `<a class="card" href="#/album/${id}/${a.collectionId}">${r.final ? `<span class="badge t-${r.final}">${r.final}</span>` : ''}
          <img loading="lazy" src="${esc(art(a.artworkUrl100, 400))}" alt=""><div class="t">${esc(a.collectionName.replace(/ - (Single|EP)$/i, ''))}</div>
          <div class="s">${year(a.firstDate)} · ${a.trackCount} tracks${r.rated != null && r.rated < r.total && r.rated ? ` · ${r.rated}/${r.total} rated` : ''}</div></a>`;
      }).join('') || '<p class="muted">Nothing here.</p>'}</div>`;
  }

  if (tab === 'rank') {
    const ranked = rankAlbums(st, main, lists);
    snapshot(st, ranked);
    const unrated = main.filter(a => !ranked.some(r => r.a === a));
    el.innerHTML = `<div class="tools"><button id="share">Copy ranking as text</button></div>
      <p class="muted">Ranked automatically from your song ratings. Open an album to override its rating.</p>
      ${ranked.length ? `<ol class="rlist">${ranked.map((r, i) => `<li>
        <span class="rk">${i + 1}</span><img src="${esc(art(r.a.artworkUrl100, 100))}" alt="">
        <a href="#/album/${id}/${r.a.collectionId}"><div>${esc(r.a.collectionName)}</div>
          <div class="s muted">${year(r.a.firstDate)} · ${r.mine ? `your call (auto ${r.auto || '–'})` : `auto · ${r.rated}/${r.total} songs`}</div></a>
        <span class="badge2 t-${r.final}">${r.final}</span></li>`).join('')}</ol>` : '<p class="muted">Rate some songs to see your ranking.</p>'}
      ${unrated.length ? `<h2>Not rated yet</h2><div class="grid small-grid">${unrated.map(a => `<a class="card" href="#/album/${id}/${a.collectionId}">
        <img loading="lazy" src="${esc(art(a.artworkUrl100, 200))}" alt=""><div class="t">${esc(a.collectionName)}</div></a>`).join('')}</div>` : ''}`;
    $('#share').onclick = () => copyText(`My ${artist.artistName} album ranking\n` + ranked.map((r, i) => `${i + 1}. ${r.a.collectionName} (${r.final})`).join('\n'));
  }

  if (tab === 'songs') {
    const albumOf = new Map(), songs = [];
    main.forEach((a, i) => lists[i].forEach(t => { const k = songKey(t); if (!albumOf.has(k)) { albumOf.set(k, a); songs.push(t); } }));
    const rated = songs.filter(t => tierOf(st, 'songs', songKey(t)));
    const byTier = TIERS.map(T => [T, rated.filter(t => tierOf(st, 'songs', songKey(t)) === T)]).filter(([, xs]) => xs.length);
    el.innerHTML = `<div class="tools"><button id="share">Copy as tier list</button></div>
      <p class="muted">${rated.length} of ${songs.length} songs rated, grouped by tier. Tap a song to change its rating.</p>
      ${byTier.map(([T, xs]) => `<h2 class="tierhead"><span class="badge2 t-${T}">${T}</span> <span class="muted">${xs.length}</span></h2>
        <ul class="list">${xs.map(t => songRow(t, st, '', albumOf.get(songKey(t)).collectionName)).join('')}</ul>`).join('') || '<p class="muted">No songs rated yet.</p>'}`;
    el.querySelectorAll('.list').forEach(ul => wireSongRows(ul, songs, st));
    $('#share').onclick = () => copyText(`My ${artist.artistName} songs\n` + byTier.map(([T, xs]) => `${T}: ${xs.map(t => t.trackName).join(', ')}`).join('\n'));
  }

  if (tab === 'time') {
    const ranked = rankAlbums(st, main, lists);
    snapshot(st, ranked);
    const prev = st.history.length > 1 ? st.history.at(-2) : null;
    const byKey = new Map(main.map(a => [albumKey(a), a]));
    const pts = main.map((a, i) => ({ a, ...ratings[i] }));
    el.innerHTML = `
      <h2>Career arc</h2>
      <p class="muted">Each album in release order, with its final rating (your override, or the average of its songs).</p>
      ${arcChart(pts, id)}
      ${prev ? `<h2>Movement since ${prev.day}</h2><ol class="rlist">${ranked.map((r, i) => {
        const was = prev.order.indexOf(albumKey(r.a));
        const mv = was < 0 ? '<span class="mv new">new</span>' : was > i ? `<span class="mv up">▲${was - i}</span>` : was < i ? `<span class="mv down">▼${i - was}</span>` : '<span class="mv">–</span>';
        return `<li><span class="rk">${i + 1}</span><img src="${esc(art(r.a.artworkUrl100, 100))}" alt=""><a href="#/album/${id}/${r.a.collectionId}">${esc(r.a.collectionName)}</a>
          <span class="badge2 t-${r.final}">${r.final}</span>${mv}</li>`;
      }).join('')}</ol>` : ''}
      ${st.history.length > 1 ? `<h2>Your ranking by day</h2><div class="hist">${[...st.history].reverse().map(h => `
        <div class="hrow"><span class="muted">${h.day}</span><div class="hcovers">${h.order.slice(0, 10).map((k, i) => byKey.get(k) ? `<img title="${i + 1}. ${esc(byKey.get(k).collectionName)}" src="${esc(art(byKey.get(k).artworkUrl100, 100))}" alt="">` : '').join('')}</div></div>`).join('')}</div>`
        : '<p class="muted small">Come back on another day to see how your ranking moves.</p>'}`;
    wireArc(el);
  }
}

// Career arc: one series, albums in release order on x, rating (F..S) on y.
function arcChart(pts, artistId) {
  const W = Math.max(340, Math.min(760, view.clientWidth - 16)), H = W < 500 ? 240 : 280, L = 34, R = 16, T = 16, B = 34;
  const n = pts.length, x = i => L + (n === 1 ? (W - L - R) / 2 : i * (W - L - R) / (n - 1));
  const y = v => T + (6 - v) * (H - T - B) / 5;
  const scored = pts.map((p, i) => ({ ...p, i })).filter(p => p.value != null);
  const path = scored.map((p, k) => `${k ? 'L' : 'M'}${x(p.i).toFixed(1)},${y(p.value).toFixed(1)}`).join('');
  const every = Math.ceil(n / 10);
  return `<div class="arc"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Album ratings over the artist's career">
    ${TIERS.map((t, k) => `<line x1="${L}" x2="${W - R}" y1="${y(6 - k)}" y2="${y(6 - k)}" class="grid"/><text x="${L - 10}" y="${y(6 - k) + 4}" class="ylab">${t}</text>`).join('')}
    ${pts.map((p, i) => i % every === 0 || i === n - 1 ? `<text x="${x(i)}" y="${H - 10}" class="xlab">${year(p.a.firstDate)}</text>` : '').join('')}
    <path d="${path}" class="line"/>
    ${pts.map((p, i) => p.value == null
      ? `<circle cx="${x(i)}" cy="${H - B}" r="4" class="todo"/>`
      : `<circle cx="${x(i)}" cy="${y(p.value)}" r="6" class="dot t-${p.final}"/>`).join('')}
    ${pts.map((p, i) => `<rect x="${x(i) - 14}" y="${T}" width="28" height="${H - T - 4}" class="hit" data-href="#/album/${artistId}/${p.a.collectionId}"
      data-tip="${esc(`<b>${p.a.collectionName}</b><br>${year(p.a.firstDate)} · ${p.final ? `${p.final}${p.mine ? ' (your call)' : ' (auto)'}` : 'Not rated yet'}${p.rated ? `<br>${p.rated}/${p.total} songs rated` : ''}`)}"/>`).join('')}
  </svg><div class="tip hidden"></div></div>
  <p class="muted small">Hollow dots on the baseline are albums you haven't rated yet. Tap a dot to open the album.</p>`;
}
function wireArc(el) {
  const box = $('.arc', el); if (!box) return;
  const tip = $('.tip', box);
  box.addEventListener('pointermove', e => {
    const h = e.target.closest('.hit'); if (!h) { tip.classList.add('hidden'); return; }
    tip.innerHTML = h.dataset.tip; tip.classList.remove('hidden');
    const r = box.getBoundingClientRect(), hr = h.getBoundingClientRect();
    tip.style.left = Math.min(r.width - 180, Math.max(0, hr.left - r.left - 80)) + 'px'; tip.style.top = '0px';
  });
  box.addEventListener('pointerleave', () => tip.classList.add('hidden'));
  box.addEventListener('click', e => { const h = e.target.closest('.hit'); if (h) location.hash = h.dataset.href; });
}

async function albumPage(artistId, cid) {
  view.innerHTML = `<p class="muted">Loading album…</p>`;
  const [disco, tracks] = await Promise.all([getDiscography(artistId), getTracks(cid)]);
  const { albums } = disco;
  const group = albums.find(a => a.eds.some(e => String(e.collectionId) === String(cid)));
  const raw = group?.eds.find(e => String(e.collectionId) === String(cid));
  const album = group ? { ...group, ...raw, kind: group.kind } : { ...tracks[0], kind: 'album', firstDate: tracks[0]?.releaseDate, eds: [] };
  const st = artistState(artistId);
  tracks.forEach(t => migrate(st, 'songs', t, t.trackId, songKey(t)));
  migrate(st, 'albums', album, album.collectionId, albumKey(album));
  const main = scopeOf(st, disco);
  const total = tracks.reduce((s, t) => s + (t.trackTimeMillis || 0), 0);
  const seq = main.some(a => a.groupKey === album.groupKey) ? main : albums.filter(a => a.kind === album.kind); // oldest → newest
  const i = seq.findIndex(a => a.groupKey === album.groupKey), prev = seq[i - 1], next = seq[i + 1];
  const pos = i >= 0 ? `${seq === main && !st.withSingles ? 'Album' : 'Release'} ${i + 1} of ${seq.length}` : '';
  const editions = [...album.eds].sort((a, b) => a.trackCount - b.trackCount);
  const edLabel = (e, n) => n === 0 ? `Standard · ${e.trackCount}` : `Deluxe · ${e.trackCount}`;
  const ak = albumKey(album);

  tint(album.artworkUrl100);
  const editionChips = new Set(editions.map(e => e.trackCount)).size > 1
    ? `<div class="chips">${[...new Map(editions.map(e => [e.trackCount, e])).values()].map((e, n) => `<a class="chipf ${e.trackCount === album.trackCount ? 'on' : ''}" href="#/album/${artistId}/${e.collectionId}">${edLabel(e, n)}</a>`).join('')}</div>` : '';
  view.innerHTML = `${backdrop(album.artworkUrl100)}
    <div class="nav"><a href="#/artist/${artistId}">← ${esc(album.artistName)}</a>
      <span>${prev ? `<a href="#/album/${artistId}/${prev.collectionId}">‹ Prev</a>` : ''}${next ? `<a href="#/album/${artistId}/${next.collectionId}">Next ›</a>` : ''}</span></div>
    <section class="bento album-bento">
      <div class="tile b-cover"><img src="${esc(art(album.artworkUrl100, 600))}" alt=""></div>
      <div class="tile b-title">
        <div class="eyebrow">${pos}</div>
        <h1>${esc(album.collectionName)}</h1>
        <dl class="facts"><div><dt>Year</dt><dd>${year(album.firstDate)}</dd></div><div><dt>Songs</dt><dd>${tracks.length}</dd></div><div><dt>Length</dt><dd>${Math.round(total / 60000)}m</dd></div></dl>
        ${editionChips}
      </div>
      <div class="tile b-score" id="verdict"></div>
      <div class="tile b-progress" id="progress"></div>
      <div class="tile b-listen"><div class="eyebrow">Listen on</div>${listenLinks(album.artistName, album.collectionName, album.collectionViewUrl).replace('<span class="muted">Listen on</span>', '')}</div>
      <div class="tile b-tracks"><div class="tile-head"><h2>Tracks</h2><span class="eyebrow">Tap to rate</span></div>
        <ul class="list">${tracks.map((t, n) => songRow(t, st, String(n + 1).padStart(2, '0'))).join('')}</ul></div>
      ${next ? `<a class="tile b-next" href="#/album/${artistId}/${next.collectionId}"><span class="eyebrow">Next album</span><b>${esc(next.collectionName)}</b><span class="arrow">→</span></a>`
        : `<a class="tile b-next" href="#/artist/${artistId}/rank"><span class="eyebrow">That's the latest</span><b>See your ranking</b><span class="arrow">→</span></a>`}
    </section>`;

  const renderVerdict = () => {
    const r = albumRating(st, album, tracks);
    $('#verdict').innerHTML = `
      <div class="eyebrow">${r.mine ? 'Your call' : 'Album rating · auto'}</div>
      <div class="score ${r.final ? 't-' + r.final : ''}">${r.final || '–'}</div>
      <div class="small muted">${r.mine ? `Songs average ${r.auto || '–'}. Tap your pick again to undo.` : r.auto ? `Average of ${r.rated} rated songs. Disagree? Pick one:` : 'Rate songs to get a rating.'}</div>
      ${tierBtns(st, 'albums', ak)}`;
    const pct = r.total ? Math.round(r.rated / r.total * 100) : 0;
    $('#progress').innerHTML = `<div class="eyebrow">Rated</div>
      <div class="num">${r.rated}<span>/${r.total}</span></div>
      <div class="bar"><div style="width:${pct}%"></div></div>`;
  };
  renderVerdict();
  wireSongRows($('.list'), tracks, st, renderVerdict);
  wireTierBtns($('#verdict'), st, renderVerdict);
}

// ---------- mobile: tap a song to open a rating sheet ----------
// The sheet drives the row's own (hidden) tier buttons, so saving logic stays in one place.
const isPhone = () => matchMedia('(max-width: 600px)').matches;
let sheetRow = null;
function openSheet(row) {
  sheetRow = row;
  const sheet = $('#sheet'), img = row.querySelector('img'), info = row.querySelector('.info');
  const box = row.querySelector('.tierbtns'), cur = box.querySelector('button.on')?.dataset.tier;
  sheet.querySelector('.sh-head').innerHTML = `${img ? `<img src="${img.src.replace('100x100', '300x300')}" alt="">` : ''}
    <div><div class="sh-title">${info.firstElementChild.innerHTML}</div><div class="muted">${info.lastElementChild.innerHTML}</div></div>`;
  sheet.querySelector('.sh-tiers').innerHTML = TIERS.map(t => `<button class="t-${t} ${cur === t ? 'on' : ''}" data-tier="${t}">${t}</button>`).join('');
  sheet.querySelector('[data-sh="play"]').hidden = !row.querySelector('.play');
  sheet.querySelector('[data-sh="prev"]').disabled = !row.previousElementSibling;
  sheet.querySelector('[data-sh="next"]').disabled = !row.nextElementSibling;
  sheet.classList.add('open'); $('#scrim').classList.add('open');
}
function closeSheet() { $('#sheet').classList.remove('open'); $('#scrim').classList.remove('open'); sheetRow = null; }
document.addEventListener('click', e => {
  if (!isPhone() || e.target.closest('a, .sheet, .tierbtns, .play')) return;
  const row = e.target.closest('.list .row'); if (row) openSheet(row);
});
$('#scrim').onclick = closeSheet;
$('#sheet').addEventListener('click', e => {
  if (!sheetRow) return;
  const row = sheetRow;
  const t = e.target.closest('.sh-tiers button');
  if (t) {
    row.querySelector(`.tierbtns button[data-tier="${t.dataset.tier}"]`).click();
    t.parentNode.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === t && !x.classList.contains('on')));
    const next = row.nextElementSibling;
    setTimeout(() => next ? (openSheet(next), next.scrollIntoView({ block: 'center', behavior: 'smooth' })) : closeSheet(), 220);
    return;
  }
  const a = e.target.closest('[data-sh]')?.dataset.sh;
  if (a === 'close') closeSheet();
  if (a === 'play') row.querySelector('.play')?.click();
  if (a === 'prev' && row.previousElementSibling) openSheet(row.previousElementSibling);
  if (a === 'next' && row.nextElementSibling) openSheet(row.nextElementSibling);
});

function copyText(t) {
  navigator.clipboard?.writeText(t).then(() => alert('Copied to clipboard!'), () => prompt('Copy:', t));
}

// ---------- router ----------
async function route() {
  const [, kind, a, b, c] = location.hash.split('/');
  closeSheet();
  try {
    if (kind === 'search') { $('#q').value = decodeURIComponent(a); await search(decodeURIComponent(a)); }
    else if (kind === 'artist') await artistPage(a, b || 'albums', c);
    else if (kind === 'album') await albumPage(a, b);
    else home();
  } catch (e) { console.error(e); view.innerHTML = `<p class="muted">Couldn't reach the music catalog. Try again in a moment.</p>`; }
  window.scrollTo(0, 0);
}
$('#searchForm').onsubmit = e => { e.preventDefault(); location.hash = `#/search/${encodeURIComponent($('#q').value.trim())}`; };
$('#home').onclick = e => { e.preventDefault(); location.hash = ''; };
addEventListener('hashchange', route);
route();
