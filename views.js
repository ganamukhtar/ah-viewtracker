import { DEFAULT_FILTER, aggregate, growthFor, rankAccounts, toggleSelection } from '/lib/aggregate.js';
import { chooseRate, measuredRate } from '/lib/project.js';
import { createLiveCounter, introDisplay, INTRO_MS } from '/lib/live.js';
import { PLATFORM_LABELS, PLATFORM_ORDER } from '/lib/platforms.js';

const CATEGORIES = [
  { id: 'all', label: 'All' },
  { id: 'quests', label: 'Quests' },
  { id: 'fan', label: 'Fan & news pages' },
  { id: 'creators', label: 'Creators' },
];
const LABELS = { quests: 'Quests', fan: 'Fan & news pages', creators: 'Creators' };
const page = document.body.dataset.page || 'home';
const state = {
  snapshot: null,
  error: '',
  categories: [...DEFAULT_FILTER.categories],
  platforms: [...DEFAULT_FILTER.platforms],
  query: '',
  sort: 'views',
  dir: 'desc',
  expanded: new Set(),
  rate: 0,
};
let counter = createLiveCounter();
let view = null;
let totals = null;
const intro = { startedAt: 0, reduced: false };

const q = (sel, root = document) => root.querySelector(sel);

function marked(platform, text) {
  const wrap = document.createElement('span');
  wrap.className = 'av-with-icon';
  if (platform !== 'x') wrap.append(icon(platform));
  wrap.append(document.createTextNode(text));
  return wrap;
}

function icon(platform) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('av-icon');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  const shapes = {
    tiktok: 'M14 3.5c.6 2.4 2 3.8 4.2 4.1v2.7c-1.5 0-2.9-.5-4.2-1.3v6.6a5.6 5.6 0 1 1-5.6-5.6c.3 0 .6 0 .9.1v2.8a2.8 2.8 0 1 0 1.9 2.7V3.5H14z',
    instagram: 'M8 3.5h8A4.5 4.5 0 0 1 20.5 8v8a4.5 4.5 0 0 1-4.5 4.5H8A4.5 4.5 0 0 1 3.5 16V8A4.5 4.5 0 0 1 8 3.5zm8 2H8A2.5 2.5 0 0 0 5.5 8v8A2.5 2.5 0 0 0 8 18.5h8a2.5 2.5 0 0 0 2.5-2.5V8A2.5 2.5 0 0 0 16 5.5zM12 8.2A3.8 3.8 0 1 1 8.2 12 3.8 3.8 0 0 1 12 8.2zm0 2A1.8 1.8 0 1 0 13.8 12 1.8 1.8 0 0 0 12 10.2zM17.2 6.4a1.1 1.1 0 1 1-1.1 1.1 1.1 1.1 0 0 1 1.1-1.1z',
    youtube: 'M4 7.2h16a2 2 0 0 1 2 2v5.6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9.2a2 2 0 0 1 2-2zm6.2 1.9v5.8l5-2.9z',
    x: 'M4.2 4.5h4.1l3.6 5 3.8-5h3.9l-6 7.7 6.4 7.3h-4.1l-4-5.4-4.2 5.4H3.8l6.4-8.1z',
    facebook: 'M14.2 3.5H11.6C9.5 3.5 8.4 4.7 8.4 6.8v1.7H6.3v2.8h2.1v9.2h2.9v-9.2h2.4l.4-2.8h-2.8V7.1c0-.8.2-1.2 1.2-1.2h1.7V3.5z',
  };
  path.setAttribute('d', shapes[platform] || shapes.x);
  path.setAttribute('fill', 'currentColor');
  path.setAttribute('fill-rule', 'evenodd');
  svg.append(path);
  return svg;
}

function fmt(value) {
  return typeof value === 'number' ? value.toLocaleString('en-US') : '';
}

function checkedLine(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Checking the latest reports…';
  const time = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return `Feed checked ${date.getMonth() + 1}/${date.getDate()}, ${time}`;
}

function currentFilter() {
  if (page === 'home') return DEFAULT_FILTER;
  return { categories: state.categories, platforms: state.platforms, query: state.query };
}

/** Chip filters only. Typing in search narrows the list but never changes a total. */
function totalsFilter() {
  if (page === 'home') return DEFAULT_FILTER;
  return { categories: state.categories, platforms: state.platforms, query: '' };
}

