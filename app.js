const $ = (id) => document.getElementById(id);
const cache = new Map();
const state = { manifest: null, county: null, countyData: null, type: null, district: null,
  districtData: null, zone: null, zoneData: null, historyData: null, partyHistoryView: null, countyMapView: null, villageMapView: null, councilMapLinks: null, mapVillage: null, selectionTypeId: null, selectionMode: null, level: 'taiwan', loading: false, error: '', sequence: 0, navigationMode: 'initial', routeUrl: null,
  candidateSort: {key: 'source', direction: 'asc'}, historySort: {key: 'number', direction: 'asc'}, partyShareMode: 'all' };
const candidateColumns = [{key: 'name', label: '候選人', caption: '人物簡介'}, {key: 'party', label: '推薦政黨'}, {key: 'reelection', label: '追求連任', helpAnchor: 'reelection-help'}];
const historyColumns = [{key: 'number', label: '號次'}, {key: 'name', label: '候選人', caption: '人物簡介'}, {key: 'party', label: '推薦政黨'},
  {key: 'votes', label: '得票數'}, {key: 'voteSharePercent', label: '得票率'}, {key: 'elected', label: '結果'}, {key: 'registration', label: '參選備註'}];
function normalizeSearch(text) { return String(text ?? '').normalize('NFKC').toLocaleLowerCase('zh-TW').replace(/台/g,'臺').replace(/\s+/g,''); }
function searchMatches(text, query) {
  const haystack = normalizeSearch(text);
  return query.trim().split(/\s+/).filter(Boolean).every(term => haystack.includes(normalizeSearch(term)));
}

