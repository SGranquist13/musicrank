// MusicRank — static app, no build step. Data from the iTunes Search API (JSONP, no key needed).
const $ = (s, el = document) => el.querySelector(s);
const view = $('#view');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const art = (url, size = 600) => (url || '').replace(/\d+x\d+bb/, `${size}x${size}bb`);
const year = d => (d || '').slice(0, 4);

// ---------- storage ----------
const KEY = 'musicrank:v1';
let store;
try { store = JSON.parse(localStorage.getItem(KEY)) || {}; } catch { store = {}; }
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch {} };
const artistState = id => (store[id] ||= { albumOrder: [], songOrder: [], listened: {}, stars: {}, name: '', art: '' });

// ---------- api ----------
let cb = 0;
function itunes(path, params) {
  return new Promise((resolve, reject) => {
    const name = `__it${++cb}`;
    const qs = new URLSearchParams({ ...params, callback: name });
    const s = document.createElement('script');
    const t = setTimeout(() => { cleanup(); reject(new Error('timeout')); }, 15000);
    const cleanup = () => { clearTimeout(t); delete window[name]; s.remove(); };
    window[name] = d => { cleanup(); resolve(d); };
    s.onerror = () => { cleanup(); reject(new Error('network')); };
    s.src = `https://itunes.apple.com/${path}?${qs}`;
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
    .filter(r => { // dedupe clean/explicit + reissues with same title
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

// ---------- player ----------
const audio = $('#audio');
let playing = null;
function play(track) {
  if (playing === track.trackId && !audio.paused) { audio.pause(); return; }
  if (playing !== track.trackId) {
    if (!track.previewUrl) return alert('No preview available for this track.');
    audio.src = track.previewUrl; playing = track.trackId;
    $('#pArt').src = art(track.artworkUrl100, 100);
    $('#pTitle').textContent = track.trackName;
    $('#pSub').textContent = `${track.artistName} — ${track.collectionName}`;
    $('#player').classList.remove('hidden');
  }
  audio.play();
}
audio.onplay = audio.onpause = () => {
  $('#pToggle').textContent = audio.paused ? '▶' : '❚❚';
  document.querySelectorAll('.play').forEach(b => b.classList.toggle('on', !audio.paused && +b.dataset.id === playing));
};
audio.ontimeupdate = () => { $('#pProg').style.width = (audio.currentTime / (audio.duration || 30)) * 100 + '%'; };
audio.onended = () => { // auto-advance to the next playable button on screen
  const btns = [...document.querySelectorAll('.play')];
  const i = btns.findIndex(b => +b.dataset.id === playing);
  if (i >= 0 && btns[i + 1]) btns[i + 1].click();
};
$('#pToggle').onclick = () => audio.paused ? audio.play() : audio.pause();

// ---------- drag-and-drop ranking list ----------
function sortable(ul, onChange) {
  let dragEl = null;
  ul.addEventListener('dragstart', e => { dragEl = e.target.closest('.row'); dragEl?.classList.add('dragging'); });
  ul.addEventListener('dragend', () => { dragEl?.classList.remove('dragging'); ul.querySelectorAll('.over').forEach(x => x.classList.remove('over')); dragEl = null; });
  ul.addEventListener('dragover', e => {
    e.preventDefault();
    const over = e.target.closest('.row'); if (!over || over === dragEl) return;
    const r = over.getBoundingClientRect();
    over.parentNode.insertBefore(dragEl, e.clientY > r.top + r.height / 2 ? over.nextSibling : over);
  });
  ul.addEventListener('drop', e => { e.preventDefault(); commit(); });
  ul.addEventListener('click', e => {
    const b = e.target.closest('[data-move]'); if (!b) return;
    const row = b.closest('.row'); const m = b.dataset.move;
    if (m === 'up' && row.previousElementSibling) row.parentNode.insertBefore(row, row.previousElementSibling);
    if (m === 'down' && row.nextElementSibling) row.parentNode.insertBefore(row.nextElementSibling, row);
    if (m === 'top') row.parentNode.prepend(row);
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
const stars = (st, id) => `<div class="stars" data-id="${id}">${[1, 2, 3, 4, 5].map(n => `<span data-n="${n}" class="${(st.stars[id] || 0) >= n ? 'on' : ''}">★</span>`).join('')}</div>`;
function wireStars(root, st, rerender) {
  root.addEventListener('click', e => {
    const s = e.target.closest('.stars span'); if (!s) return;
    const id = s.parentNode.dataset.id, n = +s.dataset.n;
    st.stars[id] = st.stars[id] === n ? 0 : n; save(); rerender?.();
    s.parentNode.querySelectorAll('span').forEach(x => x.classList.toggle('on', +x.dataset.n <= st.stars[id]));
  });
}
const ctl = `<div class="ctl"><button data-move="top" title="Move to #1">⤒</button><button data-move="up">▲</button><button data-move="down">▼</button></div>`;

// ---------- views ----------
function home() {
  const mine = Object.entries(store).filter(([, s]) => s.name);
  view.innerHTML = `<div class="empty"><h1>Rank every album.<br>Rank every song.</h1>
    <p class="muted">Search an artist, listen through their whole discography, and build your definitive ranking.</p></div>
    ${mine.length ? `<h2>Your artists</h2><div class="grid">${mine.map(([id, s]) => `
      <a class="card" href="#/artist/${id}"><img src="${esc(s.art)}" alt=""><div class="t">${esc(s.name)}</div>
      <div class="s">${s.albumOrder.length} albums ranked</div></a>`).join('')}</div>` : ''}`;
}

async function search(q) {
  view.innerHTML = `<p class="muted">Searching…</p>`;
  const d = await itunes('search', { term: q, entity: 'musicArtist', limit: 12 });
  if (!d.results.length) { view.innerHTML = `<p class="muted">No artists found for “${esc(q)}”.</p>`; return; }
  // fetch a representative album cover per artist
  const covers = await Promise.all(d.results.map(a => itunes('lookup', { id: a.artistId, entity: 'album', limit: 1 }).then(r => r.results.find(x => x.wrapperType === 'collection')?.artworkUrl100).catch(() => '')));
  view.innerHTML = `<h2>Artists matching “${esc(q)}”</h2><div class="grid">${d.results.map((a, i) => `
    <a class="card" href="#/artist/${a.artistId}"><img src="${esc(art(covers[i], 300))}" alt="">
    <div class="t">${esc(a.artistName)}</div><div class="s">${esc(a.primaryGenreName || '')}</div></a>`).join('')}</div>`;
}

async function artistPage(id, tab = 'albums') {
  view.innerHTML = `<p class="muted">Loading discography…</p>`;
  const { artist, albums } = await getDiscography(id);
  if (!artist) { view.innerHTML = `<p class="muted">Artist not found.</p>`; return; }
  const st = artistState(id);
  st.name = artist.artistName; st.art = art(albums.at(-1)?.artworkUrl100, 300); save();

  const tracksPerAlbum = albums.map(a => a.trackCount);
  const totalTracks = tracksPerAlbum.reduce((x, y) => x + y, 0);
  const listened = Object.values(st.listened).filter(Boolean).length;
  const pct = totalTracks ? Math.min(100, Math.round((listened / totalTracks) * 100)) : 0;

  view.innerHTML = `
    <div class="hero"><img src="${esc(art(albums.at(-1)?.artworkUrl100, 400))}" alt="">
      <div><div class="muted">Artist</div><h1>${esc(artist.artistName)}</h1>
      <div class="muted">${albums.length} releases · ${totalTracks} tracks · ${esc(artist.primaryGenreName || '')}</div>
      <div class="prog"><div style="width:${pct}%"></div></div><div class="muted">${listened} / ${totalTracks} songs listened (${pct}%)</div></div></div>
    <div class="tabs">
      <button data-tab="albums" class="${tab === 'albums' ? 'on' : ''}">Discography</button>
      <button data-tab="rank" class="${tab === 'rank' ? 'on' : ''}">Album ranking</button>
      <button data-tab="songs" class="${tab === 'songs' ? 'on' : ''}">Song ranking</button>
    </div><div id="tab"></div>`;
  view.querySelector('.tabs').onclick = e => { const t = e.target.dataset.tab; if (t) location.hash = `#/artist/${id}/${t}`; };
  const el = $('#tab');

  if (tab === 'albums') {
    const rankOf = new Map(st.albumOrder.map((x, i) => [String(x), i + 1]));
    el.innerHTML = `<p class="muted">Chronological. Click an album to listen and rank its songs.</p><div class="grid">${albums.map(a => {
      const r = rankOf.get(String(a.collectionId));
      const done = st.listened['a' + a.collectionId];
      return `<a class="card" href="#/album/${id}/${a.collectionId}">${r ? `<span class="badge ${done ? 'done' : ''}">#${r}</span>` : done ? '<span class="badge done">✓</span>' : ''}
        <img loading="lazy" src="${esc(art(a.artworkUrl100, 400))}" alt=""><div class="t">${esc(a.collectionName)}</div>
        <div class="s">${year(a.releaseDate)} · ${a.trackCount} tracks</div></a>`;
    }).join('')}</div>`;
  }

  if (tab === 'rank') {
    const list = ordered(albums, st.albumOrder, a => a.collectionId);
    el.innerHTML = `<div class="tools"><button id="share">Copy ranking as text</button><button id="reset">Reset to chronological</button></div>
      <p class="muted">Drag rows (or use arrows) to rank. #1 is your favorite.</p>
      <ul class="list">${list.map((a, i) => `<li class="row" draggable="true" data-id="${a.collectionId}">
        <span class="handle">⋮⋮</span><span class="rk">${i + 1}</span><img loading="lazy" src="${esc(art(a.artworkUrl100, 100))}" alt="">
        <div class="info"><div><a href="#/album/${id}/${a.collectionId}">${esc(a.collectionName)}</a></div><div class="s">${year(a.releaseDate)} · ${a.trackCount} tracks</div></div>
        ${stars(st, 'a' + a.collectionId)}${ctl}</li>`).join('')}</ul>`;
    if (!st.albumOrder.length) { st.albumOrder = list.map(a => String(a.collectionId)); save(); }
    sortable($('.list', el), o => { st.albumOrder = o; save(); });
    wireStars(el, st);
    $('#reset').onclick = () => { if (confirm('Reset album ranking?')) { st.albumOrder = []; save(); artistPage(id, 'rank'); } };
    $('#share').onclick = () => copyText(`My ${artist.artistName} album ranking\n` +
      st.albumOrder.map((cid, i) => `${i + 1}. ${albums.find(a => String(a.collectionId) === cid)?.collectionName}`).join('\n'));
  }

  if (tab === 'songs') {
    el.innerHTML = `<p class="muted">Loading all songs…</p>`;
    const all = (await Promise.all(albums.map(a => getTracks(a.collectionId).catch(() => [])))).flat();
    const seen = new Set();
    const songs = all.filter(t => { const k = t.trackName.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
    const list = ordered(songs, st.songOrder, t => t.trackId);
    el.innerHTML = `<div class="tools"><button id="share">Copy top 25 as text</button><button id="bystars">Sort by stars</button><button id="reset">Reset</button></div>
      <p class="muted">${songs.length} unique songs. Drag to rank, ▶ to preview.</p>
      <ul class="list">${list.map((t, i) => songRow(t, i, st, true)).join('')}</ul>`;
    if (!st.songOrder.length) { st.songOrder = list.map(t => String(t.trackId)); save(); }
    const ul = $('.list', el);
    sortable(ul, o => { st.songOrder = o; save(); });
    wireSongRows(ul, songs, st);
    $('#reset').onclick = () => { if (confirm('Reset song ranking?')) { st.songOrder = []; save(); artistPage(id, 'songs'); } };
    $('#bystars').onclick = () => { st.songOrder = [...list].sort((a, b) => (st.stars[b.trackId] || 0) - (st.stars[a.trackId] || 0)).map(t => String(t.trackId)); save(); artistPage(id, 'songs'); };
    $('#share').onclick = () => copyText(`My top ${artist.artistName} songs\n` +
      st.songOrder.slice(0, 25).map((tid, i) => `${i + 1}. ${songs.find(t => String(t.trackId) === tid)?.trackName}`).join('\n'));
  }
}

function songRow(t, i, st, showAlbum) {
  return `<li class="row" draggable="true" data-id="${t.trackId}">
    <span class="handle">⋮⋮</span><span class="rk">${i + 1}</span>
    ${showAlbum ? `<img loading="lazy" src="${esc(art(t.artworkUrl100, 100))}" alt="">` : ''}
    <button class="play" data-id="${t.trackId}" ${t.previewUrl ? '' : 'disabled'}>▶</button>
    <div class="info"><div>${esc(t.trackName)}</div><div class="s">${showAlbum ? esc(t.collectionName) + ' · ' : ''}${fmt(t.trackTimeMillis)}</div></div>
    <input type="checkbox" class="listened" title="Listened" data-id="${t.trackId}" ${st.listened[t.trackId] ? 'checked' : ''}>
    ${stars(st, t.trackId)}${ctl}</li>`;
}
function wireSongRows(ul, tracks, st, onListen) {
  ul.addEventListener('click', e => {
    const p = e.target.closest('.play'); if (p) play(tracks.find(t => t.trackId === +p.dataset.id));
  });
  ul.addEventListener('change', e => {
    if (!e.target.matches('.listened')) return;
    st.listened[e.target.dataset.id] = e.target.checked; save(); onListen?.();
  });
  audio.addEventListener('play', () => { if (playing) { st.listened[playing] = true; save(); const c = ul.querySelector(`.listened[data-id="${playing}"]`); if (c) c.checked = true; } });
  wireStars(ul, st);
}
const fmt = ms => ms ? `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}` : '';

async function albumPage(artistId, cid) {
  view.innerHTML = `<p class="muted">Loading album…</p>`;
  const [{ albums }, tracks] = await Promise.all([getDiscography(artistId), getTracks(cid)]);
  const album = albums.find(a => String(a.collectionId) === String(cid)) || tracks[0];
  const st = artistState(artistId);
  const ok = 'o' + cid;
  st[ok] ||= [];
  const list = ordered(tracks, st[ok], t => t.trackId);
  const total = tracks.reduce((s, t) => s + (t.trackTimeMillis || 0), 0);
  view.innerHTML = `<p><a class="muted" href="#/artist/${artistId}">← ${esc(album.artistName)}</a></p>
    <div class="hero"><img src="${esc(art(album.artworkUrl100, 600))}" alt="">
      <div><div class="muted">${year(album.releaseDate)} · ${tracks.length} songs · ${Math.round(total / 60000)} min</div>
      <h1>${esc(album.collectionName)}</h1>
      <div class="tools"><button id="playAll">▶ Play all previews</button>
      <label class="muted"><input type="checkbox" class="listened" id="albDone" ${st.listened['a' + cid] ? 'checked' : ''}> Album fully listened</label>
      ${stars(st, 'a' + cid)}</div></div></div>
    <h2>Rank the tracks</h2>
    <ul class="list">${list.map((t, i) => songRow(t, i, st, false)).join('')}</ul>`;
  const ul = $('.list');
  sortable(ul, o => { st[ok] = o; save(); });
  wireSongRows(ul, tracks, st);
  wireStars($('.hero'), st);
  $('#albDone').onchange = e => { st.listened['a' + cid] = e.target.checked; save(); };
  $('#playAll').onclick = () => ul.querySelector('.play:not([disabled])')?.click();
}

function copyText(t) {
  navigator.clipboard?.writeText(t).then(() => alert('Copied to clipboard!'), () => prompt('Copy your ranking:', t));
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