function paintStat(name, value) {
  const node = q(`[data-stat="${name}"]`);
  if (!node) return;
  if (!state.snapshot) {
    node.textContent = '…';
    node.classList.add('is-missing');
    return;
  }
  if (typeof value !== 'number') {
    node.textContent = '—';
    node.classList.add('is-missing');
    return;
  }
  node.textContent = Math.floor(value).toLocaleString('en-US');
  node.classList.remove('is-missing');
}

function introSeen() {
  try { return sessionStorage.getItem('av-intro-played') === '1'; }
  catch { return false; }
}

function markIntroSeen() {
  try { sessionStorage.setItem('av-intro-played', '1'); }
  catch { /* private mode */ }
}

function beginIntro(now) {
  if (intro.startedAt) return;
  intro.startedAt = now;
  intro.reduced = introSeen() || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  markIntroSeen();
  if (!intro.reduced) requestAnimationFrame(runIntro);
}

function runIntro() {
  paintFigure();
  if (Date.now() - intro.startedAt < INTRO_MS) requestAnimationFrame(runIntro);
}

function displayValue(live, now = Date.now()) {
  if (!intro.startedAt) return live;
  return introDisplay(live, now - intro.startedAt, INTRO_MS, intro.reduced);
}

function heroHasNumber() {
  if (typeof totals?.views === 'number') return true;
  return ['followers', 'likes', 'comments'].some((key) => typeof totals?.[key] === 'number');
}

function paintFigure(now = Date.now()) {
  const figure = q('[data-figure]');
  const valueNode = q('[data-value]');
  const rise = q('[data-rise]');
  const value = displayValue(counter.sample(now), now);
  const whole = typeof value === 'number' ? Math.floor(value) : null;
  if (whole == null) {
    valueNode.textContent = state.snapshot ? 'Views unavailable' : 'Checking…';
    valueNode.classList.add('is-text');
    if (rise) rise.hidden = true;
  } else {
    valueNode.textContent = whole.toLocaleString('en-US');
    valueNode.classList.remove('is-text');
    if (rise) rise.hidden = !(state.rate > 0);
  }
  paintStat('followers', displayValue(totals?.followers, now));
  paintStat('likes', displayValue(totals?.likes, now));
  paintStat('comments', displayValue(totals?.comments, now));
  const confirmed = state.snapshot ? checkedLine(state.snapshot.checkedAt) : 'Checking the latest reports…';
  const line = q('[data-confirmed]');
  if (line.textContent !== confirmed) line.textContent = confirmed;
  q('[data-label]').classList.toggle('is-waiting', !state.snapshot);
  const spoken = whole == null ? confirmed : `${whole.toLocaleString('en-US')} views. ${confirmed}`;
  if (figure.getAttribute('aria-label') !== spoken) figure.setAttribute('aria-label', spoken);
}

function retarget(reset) {
  const now = Date.now();
  view = state.snapshot ? aggregate(state.snapshot, currentFilter()) : null;
  totals = state.snapshot ? aggregate(state.snapshot, totalsFilter()) : null;
  if (!totals || typeof totals.views !== 'number') {
    counter = createLiveCounter();
    state.rate = 0;
  } else {
    const measured = measuredRate(state.snapshot.history, { accounts: state.snapshot.accounts }, totalsFilter());
    const choice = chooseRate(measured.perSecond, totals.velocityPerSecond);
    if (reset) counter = createLiveCounter();
    state.rate = choice.perSecond;
    counter.push(totals.views, choice.perSecond, now);
  }
  if (heroHasNumber()) beginIntro(now);
  paintFigure(now);
}

function metricCell(value, partial) {
  const span = document.createElement('span');
  if (typeof value !== 'number') {
    span.textContent = '—';
    span.title = 'No verified count available';
    span.className = 'av-missing';
    return span;
  }
  span.textContent = value.toLocaleString('en-US');
  if (value === 0) span.title = 'Observed zero. This source is connected.';
  return span;
}

function growthCell(growth) {
  const span = document.createElement('span');
  if (!growth) {
    span.textContent = '—';
    span.className = 'av-missing';
    span.title = 'Needs a snapshot about 24 hours older than this one.';
    return span;
  }
  const arrow = growth.delta > 0 ? '↑ ' : growth.delta < 0 ? '↓ ' : '';
  span.textContent = arrow + (growth.delta > 0 ? '+' : '') + growth.delta.toLocaleString('en-US');
  span.className = growth.delta > 0 ? 'av-growth-up' : growth.delta < 0 ? 'av-growth-down' : '';
  span.title = `View change since ${checkedLine(new Date(growth.from).toISOString()).replace('Feed checked ', '')}`;
  return span;
}