function tableHeaders(columns) {
  return `<tr>${columns.map(({key, label, caption, helpAnchor}) => {
    const button = `<button type="button" class="table-sort" data-sort-key="${key}" data-label="${label}"><span class="table-heading-label"><span>${label}</span>${caption ? `<small>${caption}</small>` : ''}</span><span class="sort-indicator" aria-hidden="true">↕</span></button>`;
    const content = helpAnchor ? `<div class="column-heading">${button}<a class="column-help" href="#${helpAnchor}" aria-label="查看${label}的說明：是、再次參選與空白" title="查看是／再次參選／空白的說明">?</a></div>` : button;
    return `<th scope="col" aria-sort="none">${content}</th>`;
  }).join('')}</tr>`;
}
function compareValues(left, right, direction) {
  if (left == null || right == null) return left == null ? (right == null ? 0 : 1) : -1;
  const compared = typeof left === 'number' ? left - right : String(left).localeCompare(String(right), 'zh-Hant');
  return direction === 'desc' ? -compared : compared;
}
function updateSortHeaders(tableId, sort, statusId) {
  const table = $(tableId);
  for (const button of table.querySelectorAll('[data-sort-key]')) {
    const active = button.dataset.sortKey === sort.key;
    button.parentElement.setAttribute('aria-sort', active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none');
    button.querySelector('.sort-indicator').textContent = active ? (sort.direction === 'asc' ? '↑' : '↓') : '↕';
    button.setAttribute('aria-label', `${button.dataset.label}，點選排序${active ? '，再點一次切換順序' : ''}`);
  }
  const active = table.querySelector(`button[data-sort-key="${sort.key}"]`);
  $(statusId).textContent = active ? `依${active.dataset.label}${sort.direction === 'asc' ? '升冪' : '降冪'}排列` : '依登記資料順序排列';
}
function attachTableSorting(tableId, kind) {
  $(tableId).addEventListener('click', (event) => {
    const button = event.target.closest('button[data-sort-key]');
    if (!button || !$(tableId).contains(button)) return;
    const key = button.dataset.sortKey;
    const previous = state[`${kind}Sort`];
    state[`${kind}Sort`] = {key, direction: previous.key === key ? (previous.direction === 'asc' ? 'desc' : 'asc') :
      (['votes', 'voteSharePercent', 'elected', 'registration', 'reelection'].includes(key) ? 'desc' : 'asc')};
    if (kind === 'candidate') renderCandidates();
    else renderHistoryRows();
  });
}
function reelectionStatuses(currentCandidates, previousCandidates) {
  const statuses = new Map();
  for (const [previous, current] of matchingRegistrationCandidates(currentCandidates, previousCandidates)) {
    statuses.set(current, previous.elected ? 2 : 1);
  }
  return statuses;
}

async function readJson(path) {
  if (!cache.has(path)) {
    cache.set(path, fetch(`./data/${path}`, {cache: 'no-store'}).then((response) => {
      if (!response.ok) throw new Error(`${response.status} ${path}`);
      return response.json();
    }).catch((error) => {
      cache.delete(path);
      throw error;
    }));
  }
  return cache.get(path);
}
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
}
function profileLinksHtml(candidate) {
  const profiles = new Map();
  for (const profile of candidate.profileLinks || []) {
    try {
      const url = new URL(profile.url);
      const sourceId = url.hostname === 'zh.wikipedia.org' ? 'wikipedia' : url.hostname === 'votetw.com' ? 'votetw' : null;
      if (!sourceId || url.protocol !== 'https:' || !url.pathname.startsWith('/wiki/') || profile.sourceId !== sourceId) continue;
      profiles.set(sourceId, {...profile, url: url.href});
    } catch { /* Invalid metadata leaves the name as plain text. */ }
  }
  const links = [['wikipedia', 'WIKI'], ['votetw', 'VOTETW']].filter(([sourceId]) => profiles.has(sourceId)).map(([sourceId, label]) => {
    const profile = profiles.get(sourceId);
    return `<a class="profile-link" data-profile-source="${sourceId}" href="${escapeHtml(profile.url)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(profile.source)} · 人物介紹（另開分頁）" aria-label="查看${escapeHtml(candidate.name)}的${label}人物介紹（另開分頁）">${label}<span class="external-indicator" aria-hidden="true">↗</span></a>`;
  });
  return links.length ? `<span class="profile-links">${links.join('')}</span>` : '';
}
function updateUrl(commit = false) {
  if (!commit) return;
  const query = new URLSearchParams();
  if (state.county) query.set('county', state.county.id);
  if (state.type || state.selectionTypeId) query.set('type', state.type?.id || state.selectionTypeId);
  if (state.district) query.set('district', state.district.id);
  if (state.zone) query.set('zone', state.zone.id);
  query.set('view', state.level);
  const routeUrl = `${location.pathname}?${query}`;
  const restoring = state.navigationMode !== 'user' || !state.routeUrl;
  if (restoring) history.replaceState(null, '', `${routeUrl}${location.hash}`);
  else if (routeUrl !== `${location.pathname}${location.search}`) history.pushState(null, '', routeUrl);
  state.routeUrl = routeUrl;
  state.navigationMode = 'user';
}
function breadcrumb() {
  const familyLabel = {mayor: '縣市長', council: '議員', village: '里長'}[mapElectionFamily(state.selectionTypeId)];
  const pieces = ['2026 九合一選舉', state.county?.name || '台灣', state.type?.label || familyLabel, state.district?.name,
    state.zone ? shortZoneName(state.zone) : null].filter(Boolean);
  $('breadcrumb').innerHTML = pieces.map((piece, index) => `<span>${escapeHtml(piece)}</span>${index < pieces.length - 1 ? '<span class="crumb-sep">›</span>' : ''}`).join('');
}
function message(title, body, symbol = '○') {
  $('result-content').hidden = true;
  $('empty-state').hidden = false;
  $('empty-state').innerHTML = `<div class="empty-symbol" aria-hidden="true">${symbol}</div><h2>${escapeHtml(title)}</h2><p>${escapeHtml(body)}</p>`;
}
function showResult() {
  $('result-content').hidden = false;
  $('empty-state').hidden = true;
}
function renderCounties() {
  $('county-list').replaceChildren();
  const groups = new Map();
  for (const county of state.manifest.counties) {
    const group = county.navigationGroup || '縣市';
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(county);
  }
  let index = 0;
  for (const [label, counties] of groups) {
    const group = document.createElement('div');
    group.className = 'county-group';
    group.innerHTML = `<h3 id="county-group-${index}">${escapeHtml(label)}</h3><div class="county-buttons" role="group" aria-labelledby="county-group-${index}"></div>`;
    index++;
    for (const county of counties) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `county-button${state.county?.id === county.id ? ' active' : ''}`;
      button.textContent = county.name;
      button.setAttribute('aria-pressed', String(state.county?.id === county.id));
      button.setAttribute('aria-label', county.available ? county.name : `${county.name}，資料準備中`);
      button.addEventListener('click', () => { state.navigationMode='user'; selectCounty(county.id, {type: state.type?.id || state.selectionTypeId}); });
      group.querySelector('.county-buttons').append(button);
    }
    $('county-list').append(group);
  }
}
function renderTypes() {
  const types = state.countyData?.types || [];
  $('type-count').textContent = types.length ? `${types.length} 種可查詢` : '請先從地圖選縣市';
  $('type-list').innerHTML = '';
  for (const type of types) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `type-button${state.type?.id === type.id ? ' active' : ''}`;
    button.setAttribute('aria-pressed', String(state.type?.id === type.id));
    button.innerHTML = `<strong>${escapeHtml(type.label)}</strong><small>${type.zoneCount.toLocaleString('zh-TW')} 選區 · ${type.candidateCount.toLocaleString('zh-TW')} 人登記</small>`;
    button.addEventListener('click', () => { state.navigationMode='user'; selectType(type); });
    $('type-list').append(button);
  }
  syncCountyMap();
}
function mapElectionFamily(typeId) {
  if (['mayor', 'metro_mayor', 'county_mayor'].includes(typeId)) return 'mayor';
  if (['council', 'metro_council', 'county_council'].includes(typeId)) return 'council';
  if (['village', 'village_head'].includes(typeId)) return 'village';
  return null;
}
function syncCountyMap(typeId = state.type?.id || state.selectionTypeId, loading = state.loading, error = state.error) {
  const family = mapElectionFamily(typeId);
  const mapMode = Boolean(state.countyMapView) && Boolean(family);
  $('workspace').classList.toggle('map-mode', mapMode);
  $('workspace').classList.toggle('is-taiwan', mapMode && state.level === 'taiwan');
  const localMap = Boolean(state.villageMapView && state.county && state.type && ['council', 'village'].includes(family) && state.level !== 'taiwan');
  $('workspace').classList.toggle('has-local-map', localMap);
  $('local-map-section').hidden = !localMap;
  if (!localMap) $('local-map-routing-status').textContent = '';
  $('region-list-fallback').open = !localMap;
  const districtPicker = family === 'village' && state.level === 'county';
  document.querySelector('.zone-panel').hidden = (mapMode && (state.level === 'taiwan' || family === 'mayor' || districtPicker)) || !state.county?.available;
  $('region-browser').hidden = !state.type || state.loading || Boolean(error) || (mapMode && (state.level === 'taiwan' || state.level === 'result'));
  $('district-browser').hidden = !districtPicker;
  document.querySelector('.results-panel').hidden = mapMode && state.level !== 'result' && !error;
  if (state.selectionMode !== mapMode) {
    $('county-text-picker').open = !mapMode;
    state.selectionMode = mapMode;
  }
  $('county-text-jump').hidden = mapMode;
  for (const button of document.querySelectorAll('[data-map-family]')) {
    button.setAttribute('aria-pressed', String(button.dataset.mapFamily === family));
  }
  $('map-election-hint').textContent = {
    mayor: '點選縣市，查看整個縣市的首長候選人。',
    council: state.level === 'taiwan' ? '點選縣市，進入該縣市的議員選區地圖。' : state.level === 'county' ? '點選議員選區的範圍，放大查看區內村里與候選人。' : '目前顯示所選議員選區的村里範圍與名單，可回到上層更換選區。',
    village: state.level === 'taiwan' ? '點選縣市，進入可點選的行政區地圖。' : state.level === 'county' ? '點選行政區的實際範圍，放大到該區各村里。' : '依照位置點選自己的村里，查看村里長名單。',
  }[family] || '';
  $('county-map-heading').textContent = state.level === 'taiwan' || family === 'mayor' ? '在台灣地圖上選擇縣市' : `${state.county?.name || ''} · ${family === 'council' ? '議員選區' : '村里長'}`;
  document.querySelector('.county-map-badge').textContent = state.level === 'taiwan' || family === 'mayor' ? '22 縣市' : '縣市檢視';
  for (const button of document.querySelectorAll('[data-region-back], [data-taiwan-return]')) button.disabled = state.level === 'taiwan';
  if (state.type) {
    $('region-level-heading').textContent = districtPicker ? `${state.county.name} · 選擇行政區` : `${state.county.name}${state.district ? ` · ${state.district.name}` : ''} · ${family === 'village' ? '村里清單' : family === 'council' ? '議員分區' : '選擇選區'}`;
    $('region-summary').textContent = districtPicker ? `共 ${state.type.districts.length} 個鄉鎮市區，點選行政區後列出各村里。` : family === 'council' ? `共 ${state.type.zoneCount} 個議員選區；下列範圍依中選會公告。` : family === 'village' && state.district ? `共 ${state.district.zoneCount} 個村里，點選後查看候選人與上屆結果。` : '點選要查看的區域，即可顯示候選人與上屆結果。';
  }
  for (const link of document.querySelectorAll('[data-zone-return]')) {
    link.href = mapMode ? '#region-level-heading' : '#zone-heading';
    link.textContent = mapMode ? '回到上層 ↑' : '返回選區 ↑';
  }
  for (const link of document.querySelectorAll('[data-map-return]')) {
    link.hidden = !mapMode;
    link.textContent = '回到台灣選擇縣市 ↑';
  }
  state.countyMapView?.update({county: state.county, type: state.type, typeId, zone: state.zone, level: state.level, loading, error});
  state.villageMapView?.update({county: state.county, typeId, level: state.level, districtId: state.district?.id,
    districtName: state.district?.name, zoneId: state.zone?.id, selectedVillageId: state.mapVillage?.id,
    councilVillageIds: family === 'council' && state.zone && state.councilMapLinks ? Object.entries(state.councilMapLinks.byVillageZoneId).filter(([, link]) => link.councilZoneIds.includes(state.zone.id)).map(([id]) => id) : []});
  renderMapCouncilOptions();
}
async function readCouncilMapLinks(countyId) {
  const key = `council-map-links/${countyId}`;
  if (!cache.has(key)) cache.set(key, fetch(`./assets/village-council-links/${countyId}.json`).then(response => {
    if (!response.ok) throw new Error('議員選區對照資料無法讀取');
    return response.json();
  }).catch(error => { cache.delete(key); throw error; }));
  return cache.get(key);
}
function renderMapCouncilOptions() {
  const root = $('map-council-options'); root.replaceChildren();
  const links = state.mapVillage?.zoneId && state.councilMapLinks?.byVillageZoneId[state.mapVillage.zoneId];
  root.hidden = mapElectionFamily(state.type?.id) !== 'council' || !links;
  if (root.hidden) return;
  const heading = document.createElement('h3'); heading.textContent = `${state.mapVillage.districtName}${state.mapVillage.name} · 議員選區`;
  const note = document.createElement('p'); note.textContent = '區域與原住民選區分別列出；地理位置不判定選民資格。';
  root.append(heading, note);
  for (const id of links.councilZoneIds) {
    const zone = state.type.zones.find(item => item.id === id); const info = state.councilMapLinks.councilZones[id];
    if (!zone || !info) continue;
    const button = document.createElement('button'); button.type = 'button'; button.textContent = `${info.electorateLabel} · ${zone.name}`;
    button.setAttribute('aria-pressed', String(state.zone?.id === id));
    button.addEventListener('click', () => { state.navigationMode = 'user'; clearRouteHash(); selectZone(zone, true); });
    root.append(button);
  }
}
function mapDistrictSelected(feature) {
  if (mapElectionFamily(state.type?.id) !== 'village') return;
  const district = state.type.districts.find(item => item.id === feature.id || item.name === feature.name);
  if (!district) { $('local-map-routing-status').textContent = '此行政區尚未對應選舉資料，請從清單核對。'; return; }
  state.navigationMode = 'user'; state.mapVillage = null; $('local-map-routing-status').textContent = ''; clearRouteHash();
  selectDistrict(district, undefined, undefined, true, 'region-level-heading');
}
function mapCouncilSelected(feature) {
  if (mapElectionFamily(state.type?.id) !== 'council') return;
  if (feature.countyId && String(feature.countyId) !== String(state.county?.id) || feature.typeId && feature.typeId !== state.type.id) return;
  const zone = state.type.zones.find(item => item.id === feature.id);
  if (!zone) { $('local-map-routing-status').textContent = '此選區尚未對應候選人資料，請從清單核對。'; return; }
  state.navigationMode = 'user'; state.mapVillage = null; clearRouteHash();
  $('local-map-routing-status').textContent = '';
  selectZone(zone, true);
}
async function mapVillageSelected(feature) {
  const family = mapElectionFamily(state.type?.id);
  // A village inside the chosen council map locates that same electorate.
  // Keep the previewed zone rather than inferring eligibility from its location.
  if (family === 'council' && state.level === 'result' && state.zone) {
    if (feature.countyId && String(feature.countyId) !== String(state.county?.id) || feature.typeId && feature.typeId !== state.type.id) return;
    const membership = feature.zoneId && state.councilMapLinks?.byVillageZoneId[feature.zoneId];
    const belongs = feature.councilZoneId === state.zone.id || membership?.councilZoneIds.includes(state.zone.id);
    if (!belongs) {
      $('local-map-routing-status').textContent = '此位置尚未確認屬於目前選區，請回到上層或從選區清單選擇。';
      return;
    }
    state.navigationMode = 'user'; state.mapVillage = feature; clearRouteHash();
    $('local-map-routing-status').textContent = feature.zoneId ? '' : `${feature.districtName}${feature.name}為此議員選區的地理範圍；村里長資料尚未接上。`;
    selectZone(state.zone, true);
    return;
  }
  if (family === 'council' && state.loading && !state.councilMapLinks) {
    $('local-map-routing-status').textContent = '議員選區資料載入中，請稍候再點選村里。';
    return;
  }
  if (!feature.zoneId) { $('local-map-routing-status').textContent = `${feature.districtName}${feature.name}尚未精確對應本次選舉資料，請從清單核對。`; return; }
  state.navigationMode = 'user'; clearRouteHash(); state.mapVillage = feature; $('local-map-routing-status').textContent = '';
  if (family === 'village') {
    const district = state.type.districts.find(item => item.id === feature.districtId);
    if (!district) return;
    if (state.district?.id === district.id && state.districtData) {
      const zone = state.districtData.zones.find(item => item.id === feature.zoneId);
      if (zone) await selectZone(zone, true);
    } else await selectDistrict(district, feature.zoneId, undefined, true);
    return;
  }
  if (family === 'council') {
    const sequence = ++state.sequence;
    try {
      const links = state.councilMapLinks || await readCouncilMapLinks(state.county.id);
      if (sequence !== state.sequence) return;
      state.councilMapLinks = links;
      const ids = links.byVillageZoneId[feature.zoneId]?.generalCouncilZoneIds || [];
      const zone = ids.length === 1 && state.type.zones.find(item => item.id === ids[0]);
      if (zone) await selectZone(zone, true);
      else $('local-map-routing-status').textContent = '此村里尚未有已核對的議員選區，請從清單選擇。';
    } catch { if (sequence === state.sequence) $('local-map-routing-status').textContent = '議員選區對照無法讀取，請從清單選擇。'; }
  }
}
function clearZoneState() {
  resetPartyHistory();
  state.zone = null; state.zoneData = null; state.historyData = null;
  $('candidate-list').replaceChildren(); $('history-content').replaceChildren();
  $('result-title').textContent = ''; $('zone-search').value = '';
  $('party-filter').value = '';
}
function focusLevel(sequence, id) {
  const previousFocus = document.activeElement;
  requestAnimationFrame(() => {
    if (sequence !== state.sequence) return;
    if (document.activeElement !== previousFocus && document.activeElement !== document.body) return;
    const target = id === 'region-level-heading' && !$('local-map-section').hidden ? $('local-map-section') : $(id);
    target.focus({preventScroll: true});
    target.scrollIntoView({behavior: 'auto', block: 'start'});
  });
}
function clearRouteHash() {
  if (location.hash) history.replaceState(null, '', `${location.pathname}${location.search}`);
}
function showTaiwan(family = mapElectionFamily(state.type?.id || state.selectionTypeId) || 'mayor', focus = false) {
  const sequence = ++state.sequence;
  clearZoneState();
  state.selectionTypeId = family; state.level = 'taiwan'; state.loading = false; state.error = '';
  state.mapVillage = null; state.councilMapLinks = null;
  state.county = null; state.countyData = null; state.type = null; state.district = null; state.districtData = null;
  $('district-control').hidden = true; $('zone-search-wrap').hidden = true; $('zone-list').replaceChildren(); $('district-list').replaceChildren();
  $('coverage').textContent = '全台 22 縣市';
  renderCounties(); renderTypes(); breadcrumb(); updateUrl(true);
  if (focus) focusLevel(sequence, 'county-map-heading');
}
function renderDistricts() {
  $('district-list').replaceChildren();
  for (const district of state.type?.districts || []) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'district-card';
    button.dataset.districtId = district.id;
    button.innerHTML = `<strong>${escapeHtml(district.name)}</strong><small>${district.zoneCount} 個村里 · ${district.candidateCount} 人登記</small>`;
    button.addEventListener('click', () => { state.navigationMode = 'user'; clearRouteHash(); selectDistrict(district, undefined, undefined, true, 'region-level-heading'); });
    $('district-list').append(button);
  }
}
function goUp() {
  state.navigationMode = 'user'; clearRouteHash();
  const family = mapElectionFamily(state.type?.id || state.selectionTypeId);
  if (!family || state.level === 'taiwan') return;
  if (state.level === 'county' || family === 'mayor') { showTaiwan(family, true); return; }
  const district = state.district?.id;
  selectType(state.type, {district: state.level === 'result' && family === 'village' ? district : undefined,
    view: state.level === 'result' && family === 'village' ? 'district' : 'county', scrollToCandidates: true, scrollTarget: 'region-level-heading'});
}
async function restoreRoute() {
  const query = new URLSearchParams(location.search);
  const county = state.manifest.counties.find(c => c.id === query.get('county'));
  const family = mapElectionFamily(query.get('type')) || 'mayor';
  const explicitView = ['taiwan', 'county', 'district', 'result'].includes(query.get('view')) ? query.get('view') : null;
  if (!county || explicitView === 'taiwan') { showTaiwan(family); return; }
  const view = explicitView || (query.get('zone') ? 'result' : query.get('district') ? 'district' : 'county');
  await selectCounty(county.id, {type: query.get('type'), district: view === 'district' || view === 'result' ? query.get('district') : null,
    zone: view === 'result' ? query.get('zone') : null, view});
}
function resolveElectionType(types, preferredId) {
  const families = {
    mayor: ['metro_mayor', 'county_mayor'],
    metro_mayor: ['metro_mayor', 'county_mayor'],
    county_mayor: ['metro_mayor', 'county_mayor'],
    council: ['metro_council', 'county_council'],
    metro_council: ['metro_council', 'county_council'],
    county_council: ['metro_council', 'county_council'],
    village: ['village_head'],
  };
  return types.find(type => (families[preferredId] || [preferredId]).includes(type.id)) || types[0];
}
function allZones() {
  if (state.type?.scope === 'village') return state.districtData?.zones || [];
  const zones = state.type?.zones || [];
  return state.district ? zones.filter((zone) => zone.district === state.district.name) : zones;
}
function shortZoneName(zone) {
  return state.district && zone.name.startsWith(state.district.name) ?
    zone.name.slice(state.district.name.length) : zone.name;
}
function renderZones() {
  const zones = allZones();
  const query = $('zone-search').value.trim().toLocaleLowerCase('zh-TW');
  const filtered = zones.filter((zone) => searchMatches(`${zone.name} ${zone.geography?.coverage || ''} ${zone.geography?.shortLabel || ''} ${zone.searchNames.join(' ')}`, query));
  $('clear-zone-search').hidden = !query;
  $('zone-search-scope').textContent = `搜尋範圍：${state.county?.name || ''} · ${state.district?.name || state.type?.label || ''}`;
  $('zone-count').textContent = `${filtered.length} / ${zones.length}`;
  $('zone-list').innerHTML = '';
  for (const zone of filtered) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `zone-button${state.zone?.id === zone.id ? ' active' : ''}`;
    button.setAttribute('aria-pressed', String(state.zone?.id === zone.id));
    const village = state.type?.scope === 'village';
    const name = shortZoneName(zone);
    const geography = zone.geography?.shortLabel;
    const title = village ? `${name}（${zone.candidateCount}人）${zone.electionEvent?.status === 'stopped' ? ' · 停止選舉' : zone.electionEvent?.status === 'second_registration_announced' ? ' · 第2次登記公告' : ''}` :
      `${name}${geography ? `（${geography}）` : ''}`;
    const count = zone.seats == null ? `${zone.candidateCount}人` : `${zone.seats}/${zone.candidateCount}`;
    button.setAttribute('aria-label', village ? `${name}，登記參選 ${zone.candidateCount} 人${zone.electionEvent?.status === 'stopped' ? '，已公告停止選舉' : zone.electionEvent?.status === 'second_registration_announced' ? '，已公告第2次登記' : ''}` :
      `${name}${zone.geography ? `，選區範圍 ${zone.geography.coverage}` : ''}，應選 ${zone.seats ?? '待確認'} 席，登記參選 ${zone.candidateCount} 人`);
    button.dataset.zoneId = zone.id;
    button.innerHTML = state.level !== 'result' && mapElectionFamily(state.type?.id) === 'council' ?
      `<span><strong>${escapeHtml(zone.name)}</strong><p class="zone-coverage">${escapeHtml(zone.geography?.coverage || '選區範圍待確認')}</p></span><small>應選 ${zone.seats ?? '待確認'} 席 · 登記 ${zone.candidateCount} 人</small>` : `<span>${escapeHtml(title)}</span>${village ? '' : `<small>${escapeHtml(count)}</small>`}`;
    button.addEventListener('click', () => { state.navigationMode='user'; clearRouteHash(); selectZone(zone, true); });
    $('zone-list').append(button);
  }
  if (!filtered.length) $('zone-list').innerHTML = '<p class="no-results">找不到符合的選區或候選人</p>';
  $('zone-hint').textContent = state.type?.scope === 'village' ? '里名括號內為登記參選人數。' :
    zones.some((zone) => zone.seats == null) ? '右側為登記參選人數；應選名額尚待官方選區公告核對。' :
    ['metro_council', 'county_council'].includes(state.type?.id) ? '右側數字為應選席次／登記參選人數；地理範圍依中選會 115 年公告。' :
    '右側數字為應選席次／登記參選人數。';
}
async function selectCounty(id, preferred = {}) {
  const county = state.manifest.counties.find(item => item.id === id);
  if (!county) { showTaiwan(mapElectionFamily(preferred.type) || 'mayor'); return; }
  const sequence = ++state.sequence;
  clearZoneState();
  state.selectionTypeId = preferred.type || 'mayor'; state.level = 'county'; state.loading = true; state.error = '';
  state.county = county; state.countyData = null; state.type = null; state.district = null; state.districtData = null;
  state.mapVillage = null; state.councilMapLinks = null;
  renderCounties();
  $('type-list').replaceChildren(); $('zone-list').replaceChildren(); $('district-list').replaceChildren();
  $('district-control').hidden = true; $('zone-search-wrap').hidden = true;
  $('coverage').textContent = county.available ? '登記資料可查' : '尚未匯入資料';
  syncCountyMap(); breadcrumb();
  if (!county.available) {
    state.loading = false; state.error = '縣市資料準備中';
    syncCountyMap(); message(`${county.name}資料準備中`, '請選擇其他縣市。', '＋'); updateUrl(true);
    return;
  }
  try {
    const countyData = await readJson(`${county.id}/index.json`);
    if (sequence !== state.sequence) return;
    state.countyData = countyData;
    await selectType(resolveElectionType(countyData.types, preferred.type), preferred);
  } catch (error) {
    if (sequence !== state.sequence) return;
    state.loading = false; state.error = '縣市資料載入失敗，請回台灣重新選擇縣市。';
    syncCountyMap(); message('資料載入失敗', error.message, '!'); updateUrl(true);
  }
}
async function selectType(type, preferred = {}) {
  if (!type) return;
  const sequence = ++state.sequence;
  clearZoneState();
  state.type = type; state.selectionTypeId = type.id; state.district = null; state.districtData = null;
  state.level = 'county'; state.loading = false; state.error = '';
  const family = mapElectionFamily(type.id);
  if (family === 'council') {
    state.loading = true; syncCountyMap();
    try {
      const links = await readCouncilMapLinks(state.county.id);
      if (sequence !== state.sequence) return;
      state.councilMapLinks = links;
      $('local-map-routing-status').textContent = '';
    } catch {
      if (sequence !== state.sequence) return;
      state.councilMapLinks = null;
      $('local-map-routing-status').textContent = '議員選區對照資料暫時無法讀取，仍可從下方清單選擇。';
    }
    state.loading = false;
  }
  const village = type.scope === 'village';
  const hasDistricts = type.districts.length > 0;
  $('zone-list').classList.toggle('village-list', village);
  $('zone-list').classList.toggle('council-list', family === 'council');
  $('district-control').hidden = !hasDistricts || family === 'village';
  $('zone-search-wrap').hidden = family === 'village' || !(hasDistricts || type.zones.length > 1);
  $('zone-search-wrap').querySelector('label').textContent = village ? '搜尋村里名或候選人' : '搜尋選區或候選人';
  $('zone-search').placeholder = village ? '例如：村里名稱、姓名' : '例如：第 8 選舉區、姓名';
  renderTypes(); breadcrumb();
  if (hasDistricts) {
    $('district-select').innerHTML = type.districts.map(district => `<option value="${escapeHtml(district.id)}">${escapeHtml(district.name)}（${district.zoneCount} ${village ? '村里' : '選區'}）</option>`).join('');
    let district = type.districts.find(item => item.id === preferred.district);
    let lookupIncomplete = false;
    if (!district && family === 'village' && preferred.zone) {
      // Old village URLs may omit district. Locate the exact zone instead of choosing another village.
      state.loading = true; syncCountyMap();
      const districtPayloads = await Promise.allSettled(type.districts.map(async item => ({district: item, data: await readJson(item.path)})));
      if (sequence !== state.sequence) return;
      const match = districtPayloads.find(result => result.status === 'fulfilled' && result.value.data.zones.some(zone => zone.id === preferred.zone));
      district = match?.value.district;
      lookupIncomplete = !match && districtPayloads.some(result => result.status === 'rejected');
      state.loading = false;
    }
    if (!district && family !== 'village') {
      const preferredZone = type.zones.find(zone => zone.id === preferred.zone);
      district = type.districts.find(item => item.name === preferredZone?.district) || type.districts[0];
    }
    if (district) {
      await selectDistrict(district, preferred.zone, sequence, Boolean(preferred.scrollToCandidates), preferred.scrollTarget);
      return;
    }
    renderDistricts(); syncCountyMap(); breadcrumb(); updateUrl(true);
    if (preferred.zone || preferred.district) $('region-summary').textContent += lookupIncomplete ? ' 部分資料讀取失敗，請重新選擇行政區。' : ' 連結中的區域未找到，請重新選擇行政區。';
    if (preferred.scrollToCandidates) focusLevel(sequence, 'region-level-heading');
    return;
  }
  renderZones();
  const zone = type.zones.find(item => item.id === preferred.zone);
  if (zone || family === 'mayor' || !family) {
    await selectZone(zone || type.zones[0], Boolean(preferred.scrollToCandidates), preferred.scrollTarget);
    return;
  }
  syncCountyMap(); breadcrumb(); updateUrl(true);
  if (preferred.zone) $('region-summary').textContent += ' 連結中的選區未找到，請重新選擇。';
  if (preferred.scrollToCandidates) focusLevel(sequence, 'region-level-heading');
}
async function selectDistrict(district, preferredZone, parentSequence, scrollToCandidates = false, scrollTarget = 'candidate-heading') {
  if (!district) return;
  const sequence = parentSequence || ++state.sequence;
  clearZoneState();
  state.district = district; state.districtData = null; state.level = 'district'; state.loading = true; state.error = '';
  $('district-select').value = district.id;
  $('district-control').hidden = false; $('zone-search-wrap').hidden = false;
  $('zone-list').innerHTML = '<p class="no-results">正在載入村里清單…</p>';
  syncCountyMap(); breadcrumb();
  try {
    if (district.path) {
      const data = await readJson(district.path);
      if (sequence !== state.sequence) return;
      state.districtData = data;
    }
    state.loading = false;
    renderZones();
    const zone = allZones().find(item => item.id === preferredZone);
    if (zone || mapElectionFamily(state.type.id) !== 'village') {
      await selectZone(zone || allZones()[0], scrollToCandidates, scrollTarget);
      return;
    }
    syncCountyMap(); breadcrumb(); updateUrl(true);
    if (preferredZone) $('region-summary').textContent += ' 連結中的村里未找到，請重新選擇。';
    if (scrollToCandidates) focusLevel(sequence, 'region-level-heading');
  } catch (error) {
    if (sequence !== state.sequence) return;
    state.loading = false; state.error = '村里資料載入失敗，請回到上層重新選擇行政區。';
    syncCountyMap(); message('村里載入失敗', error.message, '!'); updateUrl(true);
  }
}
async function selectZone(zone, scrollToCandidates = false, scrollTarget = 'candidate-heading') {
  if (!zone) return;
  const sequence = ++state.sequence;
  resetPartyHistory();
  state.level = 'result'; state.loading = true; state.error = '';
  state.zone = zone; state.zoneData = null; state.historyData = null;
  syncCountyMap();
  $('party-filter').value = '';
  state.candidateSort = {key: 'source', direction: 'asc'};
  state.historySort = {key: 'number', direction: 'asc'};
  $('history-content').replaceChildren();
  renderZones(); breadcrumb(); updateUrl();
  message('正在載入候選人', `${zone.area}的登記資料載入中…`, '⋯');
  try {
    const data = state.type.scope === 'village' ? {candidates: zone.candidates} : await readJson(zone.path);
    if (sequence !== state.sequence) return;
    state.loading = false;
    state.zoneData = data;
    renderResult();
    syncCountyMap();
    updateUrl(true);
    const historyReady = loadHistory(sequence);
    loadPartyHistory(sequence, historyReady);
    if (scrollToCandidates) focusLevel(sequence, scrollTarget === 'zone-heading' ? 'zone-heading' : 'candidate-heading');
  } catch (error) {
    if (sequence === state.sequence) {
      state.loading = false; state.error = '候選人資料載入失敗，請回到上層重新選擇。';
      syncCountyMap();
      message('候選人載入失敗', error.message, '!');
      updateUrl(true);
    }
  }
}
function renderResult() {
  if (!state.zoneData) return;
  showResult();
  const zone = state.zone;
  const stopped = zone.electionEvent?.status === 'stopped';
  const secondRegistration = zone.electionEvent?.status === 'second_registration_announced';
  $('data-stage').textContent = stopped ? '已停止選舉' : secondRegistration ? '第 2 次登記已公告' : '2026 登記資料';
  $('data-stage').classList.toggle('stopped', stopped || secondRegistration);
  $('result-parent').textContent = `${state.county.name} · ${state.type.label}${state.district ? ` · ${state.district.name}` : ''}`;
  $('result-title').textContent = shortZoneName(zone);
  $('candidate-zone-label').textContent = `· ${shortZoneName(zone)}`;
  $('result-geography').hidden = !zone.geography && !zone.seatSource;
  $('result-geography').innerHTML = [
    zone.geography ? `（${escapeHtml(zone.geography.coverage)}） <a href="${escapeHtml(zone.geography.sourceUrl)}" target="_blank" rel="noopener noreferrer">公告 ↗</a>` : '',
    zone.seatSource ? `<a href="${escapeHtml(zone.seatSource.url)}" target="_blank" rel="noopener noreferrer">席次公告第 ${zone.seatSource.page} 頁 ↗</a>` : '',
  ].filter(Boolean).join(' · ');
  $('result-description').textContent = `應選${zone.seats ?? '待確認'}席 · 登記${zone.candidateCount}人${zone.registrationRound ? ` · 第${zone.registrationRound}次登記` : ''}${stopped ? ' · 本次選舉已停止' : ''}${secondRegistration ? ' · 名單待補' : ''}`;
  $('zone-event').hidden = !zone.electionEvent;
  $('zone-event').innerHTML = zone.electionEvent ? `<strong>${stopped ? '本選區已停止選舉' : '本選區有第 2 次登記公告'}</strong><span>${escapeHtml(zone.electionEvent.summary)}${stopped ? ' 登記資料僅供查考。' : ''}<a href="${escapeHtml(zone.electionEvent.sourceUrl)}" target="_blank" rel="noopener noreferrer">查看 ${escapeHtml(zone.electionEvent.announcedOn)} 官方公告 ↗</a></span>` : '';
  const reference = zone.electorateReference;
  $('electorate-reference').hidden = !reference;
  $('electorate-reference').innerHTML = reference ?
    `<span>${escapeHtml(reference.year)} 年選舉人數：</span><strong>${reference.eligibleVoters.toLocaleString('zh-TW')}</strong><span>人</span>` : '';
  $('seat-card').hidden = false;
  $('seat-value').textContent = zone.seats == null ? '待確認' : zone.seats;
  $('seat-card').querySelector('span').hidden = zone.seats == null;
  $('seat-card').title = zone.seats == null ? '登記資料未提供此選區應選名額' : '';
  $('result-source').href = zone.registrationSourceUrl || state.type.sourceUrl;
  $('result-source').textContent = zone.registrationRound ? `第${zone.registrationRound}次登記 PDF ↗` : '中選會登記 PDF ↗';
  const parties = [...new Set(state.zoneData.candidates.map((candidate) => candidate.party))].sort((a,b) => a.localeCompare(b,'zh-Hant'));
  $('party-filter').innerHTML = '<option value="">全部政黨</option>' + parties.map((party) => `<option value="${escapeHtml(party)}">${escapeHtml(party === '無' ? '無政黨推薦（原資料：無）' : party)}</option>`).join('');
  renderCandidates();
  $('party-history-jump').hidden = !['metro_mayor', 'county_mayor'].includes(state.type.id) || !state.countyData.partyHistoryPath;
}
function resetPartyHistory() {
  state.partyHistoryView?.destroy();
  state.partyHistoryView = null;
  const container = $('party-history');
  container.hidden = true;
  container.replaceChildren();
  container.removeAttribute('aria-labelledby');
  $('party-history-jump').hidden = true;
}
async function loadPartyHistory(sequence, historyReady) {
  if (!['metro_mayor', 'county_mayor'].includes(state.type?.id)) return;
  const container = $('party-history');
  const path = state.countyData?.partyHistoryPath;
  if (!path) return;
  const countyName = state.county.name;
  container.hidden = false;
  container.textContent = '正在載入歷史政黨得票比例…';
  try {
    const data = await readJson(path);
    if (sequence !== state.sequence) return;
    if (!window.PartyHistory) throw new Error('圖表程式未載入，請重新整理頁面');
    state.partyHistoryView = window.PartyHistory.render(container, data, {countyName, shareMode: state.partyShareMode,
      onShareModeChange: mode => { if (sequence === state.sequence) setPartyShareMode(mode); }});
    if (location.hash === '#party-history') {
      // The 2022 block sits above the chart and changes its vertical position.
      // Restore the fragment only after both asynchronous sections settle.
      await historyReady;
      requestAnimationFrame(() => {
        if (sequence !== state.sequence || location.hash !== '#party-history') return;
        container.focus({preventScroll: true});
        container.scrollIntoView({block: 'start'});
      });
    }
  } catch (error) {
    if (sequence !== state.sequence) return;
    container.innerHTML = `<p>歷史政黨資料載入失敗：${escapeHtml(error.message)}</p><button type="button">重新載入歷史政黨資料</button>`;
    container.querySelector('button').addEventListener('click', () => loadPartyHistory(sequence, historyReady));
  }
}
function renderCandidates() {
  if (!state.zoneData) return;
  const party = $('party-filter').value;
  const list = state.zoneData.candidates.map((candidate, index) => ({candidate, index})).filter(({candidate}) =>
    !party || candidate.party === party);
  const sort = state.candidateSort;
  const statuses = reelectionStatuses(state.zoneData.candidates, state.historyData?.candidates || []);
  const value = (candidate) => sort.key === 'reelection' ? (statuses.get(candidate) ?? null) :
    sort.key === 'party' && candidate.party === '無' ? '無政黨推薦' : candidate[sort.key];
  if (sort.key !== 'source') list.sort((a,b) => compareValues(value(a.candidate), value(b.candidate), sort.direction) || a.index - b.index);
  $('filtered-count').textContent = `／${list.length} 人`;
  $('candidate-list').innerHTML = list.length ? list.map(({candidate}) => {
    const status = statuses.get(candidate);
    const notes = [candidate.note, candidate.statusNote].filter(Boolean);
    return `<tr><td><div class="candidate-person"><strong class="candidate-name">${escapeHtml(candidate.name)}</strong>${profileLinksHtml(candidate)}</div>${notes.length ? `<small class="candidate-table-note">${notes.map(escapeHtml).join(' · ')}</small>` : ''}</td><td>${escapeHtml(candidate.party === '無' ? '無政黨推薦' : candidate.party)}</td><td class="${status === 2 ? 'win-tag' : status === 1 ? 'repeat-tag' : ''}">${status === 2 ? '是' : status === 1 ? '再次參選' : ''}</td></tr>`;
  }).join('') : '<tr><td colspan="3" class="no-results">目前選區沒有符合政黨篩選條件的候選人。</td></tr>';
  updateSortHeaders('candidate-table', sort, 'candidate-sort-status');
}
function matchingRegistrationCandidates(currentCandidates, previousCandidates) {
  const names = (candidates) => candidates.filter((candidate) => candidate.name && candidate.name !== '姓名未載').map((candidate) => {
    const exact = candidate.name.trim();
    const normalized = exact.normalize('NFKC');
    return {candidate, exact, key: normalized.toLowerCase().replace(/[^\p{L}\p{N}]/gu, ''),
      han: normalized.replace(/[^\u4e00-\u9fff]/g, '')};
  });
  const index = (entries, field) => {
    const groups = new Map();
    for (const entry of entries) {
      const key = entry[field];
      if (key) groups.set(key, [...(groups.get(key) || []), entry]);
    }
    return groups;
  };
  const current = names(currentCandidates);
  const previous = names(previousCandidates);
  const currentIndexes = Object.fromEntries(['exact', 'key', 'han'].map((field) => [field, index(current, field)]));
  const previousIndexes = Object.fromEntries(['exact', 'key', 'han'].map((field) => [field, index(previous, field)]));
  const matches = new Map();
  for (const entry of previous) {
    const unique = (field) => currentIndexes[field].get(entry[field])?.length === 1 && previousIndexes[field].get(entry[field])?.length === 1;
    // Keep comparisons within the selected zone and follow the build script's unique-name rule.
    if (unique('exact')) matches.set(entry.candidate, currentIndexes.exact.get(entry.exact)[0].candidate);
    else if (unique('key')) matches.set(entry.candidate, currentIndexes.key.get(entry.key)[0].candidate);
    else if (entry.han.length >= 2 && unique('han') &&
      (entry.key === entry.han || currentIndexes.han.get(entry.han)[0].key === entry.han)) matches.set(entry.candidate, currentIndexes.han.get(entry.han)[0].candidate);
  }
  return matches;
}
function currentRegistrationMatches(currentCandidates, previousCandidates) {
  return new Set(matchingRegistrationCandidates(currentCandidates, previousCandidates).keys());
}
function historyParticipationText(candidate, registrations) {
  const notes = registrations.has(candidate) ? ['2026 有參選'] : [];
  if (candidate.legislator2024 && (!candidate.elected || !registrations.has(candidate))) notes.push('2024立委當選');
  return notes.join(' · ');
}
function historyParticipationHtml(candidate, registrations) {
  const notes = registrations.has(candidate) ? ['2026 有參選'] : [];
  const elected = candidate.legislator2024;
  if (elected && (!candidate.elected || !registrations.has(candidate))) {
    const url = new URL(elected.sourceUrl);
    if (url.protocol === 'https:' && url.hostname === 'web.cec.gov.tw' && url.pathname.startsWith('/api/file/') && url.pathname.endsWith('.pdf')) {
      notes.push(`<a href="${escapeHtml(url.href)}#page=${Number(elected.sourcePage)}" target="_blank" rel="noopener noreferrer" title="中選會2024當選公告 · ${escapeHtml(elected.area)}">2024立委當選</a>`);
    }
  }
  return notes.join('<br>');
}
function blueGreenParty(party) {
  if (party === '中國國民黨' || party === '國民黨') return 'kmt';
  if (party === '民主進步黨' || party === '民進黨') return 'dpp';
  return null;
}
function historyVoteCount(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}
function historyPercentage(value) {
  return value == null ? '—' : `${value.toFixed(2)}%`;
}
function historyShareView(candidates, mode) {
  const supplied = Array.isArray(candidates);
  const source = supplied ? candidates : [];
  const parties = [{id: 'kmt', name: '中國國民黨'}, {id: 'dpp', name: '民主進步黨'}].map(party => {
    const members = source.filter(candidate => blueGreenParty(candidate.party) === party.id);
    const counts = members.map(candidate => historyVoteCount(candidate.votes));
    const total = counts.some(value => value == null) ? null : counts.reduce((sum, value) => sum + value, 0);
    return {...party, candidateCount: members.length, votes: total != null && Number.isSafeInteger(total) ? total : null};
  });
  const missingParty = source.some(candidate => candidate.party == null || candidate.party === '');
  const sum = parties.every(party => party.votes != null) ? parties.reduce((total, party) => total + party.votes, 0) : null;
  const total = supplied && !missingParty && Number.isSafeInteger(sum) ? sum : null;
  const candidateCount = parties.reduce((sum, party) => sum + party.candidateCount, 0);
  const reason = !supplied || missingParty || total == null ? 'unknown' : !candidateCount ? 'no-candidates' : total === 0 ? 'zero' : 'ready';
  const valid = reason === 'ready';
  // Aggregate display uses complementary hundredths. Individual candidate
  // percentages remain each candidate's true votes / the shared denominator.
  const kmtBasisPoints = valid ? Math.round(parties[0].votes / total * 10000) : null;
  parties.forEach((party, index) => {
    party.share = valid ? party.votes / total * 100 : null;
    party.displayShare = valid ? (index === 0 ? kmtBasisPoints : 10000 - kmtBasisPoints) / 100 : null;
  });
  const rows = source.map((candidate, index) => {
    const votes = historyVoteCount(candidate.votes);
    const original = candidate.voteSharePercent;
    const share = mode === 'blue-green' ? valid && votes != null ? votes / total * 100 : null :
      typeof original === 'number' && Number.isFinite(original) && original >= 0 && original <= 100 ? original : null;
    return {candidate, index, share};
  }).filter(({candidate}) => mode !== 'blue-green' || blueGreenParty(candidate.party));
  return {rows, parties, total, valid, reason, candidateCount};
}
function setPartyShareMode(mode) {
  const chartMode = ['all', 'blue-green', 'selected'].includes(mode) ? mode : 'all';
  // Arbitrary party selection belongs to the historical chart; the 2022
  // candidate table keeps its existing all/blue-green comparison controls.
  state.partyShareMode = chartMode === 'selected' ? 'all' : chartMode;
  renderHistoryRows();
  state.partyHistoryView?.setShareMode(chartMode);
}
function renderHistoryShareMode(view) {
  const blueGreen = state.partyShareMode === 'blue-green';
  const controls = $('history-share-controls');
  for (const button of controls?.querySelectorAll('[data-history-share-mode]') || []) {
    button.setAttribute('aria-pressed', String(button.dataset.historyShareMode === state.partyShareMode));
  }
  const summary = $('history-blue-green-summary');
  if (summary) {
    summary.hidden = !blueGreen;
    if (blueGreen) {
      const votesText = value => value == null ? '—' : value.toLocaleString('zh-TW');
      const totalNote = view.valid ? '兩黨合計 100.00%' : view.reason === 'unknown' ? '票數或推薦政黨資料缺漏，無法計算比例' : view.reason === 'no-candidates' ? '本次沒有藍綠推薦候選人，無法計算比例' : '兩黨合計為 0 票，無法計算比例';
      summary.innerHTML = `<div class="history-blue-green-total"><small>藍綠合計（新分母）</small><strong>${votesText(view.total)}</strong><span>票</span><p>${totalNote}</p></div>` + view.parties.map(party =>
        `<div data-share-party="${party.id}"><small>${party.name}</small><strong>${votesText(party.votes)}</strong><span>票</span><p><b>${historyPercentage(party.displayShare)}</b><span>${party.candidateCount ? ` · ${party.candidateCount} 位推薦候選人` : ' · 無此黨推薦候選人'}</span></p></div>`).join('');
    }
  }
  const formula = $('history-share-formula');
  if (formula) {
    const validVotes = historyVoteCount(state.historyData?.profile?.validVotes);
    formula.textContent = blueGreen
      ? '投票率仍採完整選區資料。候選人比例＝個人原始票數 ÷ 國民黨與民進黨推薦候選人合計票數；兩黨摘要合計 100%，多人候選人的顯示比例合計可能因四捨五入略有差異。'
      : `投票率＝投票數 ÷ 選舉人數。候選人得票率＝個人得票數 ÷ 有效票數（${validVotes == null ? '—' : validVotes.toLocaleString('zh-TW')} 票）。`;
  }
  const rateButton = $('history-table')?.querySelector('[data-sort-key="voteSharePercent"]');
  if (rateButton) {
    rateButton.dataset.label = blueGreen ? '藍綠內得票率' : '得票率';
    const label = rateButton.querySelector('.table-heading-label>span');
    if (label) label.textContent = rateButton.dataset.label;
  }
}
function renderHistoryRows() {
  const tableBody = $('history-rows');
  if (!state.historyData || !tableBody) return;
  const candidates = Array.isArray(state.historyData.candidates) ? state.historyData.candidates : [];
  const registrations = currentRegistrationMatches(state.zoneData?.candidates || [], candidates);
  const view = historyShareView(state.historyData.candidates, state.partyShareMode);
  renderHistoryShareMode(view);
  const rows = view.rows;
  const sort = state.historySort;
  const value = ({candidate, share}) => sort.key === 'voteSharePercent' ? share : sort.key === 'registration' ? historyParticipationText(candidate, registrations) :
    sort.key === 'elected' ? Number(candidate.elected) : candidate[sort.key];
  rows.sort((a, b) => compareValues(value(a), value(b), sort.direction) || a.index - b.index);
  tableBody.innerHTML = rows.length ? rows.map(({candidate, share}) => `<tr><td>${escapeHtml(candidate.number ?? '—')}</td><td><div class="candidate-person"><span>${escapeHtml(candidate.name)}</span>${profileLinksHtml(candidate)}</div></td><td>${escapeHtml(candidate.party)}</td><td>${historyVoteCount(candidate.votes) == null ? '—' : candidate.votes.toLocaleString('zh-TW')}</td><td>${historyPercentage(share)}</td><td class="${candidate.elected ? 'win-tag' : 'lose-tag'}">${candidate.elected ? '當選' : '未當選'}</td><td class="registration-note">${historyParticipationHtml(candidate, registrations)}</td></tr>`).join('') :
    `<tr><td colspan="7" class="history-share-empty">${state.partyShareMode === 'blue-green' && view.reason !== 'unknown' ? '本次沒有中國國民黨或民主進步黨推薦的候選人，比例無法計算；可切回「全部候選人」查看完整結果。' : '候選人資料未知，無法計算比例。'}</td></tr>`;
  updateSortHeaders('history-table', sort, 'history-sort-status');
}
async function loadHistory(sequence) {
  if (!state.zone?.previousPath) {
    $('history-content').innerHTML = '<p class="history-note">此選區沒有可直接對應的 2022 上屆資料。</p>';
    return;
  }
  const path = state.zone.previousPath;
  const zoneId = state.zone.id;
  const village = state.type.scope === 'village';
  $('history-content').textContent = '正在載入 2022 結果…';
  try {
    const payload = await readJson(path);
    if (sequence !== state.sequence) return;
    const data = village ? payload.results[zoneId] : payload;
    state.historyData = data;
    renderCandidates();
    const profile = data.profile;
    const electionLabel = data.electionDate ? `${data.electionDate} ${data.electionKind === 'rerun' ? '重行選舉' : '選舉'}` : '2022 年';
    const historySourceUrl = data.sourceUrl || state.countyData.previousSourceUrl;
    const historicalAreaNote = data.sourceZone && !/[\uE000-\uF8FF]/u.test(data.sourceZone) ?
      `（2022 原始選區名稱：${escapeHtml(data.sourceZone)}）` : '';
    $('history-content').innerHTML = `<p class="history-note">${escapeHtml(electionLabel)}「${escapeHtml(data.zone)}」${historicalAreaNote}投票結果，資料來自<a href="${escapeHtml(historySourceUrl)}" target="_blank" rel="noopener noreferrer">中選會官方資料</a>。「2026 有參選」依本頁同選區登記名單比對。</p><div class="history-summary"><div><small>選舉人數（可投票）</small><strong>${profile.eligibleVoters.toLocaleString('zh-TW')}</strong><span>人</span></div><div><small>投票數（已投票）</small><strong>${profile.ballotsCast.toLocaleString('zh-TW')}</strong><span>票</span></div><div><small>投票率</small><strong>${profile.turnoutPercent.toFixed(2)}%</strong></div></div>
      <div id="history-share-controls" class="history-share-controls" role="group" aria-label="2022 候選人比例顯示方式">
        <span>比例顯示</span><button type="button" data-history-share-mode="all" aria-controls="history-table history-blue-green-summary" aria-pressed="${state.partyShareMode === 'all'}">全部候選人</button><button type="button" data-history-share-mode="blue-green" aria-controls="history-table history-blue-green-summary" aria-pressed="${state.partyShareMode === 'blue-green'}">只看藍綠（合計100%）</button>
      </div><div id="history-blue-green-summary" class="history-blue-green-summary" hidden></div><p id="history-share-formula" class="history-formula"></p>
      <span id="history-sort-status" class="sr-only" aria-live="polite"></span><p class="history-scroll-hint">表格可左右滑動查看完整欄位</p><div class="history-table-scroll" tabindex="0" aria-label="2022 候選人得票結果表，可左右捲動"><table id="history-table" class="history-table sortable-table" aria-labelledby="history-heading"><thead>${tableHeaders(historyColumns)}</thead><tbody id="history-rows"></tbody></table></div>`;
    for (const button of $('history-share-controls').querySelectorAll('[data-history-share-mode]')) {
      button.addEventListener('click', () => setPartyShareMode(button.dataset.historyShareMode));
    }
    attachTableSorting('history-table', 'history');
    renderHistoryRows();
  } catch (error) {
    if (sequence !== state.sequence) return;
    $('history-content').innerHTML = `<p class="history-note">2022 資料載入失敗：${escapeHtml(error.message)}</p><button type="button" class="history-retry">重新載入 2022 資料</button>`;
    $('history-content').querySelector('button').addEventListener('click', () => loadHistory(sequence));
  }
}
async function init() {
  if (location.protocol === 'file:') {
    $('coverage').textContent = '請使用 localhost';
    $('county-hint').textContent = '目前開的是 HTML 檔案；請改用本機網址載入查詢資料。';
    document.querySelector('.zone-panel').hidden = true;
    message('請改用本機網址開啟', '先在專案資料夾執行 zsh scripts/start_localhost.sh，再用 Chrome 開啟 http://127.0.0.1:8765/。直接開啟 HTML 檔無法載入資料。', '!');
    $('empty-state').insertAdjacentHTML('beforeend', '<p><a href="http://127.0.0.1:8765/">開啟本機查詢網站 ↗</a></p>');
    return;
  }
  $('district-select').addEventListener('change', (event) => { state.navigationMode='user'; selectDistrict(state.type.districts.find((district) => district.id === event.target.value), undefined, undefined, true); });
  for (const button of document.querySelectorAll('[data-map-family]')) {
    button.addEventListener('click', () => {
      if (!state.manifest) return;
      const family = button.dataset.mapFamily;
      state.navigationMode = 'user';
      clearRouteHash(); showTaiwan(family, true);
    });
  }
  for (const button of document.querySelectorAll('[data-region-back]')) button.addEventListener('click', goUp);
  for (const button of document.querySelectorAll('[data-taiwan-return]')) button.addEventListener('click', () => {
    state.navigationMode = 'user'; clearRouteHash(); showTaiwan(undefined, true);
  });
  for (const link of document.querySelectorAll('[data-zone-return]')) link.addEventListener('click', event => {
    if (mapElectionFamily(state.type?.id || state.selectionTypeId)) { event.preventDefault(); goUp(); }
  });
  for (const link of document.querySelectorAll('[data-map-return]')) link.addEventListener('click', event => {
    event.preventDefault(); state.navigationMode = 'user'; clearRouteHash(); showTaiwan(undefined, true);
  });
  for (const link of document.querySelectorAll('a[href="#county-list"]')) {
    link.addEventListener('click', () => { $('county-text-picker').open = true; });
  }
  addEventListener('popstate', async () => {
    if (!state.manifest || (!state.loading && `${location.pathname}${location.search}` === state.routeUrl)) return;
    state.navigationMode = 'restore';
    await restoreRoute();
  });
  $('zone-search').addEventListener('input', renderZones);
  $('clear-zone-search').addEventListener('click', () => { $('zone-search').value=''; renderZones(); $('zone-search').focus(); });
  $('party-filter').addEventListener('change', renderCandidates);
  $('candidate-columns').innerHTML = tableHeaders(candidateColumns);
  attachTableSorting('candidate-table', 'candidate');
  message('正在載入資料', '請稍候…', '⋯');
  try {
    state.manifest = await readJson('counties.json');
    if (window.TaiwanVillageMap) state.villageMapView = window.TaiwanVillageMap.create($('village-map'), {
      onDistrictSelect: mapDistrictSelected, onVillageSelect: mapVillageSelected,
      onCouncilSelect: mapCouncilSelected,
    });
    if (window.TaiwanCountyMap) {
      state.countyMapView = window.TaiwanCountyMap.create($('county-map'), state.manifest.counties, (id) => {
        state.navigationMode = 'user';
        clearRouteHash();
        const family = mapElectionFamily(state.type?.id || state.selectionTypeId) || 'mayor';
        selectCounty(id, {type: family, scrollToCandidates: true,
          scrollTarget: family === 'mayor' ? 'candidate-heading' : 'region-level-heading'});
      });
    }
    const available = state.manifest.counties.filter((county) => county.available);
    $('county-hint').textContent = available.length === state.manifest.counties.length ?
      `全台 ${available.length} 縣市的 2026 登記資料可查；請選擇縣市、選舉種類與選區。` :
      `已建立 ${state.manifest.counties.length} 縣市入口，目前可查 ${available.length} 縣市。`;
    await restoreRoute();
  } catch (error) { message('網站資料載入失敗', `請重新整理頁面後再試；若仍無法載入，請稍後再開啟網站。${error.message}`, '!'); }
}
init();
