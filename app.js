// MusicRank — static app, no build step. Catalog data from the iTunes Search API (JSONP, no key needed).
// Listening happens wherever you like (Spotify, Apple Music, vinyl…); this site is for ranking by hand.
const $ = (s, el = document) => el.querySelector(s);
const view = $('#view');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const art = (url, size = 600) => (url || '').replace(/\d+x\d+bb/, `${size}x${size}bb`);
const year = d => (d || '').slice(0, 4);
const fmt = ms => ms ? `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}` : '';
const TIERS = ['S', 'A', 'B', 'C', 'D', 'F'];

// ---------- storage ----------
const KEY = 'musicrank:v1';
let store;
try { store = JSON.parse(localStorage.getItem(KEY)) || {}; } catch { store = {}; }
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch {} };
function artistState(id) {
  const s = (store[id] ||= {});
  s.albumOrder ||= []; s.songOrder ||= []; s.listened ||= {}; s.name ||= ''; s.art ||= '';
  s.tiers ||= {};
  for (const k of ['albums', 'songs']) { s.tiers[k] ||= {}; TIERS.forEach(t => s.tiers[k][t] ||= []); }
  return s;
}
const tierOf = (st, kind, id) => TIERS.find(t => st.tiers[kind][t].includes(String(id))) || null;
function setTier(st, kind, id, tier, beforeId) {
  id = String(id);
  TIERS.forEach(t => { const a = st.tiers[kind][t]; const i = a.indexOf(id); if (i >= 0) a.splice(i, 1); });
  if (tier) {
    const a = st.tiers[kind][tier]; const i = beforeId ? a.indexOf(String(beforeId)) : -1;
    i >= 0 ? a.splice(i, 0, id) : a.push(id);
  }
  save();
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
async function getDiscography(artistId) {
  if (cache[artistId]) return cache[artistId];
  const d = await itunes('lookup', { id: artistId, entity: 'album', limit: 200 });
  const artist = d.results.find(r => r.wrapperType === 'artist');
  const seen = new Set();
  const albums = d.results
    .filter(r => r.wrapperType === 'collection' && String(r.artistId) === String(artistId))
    .filter(r => {
      const k = r.collectionName.toLowerCase().replace(/\s*[\(\[].*?(edition|version|remaster|deluxe|explicit|clean).*?[\)\]]/g, '').trim() + (r.trackCount > 3 ? '' : r.collectionId);
      if (seen.has(k)) return false; seen.add(k); return true;
    })
    .sort((a, b) => a.releaseDate.localeCompare(b.releaseDate));
  return (cache[artistId] = { artist, albums });
}
async function getTracks(collectionId) {
  const key = 'c' + collectionId;
  if (cache[key]) return cache[key];
  const d = await itunes('lookup', { id: collectionId, entity: 'song' });
  return (cache[key] = d.results.filter(r => r.wrapperType === 'track').sort((a, b) => a.discNumber - b.discNumber || a.trackNumber - b.trackNumber));
}
async function getAllSongs(albums) {
  const all = (await Promise.all(albums.map(a => getTracks(a.collectionId).catch(() => [])))).flat();
  const seen = new Set();
  return all.filter(t => { const k = t.trackName.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
}
const listenLinks = (artistName, title, appleUrl) => {
  const q = encodeURIComponent(`${artistName} ${title}`);
  return `<div class="links"><span class="muted">Listen on</span>
    <a target="_blank" rel="noopener" href="https://open.spotify.com/search/${q}">Spotify</a>
    ${appleUrl ? `<a target="_blank" rel="noopener" href="${esc(appleUrl)}">Apple Music</a>` : ''}
    <a target="_blank" rel="noopener" href="https://music.youtube.com/search?q=${q}">YouTube Music</a></div>`;
};

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

// ---------- tier buttons (tap while you listen) ----------
const tierBtns = (st, kind, id) => `<div class="tierbtns" data-kind="${kind}" data-id="${id}">${TIERS.map(t =>
  `<button class="t-${t} ${tierOf(st, kind, id) === t ? 'on' : ''}" data-tier="${t}">${t}</button>`).join('')}</div>`;
function wireTierBtns(root, st, after) {
  root.addEventListener('click', e => {
    const b = e.target.closest('.tierbtns button'); if (!b) return;
    const box = b.parentNode, { kind, id } = box.dataset;
    const t = tierOf(st, kind, id) === b.dataset.tier ? null : b.dataset.tier; // tap again to clear
    setTier(st, kind, id, t);
    if (kind === 'songs') st.listened[id] = true;
    box.querySelectorAll('button').forEach(x => x.classList.toggle('on', x.dataset.tier === t));
    after?.();
  });
}

// ---------- ordered list (drag + arrows) ----------
function sortable(ul, onChange) {
  let dragEl = null;
  ul.addEventListener('dragstart', e => { dragEl = e.target.closest('.row'); dragEl?.classList.add('dragging'); });
  ul.addEventListener('dragend', () => { dragEl?.classList.remove('dragging'); dragEl = null; commit(); });
  ul.addEventListener('dragover', e => {
    e.preventDefault();
    const over = e.target.closest('.row'); if (!over || !dragEl || over === dragEl) return;
    const r = over.getBoundingClientRect();
    ul.insertBefore(dragEl, e.clientY > r.top + r.height / 2 ? over.nextSibling : over);
  });
  ul.addEventListener('click', e => {
    const b = e.target.closest('[data-move]'); if (!b) return;
    const row = b.closest('.row'); const m = b.dataset.move;
    if (m === 'up' && row.previousElementSibling) ul.insertBefore(row, row.previousElementSibling);
    if (m === 'down' && row.nextElementSibling) ul.insertBefore(row.nextElementSibling, row);
    if (m === 'top') ul.prepend(row);
    commit();
  });
  function commit() {
    [...ul.children].forEach((li, i) => li.querySelector('.rk').textContent = i + 1);
    onChange([...ul.children].map(li => li.dataset.id));
  }
}
const ordered = (items, order, idOf) => {
  const pos = new Map(order.map((id, i) => [String(id), i]));
  return [...items].sort((a, b) => (pos.get(String(idOf(a))) ?? 1e9) - (pos.get(String(idOf(b))) ?? 1e9));
};
const ctl = `<div class="ctl"><button data-move="top" title="Move to #1">⤒</button><button data-move="up">▲</button><button data-move="down">▼</button></div>`;

// ---------- tier list board ----------
// Drag chips between rows (desktop), or tap a chip then tap a row (touch).
function tierBoard(el, st, kind, items, opts) {
  const byId = new Map(items.map(x => [String(opts.id(x)), x]));
  const chip = x => `<div class="chip ${kind}" draggable="true" data-id="${opts.id(x)}" title="${esc(opts.title(x))}">
    <img loading="lazy" src="${esc(art(opts.img(x), kind === 'albums' ? 200 : 100))}" alt="">${kind === 'songs' ? `<span>${esc(opts.title(x))}</span>` : `<span class="cap">${esc(opts.title(x))}</span>`}</div>`;
  let selected = null;
  function render() {
    const placed = new Set(TIERS.flatMap(t => st.tiers[kind][t]));
    const pool = items.filter(x => !placed.has(String(opts.id(x))));
    const groups = opts.group ? Object.entries(pool.reduce((g, x) => ((g[opts.group(x)] ||= []).push(x), g), {})) : [['', pool]];
    el.innerHTML = `
      <div class="tools"><button data-act="copy">Copy tier list as text</button><button data-act="clear">Clear tiers</button>
        <span class="muted hint">Drag, or tap an item then tap a tier.</span></div>
      <div class="board">${TIERS.map(t => `<div class="tier" data-tier="${t}"><div class="tlabel t-${t}">${t}</div>
        <div class="tzone" data-tier="${t}">${st.tiers[kind][t].filter(id => byId.has(id)).map(id => chip(byId.get(id))).join('')}</div></div>`).join('')}</div>
      <h2>Unranked <span class="muted">(${pool.length})</span></h2>
      <div class="pool tzone" data-tier="">${groups.map(([g, xs]) => `${g ? `<div class="pgroup">${esc(g)}</div>` : ''}${xs.map(chip).join('')}`).join('') || '<p class="muted">Everything is ranked 🎉</p>'}</div>`;
    if (selected) el.querySelector(`.chip[data-id="${selected}"]`)?.classList.add('sel');
  }
  let dragId = null;
  el.ondragstart = e => { const c = e.target.closest('.chip'); if (c) { dragId = c.dataset.id; e.dataTransfer.setData('text/plain', dragId); } };
  el.ondragover = e => { const z = e.target.closest('.tzone'); if (z) { e.preventDefault(); z.classList.add('over'); } };
  el.ondragleave = e => e.target.closest('.tzone')?.classList.remove('over');
  el.ondrop = e => {
    const z = e.target.closest('.tzone'); if (!z || !dragId) return; e.preventDefault();
    const before = e.target.closest('.chip')?.dataset.id;
    setTier(st, kind, dragId, z.dataset.tier || null, before !== dragId ? before : undefined);
    dragId = null; render();
  };
  el.onclick = e => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'copy') return copyText(`${opts.heading}\n` + TIERS.map(t => `${t}: ${st.tiers[kind][t].filter(id => byId.has(id)).map(id => opts.title(byId.get(id))).join(', ')}`).join('\n'));
    if (act === 'clear') { if (confirm('Clear this tier list?')) { TIERS.forEach(t => st.tiers[kind][t] = []); save(); render(); } return; }
    const c = e.target.closest('.chip');
    if (c && !selected) { selected = c.dataset.id; render(); return; }
    if (c && selected === c.dataset.id) { selected = null; render(); return; }
    const z = e.target.closest('.tier, .pool');
    if (selected && (z || c)) {
      const tier = (z || c.closest('.tier, .pool')).dataset.tier || null;
      setTier(st, kind, selected, tier, c?.dataset.id); selected = null; render();
    }
  };
  render();
}

// ---------- views ----------
function home() {
  const mine = Object.entries(store).filter(([, s]) => s.name);
  view.innerHTML = `<div class="empty"><h1>Listen anywhere.<br>Rank it here.</h1>
    <p class="muted">Pick an artist, play their discography on whatever you use, and tap S–F on each song as it plays.<br>Then drag everything into tier lists and rankings. No typing.</p></div>
    ${mine.length ? `<h2>Your artists</h2><div class="grid">${mine.map(([id, s]) => `
      <a class="card" href="#/artist/${id}"><img src="${esc(s.art)}" alt=""><div class="t">${esc(s.name)}</div></a>`).join('')}</div>` : ''}`;
}

async function search(q) {
  view.innerHTML = `<p class="muted">Searching…</p>`;
  const d = await itunes('search', { term: q, entity: 'musicArtist', limit: 12 });
  if (!d.results.length) { view.innerHTML = `<p class="muted">No artists found for “${esc(q)}”.</p>`; return; }
  const covers = await Promise.all(d.results.map(a => itunes('lookup', { id: a.artistId, entity: 'album', limit: 1 }).then(r => r.results.find(x => x.wrapperType === 'collection')?.artworkUrl100).catch(() => '')));
  view.innerHTML = `<h2>Artists matching “${esc(q)}”</h2><div class="grid">${d.results.map((a, i) => `
    <a class="card" href="#/artist/${a.artistId}"><img src="${esc(art(covers[i], 300))}" alt="">
    <div class="t">${esc(a.artistName)}</div><div class="s">${esc(a.primaryGenreName || '')}</div></a>`).join('')}</div>`;
}

const TABS = [['albums', 'Discography'], ['albumtiers', 'Album tier list'], ['songtiers', 'Song tier list'], ['rank', 'Album ranking'], ['songs', 'Song ranking']];

async function artistPage(id, tab = 'albums') {
  view.innerHTML = `<p class="muted">Loading discography…</p>`;
  const { artist, albums } = await getDiscography(id);
  if (!artist) { view.innerHTML = `<p class="muted">Artist not found.</p>`; return; }
  const st = artistState(id);
  st.name = artist.artistName; st.art = art(albums.at(-1)?.artworkUrl100, 300); save();
  const totalTracks = albums.reduce((s, a) => s + a.trackCount, 0);
  const rated = TIERS.reduce((s, t) => s + st.tiers.songs[t].length, 0);
  const pct = totalTracks ? Math.min(100, Math.round((rated / totalTracks) * 100)) : 0;

  view.innerHTML = `
    <div class="hero"><img src="${esc(art(albums.at(-1)?.artworkUrl100, 400))}" alt="">
      <div><div class="muted">Artist</div><h1>${esc(artist.artistName)}</h1>
      <div class="muted">${albums.length} releases · ${totalTracks} tracks · ${esc(artist.primaryGenreName || '')}</div>
      <div class="prog"><div style="width:${pct}%"></div></div><div class="muted">${rated} songs rated (${pct}%)</div></div></div>
    <div class="tabs">${TABS.map(([k, l]) => `<button data-tab="${k}" class="${tab === k ? 'on' : ''}">${l}</button>`).join('')}</div><div id="tab"></div>`;
  view.querySelector('.tabs').onclick = e => { const t = e.target.dataset.tab; if (t) location.hash = `#/artist/${id}/${t}`; };
  const el = $('#tab');

  if (tab === 'albums') {
    el.innerHTML = `<p class="muted">Open an album, put it on wherever you listen, and tap a tier for each song as it plays.</p><div class="grid">${albums.map(a => {
      const t = tierOf(st, 'albums', a.collectionId);
      return `<a class="card" href="#/album/${id}/${a.collectionId}">${t ? `<span class="badge t-${t}">${t}</span>` : ''}
        <img loading="lazy" src="${esc(art(a.artworkUrl100, 400))}" alt=""><div class="t">${esc(a.collectionName)}</div>
        <div class="s">${year(a.releaseDate)} · ${a.trackCount} tracks</div></a>`;
    }).join('')}</div>`;
  }

  if (tab === 'albumtiers') tierBoard(el, st, 'albums', albums, {
    id: a => a.collectionId, title: a => a.collectionName, img: a => a.artworkUrl100, heading: `${artist.artistName} — album tier list`,
  });

  if (tab === 'songtiers') {
    el.innerHTML = `<p class="muted">Loading all songs…</p>`;
    const songs = await getAllSongs(albums);
    tierBoard(el, st, 'songs', songs, {
      id: t => t.trackId, title: t => t.trackName, img: t => t.artworkUrl100, group: t => t.collectionName, heading: `${artist.artistName} — song tier list`,
    });
  }

  if (tab === 'rank') {
    const tierRank = a => { const t = tierOf(st, 'albums', a.collectionId); return t ? TIERS.indexOf(t) : 9; };
    const list = ordered(albums, st.albumOrder, a => a.collectionId);
    el.innerHTML = `<div class="tools"><button id="share">Copy ranking as text</button><button id="bytier">Order by tier</button><button id="reset">Reset</button></div>
      <p class="muted">Drag rows (or use the arrows). #1 is your favorite.</p>
      <ul class="list">${list.map((a, i) => `<li class="row" draggable="true" data-id="${a.collectionId}">
        <span class="handle">⋮⋮</span><span class="rk">${i + 1}</span><img loading="lazy" src="${esc(art(a.artworkUrl100, 100))}" alt="">
        <div class="info"><div><a href="#/album/${id}/${a.collectionId}">${esc(a.collectionName)}</a></div><div class="s">${year(a.releaseDate)}</div></div>
        ${tierBtns(st, 'albums', a.collectionId)}${ctl}</li>`).join('')}</ul>`;
    if (!st.albumOrder.length) { st.albumOrder = list.map(a => String(a.collectionId)); save(); }
    sortable($('.list', el), o => { st.albumOrder = o; save(); });
    wireTierBtns(el, st);
    $('#bytier').onclick = () => { st.albumOrder = ordered(albums, st.albumOrder, a => a.collectionId).sort((a, b) => tierRank(a) - tierRank(b)).map(a => String(a.collectionId)); save(); artistPage(id, 'rank'); };
    $('#reset').onclick = () => { if (confirm('Reset album ranking?')) { st.albumOrder = []; save(); artistPage(id, 'rank'); } };
    $('#share').onclick = () => copyText(`My ${artist.artistName} album ranking\n` +
      st.albumOrder.map((cid, i) => `${i + 1}. ${albums.find(a => String(a.collectionId) === cid)?.collectionName}`).join('\n'));
  }

  if (tab === 'songs') {
    el.innerHTML = `<p class="muted">Loading all songs…</p>`;
    const songs = await getAllSongs(albums);
    const tierRank = t => { const x = tierOf(st, 'songs', t.trackId); return x ? TIERS.indexOf(x) : 9; };
    const list = ordered(songs, st.songOrder, t => t.trackId);
    el.innerHTML = `<div class="tools"><button id="share">Copy top 25 as text</button><button id="bytier">Order by tier</button><button id="reset">Reset</button></div>
      <p class="muted">${songs.length} songs. Tip: tier them first, hit “Order by tier”, then fine-tune by dragging.</p>
      <ul class="list">${list.map((t, i) => songRow(t, i, st, true)).join('')}</ul>`;
    if (!st.songOrder.length) { st.songOrder = list.map(t => String(t.trackId)); save(); }
    const ul = $('.list', el);
    sortable(ul, o => { st.songOrder = o; save(); });
    wireSongRows(ul, songs, st);
    $('#bytier').onclick = () => { st.songOrder = [...list].sort((a, b) => tierRank(a) - tierRank(b)).map(t => String(t.trackId)); save(); artistPage(id, 'songs'); };
    $('#reset').onclick = () => { if (confirm('Reset song ranking?')) { st.songOrder = []; save(); artistPage(id, 'songs'); } };
    $('#share').onclick = () => copyText(`My top ${artist.artistName} songs\n` +
      st.songOrder.slice(0, 25).map((tid, i) => `${i + 1}. ${songs.find(t => String(t.trackId) === tid)?.trackName}`).join('\n'));
  }
}

function songRow(t, i, st, showAlbum) {
  return `<li class="row" draggable="true" data-id="${t.trackId}">
    <span class="handle">⋮⋮</span><span class="rk">${i + 1}</span>
    ${showAlbum ? `<img loading="lazy" src="${esc(art(t.artworkUrl100, 100))}" alt="">` : ''}
    <div class="info"><div>${esc(t.trackName)}</div><div class="s">${showAlbum ? esc(t.collectionName) + ' · ' : ''}${fmt(t.trackTimeMillis)}</div></div>
    ${t.previewUrl ? `<button class="play" data-id="${t.trackId}" title="30s preview">▶</button>` : ''}
    ${tierBtns(st, 'songs', t.trackId)}${ctl}</li>`;
}
function wireSongRows(ul, tracks, st, after) {
  ul.addEventListener('click', e => { const p = e.target.closest('.play'); if (p) play(tracks.find(t => t.trackId === +p.dataset.id)); });
  wireTierBtns(ul, st, after);
}

async function albumPage(artistId, cid) {
  view.innerHTML = `<p class="muted">Loading album…</p>`;
  const [{ albums }, tracks] = await Promise.all([getDiscography(artistId), getTracks(cid)]);
  const album = albums.find(a => String(a.collectionId) === String(cid)) || tracks[0];
  const st = artistState(artistId);
  const ok = 'o' + cid;
  st[ok] ||= [];
  const list = ordered(tracks, st[ok], t => t.trackId);
  const total = tracks.reduce((s, t) => s + (t.trackTimeMillis || 0), 0);
  const i = albums.indexOf(album), prev = albums[i - 1], next = albums[i + 1];
  const counter = () => `${tracks.filter(t => tierOf(st, 'songs', t.trackId)).length} / ${tracks.length} rated`;
  view.innerHTML = `<div class="nav"><a class="muted" href="#/artist/${artistId}">← ${esc(album.artistName)}</a>
      <span>${prev ? `<a class="muted" href="#/album/${artistId}/${prev.collectionId}">‹ Prev album</a>` : ''}
      ${next ? `<a class="muted" href="#/album/${artistId}/${next.collectionId}">Next album ›</a>` : ''}</span></div>
    <div class="hero"><img src="${esc(art(album.artworkUrl100, 600))}" alt="">
      <div><div class="muted">${year(album.releaseDate)} · ${tracks.length} songs · ${Math.round(total / 60000)} min</div>
      <h1>${esc(album.collectionName)}</h1>
      ${listenLinks(album.artistName, album.collectionName, album.collectionViewUrl)}
      <div class="albtier"><span class="muted">Album tier</span>${tierBtns(st, 'albums', cid)}</div></div></div>
    <h2>Tap a tier as each song plays <span class="muted" id="cnt">${counter()}</span></h2>
    <ul class="list">${list.map((t, i) => songRow(t, i, st, false)).join('')}</ul>
    <p class="muted">Drag or use the arrows to put this album's tracks in order.</p>`;
  const ul = $('.list');
  sortable(ul, o => { st[ok] = o; save(); });
  wireSongRows(ul, tracks, st, () => { $('#cnt').textContent = counter(); });
  wireTierBtns($('.hero'), st);
}

function copyText(t) {
  navigator.clipboard?.writeText(t).then(() => alert('Copied to clipboard!'), () => prompt('Copy:', t));
}

// ---------- router ----------
async function route() {
  const [, kind, a, b] = location.hash.split('/');
  try {
    if (kind === 'search') { $('#q').value = decodeURIComponent(a); await search(decodeURIComponent(a)); }
    else if (kind === 'artist') await artistPage(a, b || 'albums');
    else if (kind === 'album') await albumPage(a, b);
    else home();
  } catch (e) { console.error(e); view.innerHTML = `<p class="muted">Couldn't reach the music catalog. Try again in a moment.</p>`; }
  window.scrollTo(0, 0);
}
$('#searchForm').onsubmit = e => { e.preventDefault(); location.hash = `#/search/${encodeURIComponent($('#q').value.trim())}`; };
$('#home').onclick = e => { e.preventDefault(); location.hash = ''; };
addEventListener('hashchange', route);
route();