function profileLinks(platform) {
  if (Array.isArray(platform.links) && platform.links.length) return platform.links.filter((item) => item?.url);
  return platform.url ? [{ handle: platform.handle, url: platform.url }] : [];
}

function platformLine(platform) {
  const item = document.createElement('li');
  const links = profileLinks(platform);
  const label = PLATFORM_LABELS[platform.id] || platform.id;
  if (!links.length) {
    const text = document.createElement('span');
    if (platform.id !== 'x') text.append(icon(platform.id));
    text.append(label);
    item.append(text);
  } else {
    links.forEach((entry, index) => {
      if (index) item.append(document.createTextNode(' · '));
      const link = document.createElement('a');
      link.href = entry.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.title = entry.handle ? `@${entry.handle} on ${label}` : label;
      if (index === 0 && platform.id !== 'x') link.append(icon(platform.id));
      link.append(index === 0 ? label : `@${entry.handle || 'profile'}`);
      item.append(link);
    });
  }
  const detail = document.createElement('span');
  if (typeof platform.views === 'number') {
    detail.textContent = ` ${platform.views.toLocaleString('en-US')}`;
  } else {
    const missing = document.createElement('span');
    missing.className = 'av-missing';
    const parts = [];
    if (typeof platform.followers === 'number') parts.push(`${platform.followers.toLocaleString('en-US')} followers`);
    if (typeof platform.posts === 'number') parts.push(`${fmt(platform.posts)} posts`);
    missing.textContent = parts.length ? ` ${parts.join(' · ')}` : ' · Awaiting data';
    detail.append(missing);
  }
  item.append(detail);
  return item;
}

function detailCard(platform) {
  const card = document.createElement('article');
  card.className = 'av-platform-card';
  const title = document.createElement('h3');
  title.append(marked(platform.id, PLATFORM_LABELS[platform.id] || platform.id));
  card.append(title);
  for (const [label, value, partial] of [
    ['Views', platform.views, platform.viewsComplete === false],
    ['Likes', platform.likes, false],
    ['Comments', platform.comments, false],
    ['Followers', platform.followers, false],
  ]) {
    const line = document.createElement('p');
    if (typeof value !== 'number') continue;
    line.textContent = `${label} · ${value.toLocaleString('en-US')}`;
    card.append(line);
  }
  if (platform.id === 'instagram') {
    const status = document.createElement('p');
    const date = platform.observedAt ? new Date(platform.observedAt).toLocaleString() : null;
    status.textContent = [date && `Last reading · ${date}`, platform.error, platform.views == null && 'View count unavailable'].filter(Boolean).join(' · ');
    card.append(status);
  }
  if (platform.viewsNote) {
    const note = document.createElement('p');
    note.textContent = platform.viewsNote;
    card.append(note);
  }
  for (const entry of profileLinks(platform)) {
    const link = document.createElement('a');
    link.href = entry.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = entry.handle ? `@${entry.handle}` : 'Open profile';
    card.append(link);
  }
  return card;
}

function sortedRows() {
  const now = Date.parse(state.snapshot.checkedAt);
  const platforms = state.platforms.includes('all') ? 'all' : state.platforms;
  const rows = view.accounts.map((account) => ({
    account,
    growth: growthFor(state.snapshot.history, account, 'views', platforms, now),
  }));
  const ranked = rankAccounts(rows.map((row) => ({
    ...row.account,
    growth: row.growth,
  })), state.sort, state.dir);
  const byId = new Map(rows.map((row) => [row.account.id, row]));
  return ranked.map((account) => byId.get(account.id));
}

function accountIdentity(account, rank) {
  const wrap = document.createElement('div');
  wrap.className = 'av-account';
  const name = document.createElement('button');
  name.type = 'button';
  name.className = 'av-name';
  name.textContent = account.name;
  name.setAttribute('aria-expanded', String(state.expanded.has(account.id)));
  name.addEventListener('click', () => {
    if (state.expanded.has(account.id)) state.expanded.delete(account.id);
    else state.expanded.add(account.id);
    renderBoard();
  });
  const meta = document.createElement('p');
  meta.className = 'av-handle';
  meta.textContent = `@${account.handle} · ${LABELS[account.category] || account.category}`;
  const plats = document.createElement('ul');
  plats.className = 'av-plats';
  for (const platform of account.rowPlatforms) plats.append(platformLine(platform));
  if (!account.rowPlatforms.length) {
    const empty = document.createElement('li');
    empty.className = 'av-missing';
    empty.textContent = '';
    plats.append(empty);
  }
  const badge = document.createElement('span');
  badge.className = 'av-rank';
  badge.textContent = String(rank);
  wrap.append(badge, name, meta, plats);
  return wrap;
}

function renderBoard() {
  if (page !== 'accounts' || !view) return;
  const rows = sortedRows();
  const body = q('[data-rows]');
  const cards = q('[data-cards]');
  body.replaceChildren();
  cards.replaceChildren();
  const summary = q('[data-summary]');
  const bits = [`${totals.matched} account${totals.matched === 1 ? '' : 's'}`];
  if (typeof totals.views === 'number') bits.push(`${fmt(totals.views)} views`);
  if (typeof totals.likes === 'number') bits.push(`${fmt(totals.likes)} likes`);
  if (typeof totals.followers === 'number') bits.push(`${fmt(totals.followers)} followers`);
  summary.textContent = bits.join(' · ');
  const chips = q('[data-platform-totals]');
  chips.replaceChildren();
  for (const id of (state.platforms.includes('all') ? PLATFORM_ORDER : state.platforms)) {
    const platformTotal = totals.platformTotals[id];
    if (!platformTotal) continue;
    const chip = document.createElement('div');
    chip.className = 'av-chip';
    const title = document.createElement('strong');
    title.append(marked(id, PLATFORM_LABELS[id]));
    const line = document.createElement('span');
    line.textContent = typeof platformTotal.views === 'number'
      ? `${fmt(platformTotal.views)} views`
      : typeof platformTotal.followers === 'number' ? `${fmt(platformTotal.followers)} followers` : '';
    chip.append(title, line);
    chips.append(chip);
  }
  if (!rows.length) {
    const empty = document.createElement('p');
    empty.className = 'av-empty';
    empty.textContent = 'No accounts match these filters.';
    cards.append(empty);
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 6;
    td.className = 'av-empty';
    td.textContent = 'No accounts match these filters.';
    tr.append(td);
    body.append(tr);
    return;
  }
  rows.forEach(({ account, growth }, index) => {
    const rank = index + 1;
    const top = rank <= 3;
    const card = document.createElement('article');
    card.className = top ? 'av-card is-top' : 'av-card';
    card.append(accountIdentity(account, rank));
    const metrics = document.createElement('div');
    metrics.className = 'av-metrics';
    for (const [label, node] of [
      ['Views', metricCell(account.views, account.viewsPartial)],
      ['Likes', metricCell(account.likes, false)],
      ['Comments', metricCell(account.comments, false)],
      ['Followers', metricCell(account.followers, false)],
      ['24h', growthCell(growth)],
    ]) {
      const block = document.createElement('div');
      const name = document.createElement('span');
      name.textContent = label;
      block.append(name, node);
      metrics.append(block);
    }
    card.append(metrics);
    if (state.expanded.has(account.id)) {
      const grid = document.createElement('div');
      grid.className = 'av-detail-grid';
      for (const platform of account.rowPlatforms) grid.append(detailCard(platform));
      card.append(grid);
    }
    cards.append(card);

    const tr = document.createElement('tr');
    if (top) tr.classList.add('is-top');
    const who = document.createElement('td');
    who.append(accountIdentity(account, rank));
    tr.append(who);
    for (const key of ['views', 'likes', 'comments', 'followers']) {
      const td = document.createElement('td');
      td.append(metricCell(account[key], key === 'views' && account.viewsPartial));
      tr.append(td);
    }
    const growthTd = document.createElement('td');
    growthTd.append(growthCell(growth));
    tr.append(growthTd);
    body.append(tr);
    if (state.expanded.has(account.id)) {
      const detail = document.createElement('tr');
      detail.className = 'av-detail';
      const td = document.createElement('td');
      td.colSpan = 6;
      const grid = document.createElement('div');
      grid.className = 'av-detail-grid';
      for (const platform of account.rowPlatforms) grid.append(detailCard(platform));
      td.append(grid);
      detail.append(td);
      body.append(detail);
    }
  });
}

function renderSort() {
  for (const th of document.querySelectorAll('[data-sort]')) {
    if (th.dataset.sort === state.sort) th.setAttribute('aria-sort', state.dir === 'asc' ? 'ascending' : 'descending');
    else th.removeAttribute('aria-sort');
  }
  const select = q('[data-sort-select]');
  const next = `${state.sort}:${state.dir}`;
  if (select && select.value !== next) select.value = next;
}

function renderFilters() {
  const categories = q('[data-categories]');
  const platforms = q('[data-platforms]');
  if (!categories.childElementCount) {
    for (const category of CATEGORIES) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = category.label;
      button.dataset.category = category.id;
      button.addEventListener('click', () => {
        state.categories = toggleSelection(state.categories, category.id);
        syncUrl();
        retarget(true);
        renderFilters();
        renderBoard();
      });
      categories.append(button);
    }
    const all = document.createElement('button');
    all.type = 'button';
    all.textContent = 'All';
    all.dataset.platform = 'all';
    all.addEventListener('click', () => selectPlatform('all'));
    platforms.append(all);
    for (const id of PLATFORM_ORDER) {
      const button = document.createElement('button');
      button.type = 'button';
      button.append(marked(id, PLATFORM_LABELS[id]));
      button.dataset.platform = id;
      button.addEventListener('click', () => selectPlatform(id));
      platforms.append(button);
    }
  }
  for (const button of categories.querySelectorAll('button')) {
    const selected = state.categories.includes(button.dataset.category);
    button.setAttribute('aria-pressed', String(selected));
  }
  for (const button of platforms.querySelectorAll('button')) {
    button.setAttribute('aria-pressed', String(state.platforms.includes(button.dataset.platform)));
  }
}

function selectPlatform(id) {
  state.platforms = toggleSelection(state.platforms, id);
  syncUrl();
  retarget(true);
  renderFilters();
  renderBoard();
}

function syncUrl() {
  const params = new URLSearchParams();
  const defaultCats = DEFAULT_FILTER.categories;
  const catsDefault = state.categories.length === defaultCats.length && defaultCats.every((item) => state.categories.includes(item));
  if (!catsDefault) for (const item of state.categories) params.append('category', item);
  if (!(state.platforms.length === 1 && state.platforms[0] === 'all')) {
    for (const item of state.platforms) params.append('platform', item);
  }
  if (state.query) params.set('q', state.query);
  if (state.sort !== 'views') params.set('sort', state.sort);
  if (state.dir !== 'desc') params.set('dir', state.dir);
  const query = params.toString();
  history.replaceState(null, '', query ? `${location.pathname}?${query}` : location.pathname);
}

function readUrl() {
  const params = new URLSearchParams(location.search);
  const categories = params.getAll('category').map((item) => (item === 'personal' ? 'creators' : item));
  const platforms = params.getAll('platform');
  if (categories.length) state.categories = categories.includes('all') ? ['all'] : categories;
  if (platforms.length) state.platforms = platforms.includes('all') ? ['all'] : platforms;
  state.query = params.get('q') || '';
  const sort = params.get('sort');
  if (['views', 'likes', 'comments', 'followers', 'growth'].includes(sort)) state.sort = sort;
  if (params.get('dir') === 'asc') state.dir = 'asc';
  const search = q('[data-search]');
  if (search) search.value = state.query;
}

async function loadSnapshot() {
  let lastError = null;
  for (const url of ['/api/views-feed', '/data/snapshot.json']) {
    try {
      const response = await fetch(url, { cache: 'no-store' });
      if (!response.ok) throw new Error(`Feed HTTP ${response.status}`);
      const data = await response.json();
      if (data.schemaVersion !== 1 || !Array.isArray(data.accounts)) throw new Error('Unexpected feed');
      state.snapshot = data;
      state.error = '';
      return;
    } catch (error) {
      lastError = error;
    }
  }
  state.error = lastError?.message || 'The view feed could not be loaded.';
}

let polling = false;
async function poll() {
  if (polling || document.hidden) return;
  polling = true;
  const before = state.snapshot?.checkedAt;
  await loadSnapshot();
  retarget(false);
  if (page === 'accounts') renderBoard();
  polling = false;
  return before;
}

if (page === 'accounts') {
  readUrl();
  renderFilters();
  const search = q('[data-search]');
  search.addEventListener('input', (event) => {
    state.query = event.target.value;
    syncUrl();
    retarget(true);
    renderBoard();
  });
  q('[data-sort-select]').addEventListener('change', (event) => {
    const [sort, dir] = event.target.value.split(':');
    state.sort = sort;
    state.dir = dir;
    syncUrl();
    renderSort();
    renderBoard();
  });
  for (const th of document.querySelectorAll('[data-sort]')) {
    th.querySelector('button').addEventListener('click', () => {
      if (state.sort === th.dataset.sort) state.dir = state.dir === 'desc' ? 'asc' : 'desc';
      else { state.sort = th.dataset.sort; state.dir = 'desc'; }
      syncUrl();
      renderSort();
      renderBoard();
    });
  }
}

poll();
setInterval(poll, 60000);
setInterval(paintFigure, 1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
