/* Local village boundaries. Election routing remains in app.js. */
window.TaiwanVillageMap = (() => {
  const NS = 'http://www.w3.org/2000/svg';
  const TYPES = new Set(['council', 'metro_council', 'county_council', 'village', 'village_head']);
  const COUNCIL_KINDS = ['geographic', 'plain_indigenous', 'mountain_indigenous'];
  const KIND_LABELS = {geographic: '區域議員', plain_indigenous: '平地原住民', mountain_indigenous: '山地原住民'};
  const cache = new Map();
  let instanceNumber = 0;
  function node(tag, className, text) {
    const item = document.createElement(tag);
    if (className) item.className = className;
    if (text != null) item.textContent = text;
    return item;
  }
  function svgNode(tag, attrs = {}, text) {
    const item = document.createElementNS(NS, tag);
    Object.entries(attrs).forEach(([key, value]) => item.setAttribute(key, String(value)));
    if (text != null) item.textContent = text;
    return item;
  }
  function councilNumberLabel(feature) {
    // Use the source's election number, never a polygon's position in the list.
    const match = feature.name.match(/^第0*([1-9]\d?)選舉區$/);
    if (!match) return feature.name;
    const value = Number(match[1]), digits = '零一二三四五六七八九';
    if (value < 10) return digits[value];
    return `${value < 20 ? '' : digits[Math.floor(value / 10)]}十${value % 10 ? digits[value % 10] : ''}`;
  }
  function councilDisplayName(feature) {
    const number = councilNumberLabel(feature);
    return number === feature.name ? feature.name : `第${number}選舉區`;
  }
  function boxOf(bounds, padding = .055) {
    const [x1, y1, x2, y2] = bounds;
    const width = Math.max(x2 - x1, .1), height = Math.max(y2 - y1, .1);
    const pad = Math.max(width, height) * padding;
    return {x: x1 - pad, y: y1 - pad, width: width + 2 * pad, height: height + 2 * pad};
  }
  function boundsOf(items) {
    return items.reduce((bounds, item) => [Math.min(bounds[0], item.bounds[0]), Math.min(bounds[1], item.bounds[1]), Math.max(bounds[2], item.bounds[2]), Math.max(bounds[3], item.bounds[3])], [Infinity, Infinity, -Infinity, -Infinity]);
  }
  function validBounds(bounds) {
    return Array.isArray(bounds) && bounds.length === 4 && bounds.every(Number.isFinite) && bounds[2] > bounds[0] && bounds[3] > bounds[1];
  }
  function validate(data, countyId) {
    const view = typeof data.viewBox === 'string' ? data.viewBox.split(/\s+/).map(Number) : [];
    if (String(data.countyId) !== String(countyId) || view.length !== 4 || !view.every(Number.isFinite) || view[2] <= 0 || view[3] <= 0 || !data.villages?.length) throw new Error('村里地圖格式不完整');
    const ids = new Set();
    for (const item of data.villages) {
      if (!item.id || ids.has(item.id) || typeof item.name !== 'string' || typeof item.districtName !== 'string' || typeof item.path !== 'string' || !item.path || !validBounds(item.bounds) || !Number.isFinite(item.anchor?.x) || !Number.isFinite(item.anchor?.y)) throw new Error('村里地圖格式不完整');
      if (!Number.isFinite(item.labelAnchor?.x) || !Number.isFinite(item.labelAnchor?.y) || !Number.isFinite(item.labelBox?.width) || !Number.isFinite(item.labelBox?.height) || item.labelBox.width <= 0 || item.labelBox.height <= 0) throw new Error('村里名稱位置格式不完整');
      ids.add(item.id);
    }
    return data;
  }
  function renderableShape(item) {
    return typeof item.path === 'string' && item.path.length > 0 && validBounds(item.bounds) && Number.isFinite(item.anchor?.x) && Number.isFinite(item.anchor?.y);
  }
  function validateCouncil(data, countyId) {
    const box = typeof data.viewBox === 'string' ? data.viewBox.split(/\s+/).map(Number) : [];
    if (String(data.countyId) !== String(countyId) || typeof data.typeId !== 'string' || !Array.isArray(data.groups) || !data.zones?.length || box.length !== 4 || !box.every(Number.isFinite) || box[2] <= 0 || box[3] <= 0) throw new Error('議員選區地圖格式不完整');
    const ids = new Set();
    for (const item of data.zones) {
      if (!item.id || ids.has(item.id) || typeof item.name !== 'string' || !COUNCIL_KINDS.includes(item.kind) || !Array.isArray(item.villageIds)) throw new Error('議員選區地圖格式不完整');
      if (item.path && (!renderableShape(item) || !Number.isFinite(item.labelAnchor?.x) || !Number.isFinite(item.labelAnchor?.y) || !Number.isFinite(item.labelBox?.width) || !Number.isFinite(item.labelBox?.height) || item.labelBox.width <= 0 || item.labelBox.height <= 0)) throw new Error('議員選區名稱位置格式不完整');
      ids.add(item.id);
    }
    for (const group of data.groups) if (!COUNCIL_KINDS.includes(group.kind) || !Array.isArray(group.zoneIds) || group.zoneIds.some(id => !ids.has(id))) throw new Error('議員種類對照格式不完整');
    return data;
  }
  function sameProjection(villages, council) {
    if (villages.viewBox !== council.viewBox || villages.regions?.length !== council.regions?.length) return false;
    return villages.regions.every(region => {
      const other = council.regions.find(item => item.id === region.id);
      const a = region.geoTransform, b = other?.geoTransform;
      return a && b && a.crs === b.crs && Number.isFinite(a.scale) && Number.isFinite(b.scale) && Math.abs(a.scale - b.scale) < 1e-12 && Array.isArray(a.translate) && Array.isArray(b.translate) && a.translate.length === 2 && b.translate.length === 2 && a.translate.every((value, index) => Number.isFinite(value) && Number.isFinite(b.translate[index]) && Math.abs(value - b.translate[index]) < 1e-7);
    });
  }
  async function load(countyId, url, validator = validate) {
    if (!cache.has(url)) {
      const pending = fetch(url).then(response => {
        if (!response.ok) throw new Error('村里地圖無法讀取');
        return response.json();
      }).then(data => validator(data, countyId));
      cache.set(url, pending);
      pending.catch(() => { if (cache.get(url) === pending) cache.delete(url); });
    }
    return cache.get(url);
  }
  function create(root, options = {}) {
    const instanceId = `village-map-${++instanceNumber}`;
    root.classList.add('village-map');
    root.hidden = true;
    const header = node('div', 'village-map-header');
    const headings = node('div');
    const title = node('h3', 'village-map-title');
    title.id = `${instanceId}-heading`; title.tabIndex = -1;
    const description = node('p', 'village-map-description');
    headings.append(title, description);
    const count = node('span', 'village-map-count');
    header.append(headings, count);
    const councilControls = node('div', 'village-map-council-kinds'); councilControls.hidden = true;
    councilControls.setAttribute('role', 'group'); councilControls.setAttribute('aria-label', '地圖顯示的議員選區類別');
    const councilNotice = node('p', 'village-map-council-notice'); councilNotice.hidden = true;
    const coverageNotice = node('div', 'village-map-coverage-notice'); coverageNotice.hidden = true;
    const councilRetry = node('button', 'village-map-council-retry', '重新載入議員選區地圖'); councilRetry.type = 'button'; councilRetry.hidden = true;
    const searchWrap = node('div', 'village-map-search');
    const label = node('label', null, '找村里'); label.htmlFor = `${instanceId}-search`;
    const search = node('input'); search.type = 'search'; search.id = label.htmlFor;
    search.placeholder = '輸入村里或鄉鎮市區名稱'; search.autocomplete = 'off';
    const searchResults = node('div', 'village-map-search-results'); searchResults.hidden = true;
    const searchStatus = node('span', 'sr-only'); searchStatus.setAttribute('role', 'status');
    searchWrap.append(label, search, searchResults, searchStatus);
    const layerControls = node('div', 'village-map-layers');
    layerControls.setAttribute('role', 'group'); layerControls.setAttribute('aria-label', '地圖顯示方式');
    layerControls.append(node('span', null, '地圖顯示'));
    const baseButton = node('button', null, '底圖＋里界'); baseButton.type = 'button';
    const boundaryButton = node('button', null, '只看里界'); boundaryButton.type = 'button';
    layerControls.append(baseButton, boundaryButton);
    const namesButton = node('button', 'village-map-names-toggle', '顯示全部里名'); namesButton.type = 'button';
    namesButton.setAttribute('aria-pressed', 'false'); namesButton.hidden = true;
    layerControls.append(namesButton);
    const frame = node('div', 'village-map-frame');
    const canvas = node('div', 'village-map-canvas');
    const tooltip = node('div', 'village-map-tooltip'); tooltip.hidden = true;
    const tooltipDistrict = node('span'); const tooltipName = node('strong');
    const tooltipCoverage = node('p', 'village-map-tooltip-coverage'); tooltipCoverage.hidden = true;
    tooltip.append(tooltipDistrict, tooltipName, tooltipCoverage);
    const toolbar = node('div', 'village-map-toolbar'); toolbar.setAttribute('aria-label', '村里地圖縮放');
    const zoomIn = node('button', null, '+'); zoomIn.type = 'button'; zoomIn.setAttribute('aria-label', '放大村里地圖');
    const zoomOut = node('button', null, '−'); zoomOut.type = 'button'; zoomOut.setAttribute('aria-label', '縮小村里地圖');
    const reset = node('button', 'village-map-reset', '完整範圍'); reset.type = 'button';
    toolbar.append(zoomIn, zoomOut, reset);
    frame.append(toolbar, canvas, tooltip);
    const baseInfo = node('div', 'village-map-base-info');
    const baseAttribution = node('a', 'village-map-base-attribution', '底圖：內政部國土測繪中心 · 臺灣通用電子地圖');
    baseAttribution.href = 'https://maps.nlsc.gov.tw/S09SOA/pro/Wmts_ajax_main.jsp';
    baseAttribution.target = '_blank'; baseAttribution.rel = 'noopener noreferrer';
    const baseStatus = node('span', 'village-map-base-status'); baseStatus.setAttribute('role', 'status');
    const baseRetry = node('button', 'village-map-base-retry', '重試底圖'); baseRetry.type = 'button'; baseRetry.hidden = true;
    baseInfo.append(baseAttribution, baseStatus, baseRetry);
    const inspection = node('p', 'village-map-inspection'); inspection.setAttribute('role', 'status');
    const namesHint = node('p', 'village-map-names-hint', '里名固定在各自里界內，會隨地圖一起縮放；小範圍可放大查看。'); namesHint.hidden = true;
    const legend = node('div', 'village-map-legend');
    const borderKey = node('span'); borderKey.append(node('i'), document.createTextNode('村里界'));
    const selectedKey = node('span'); selectedKey.append(node('i', 'is-selected'), document.createTextNode('目前選取'));
    const guide = node('span', null, '拖曳可移動 · 按 + 放大');
    legend.append(borderKey, selectedKey, guide);
    const sourceDetails = node('details', 'village-map-source');
    sourceDetails.append(node('summary', null, '村里圖資來源'));
    const sourceText = node('p'); sourceDetails.append(sourceText);
    root.setAttribute('aria-labelledby', title.id);
    root.replaceChildren(header, councilControls, councilNotice, councilRetry, coverageNotice, searchWrap, layerControls, frame, baseInfo, inspection, namesHint, legend, sourceDetails);

    let context = {}, geometry = null, svg = null, visible = [], features = new Map(), home = null, viewport = null;
    let sequence = 0, destroyed = false, viewKey = '', active = null, pointerDrag = null, suppressClickUntil = 0, districtMode = false, hoverLock = null;
    let basemap = null, showBasemap = true;
    let showNames = false, showCouncilNames = true, villageNames = null;
    let islandLabels = new Map();
    let pointerPosition = null, lastInputWasPointer = false, labelResizeObserver = null;
    let councilGeometry = null, councilMode = false, councilResult = false, activeCouncilZone = null, councilKind = 'geographic', councilLoadError = false, fallbackResult = false, fallbackMemberView = false;
    const councilKindsByCounty = new Map();
    const listeners = [];
    function listen(target, event, callback, settings) {
      target.addEventListener(event, callback, settings); listeners.push(() => target.removeEventListener(event, callback, settings));
    }
    function family() { return ['village', 'village_head'].includes(context.typeId) ? 'village' : 'council'; }
    function villageAction(feature) { return family() === 'village' && !feature.zoneId ? '查看尚未對應候選資料的說明' : `查看${family() === 'council' ? '所屬區域議員選區' : '村里長候選人'}`; }
    function councilUrl(id) { return options.councilGeometryUrl?.(id) || `./assets/council-maps/${id}.json?v=council-unions-1`; }
    function resolveCouncilKind() {
      const current = councilGeometry && String(councilGeometry.countyId) === String(countyId()) ? councilGeometry : null;
      const zone = context.level === 'result' && current?.zones.find(item => item.id === context.zoneId);
      const available = current?.groups.filter(group => group.zoneIds.length).map(group => group.kind) || COUNCIL_KINDS;
      const preferred = zone?.kind || councilKindsByCounty.get(String(countyId())) || 'geographic';
      councilKind = available.includes(preferred) ? preferred : available[0] || 'geographic';
      if (current) councilKindsByCounty.set(String(countyId()), councilKind);
    }
    function contextKey() {
      const membership = family() === 'council' && context.level === 'result' && !councilGeometry ? (context.councilVillageIds || []).join(',') : '';
      return `${countyId()}|${context.typeId}|${context.level}|${context.districtId || context.districtName || ''}|${family() === 'council' ? `${context.zoneId || ''}|${councilKind}|${membership}` : ''}`;
    }
    function renderCouncilControls() {
      councilControls.replaceChildren(); councilControls.hidden = family() !== 'council' || !councilGeometry || context.level === 'result';
      councilNotice.hidden = family() !== 'council'; councilRetry.hidden = !councilLoadError || family() !== 'council';
      if (family() !== 'council') return;
      if (!councilGeometry) {
        councilNotice.textContent = context.level === 'result'
          ? `目前選區圖形未載入，候選人名單保留；只可標示已確認屬此區的位置，其他區請回到上層或使用清單。${fallbackMemberView ? '只呈現已確認村里界，未重建選區外框。' : '此圖是全縣市概略，不能據此推定目前選區範圍。'}地理位置不判定選民資格。`
          : '議員選區圖形暫時無法載入，改用村里地圖；點村里可查看區域議員，其他資格選區請使用清單。地理位置不判定選民資格。';
        return;
      }
      for (const group of councilGeometry.groups.filter(item => item.zoneIds.length)) {
        const button = node('button', null, KIND_LABELS[group.kind] || group.label); button.type = 'button';
        button.dataset.councilKind = group.kind; button.setAttribute('aria-pressed', String(group.kind === councilKind));
        button.addEventListener('click', () => {
          if (context.level !== 'county' || councilKind === group.kind) return;
          const restoreFocus = document.activeElement === button;
          councilKind = group.kind; councilKindsByCounty.set(String(countyId()), councilKind);
          search.value = ''; searchResults.hidden = true; viewKey = contextKey(); renderGeometry();
          if (restoreFocus && !councilControls.hidden) councilControls.querySelector(`[data-council-kind="${group.kind}"]`)?.focus({preventScroll: true});
        });
        councilControls.append(button);
      }
      const chosen = context.level === 'result' ? [activeCouncilZone].filter(Boolean) : councilGeometry.zones.filter(item => item.kind === councilKind);
      const incomplete = chosen.filter(item => !item.complete);
      const kindName = KIND_LABELS[councilKind] || '議員';
      const gaps = incomplete.map(item => {
        const named = item.missingSourceVillages?.length || 0, administrative = item.omittedAdministrativePieces?.length || 0;
        const reasons = [];
        if (named) reasons.push(`缺 ${named} 個公告村里圖形來源`);
        if (administrative) reasons.push(`${administrative} 個未編定行政背景面未呈現`);
        if (!reasons.length) reasons.push('圖形來源不完整');
        return `${item.name}${reasons.join('、')}`;
      });
      councilNotice.textContent = `${kindName} · 地理位置不判定選民資格。${context.level === 'county' ? '類別只切換地圖，選區列表保留全部類別。' : ''}${gaps.length ? ` ${gaps.join('；')}；只呈現已配準範圍，不推補缺漏。` : ''}`;
    }
    function basemapStatus(value) {
      if (destroyed) return;
      root.dataset.basemapState = value.state;
      baseRetry.hidden = !showBasemap || !['partial', 'error'].includes(value.state);
      const messages = {loading: '道路地名底圖載入中…', ready: '對照道路、河川與地名，點選自己的區域。', partial: '部分底圖未載入，仍可點選里界。', error: '底圖暫時無法載入，仍可點選里界。', off: '目前只顯示行政界線。', unavailable: '底圖暫時無法套疊，仍可點選里界。'};
      baseStatus.textContent = messages[value.state] || '';
    }
    function syncBasemapMode() {
      root.classList.toggle('has-basemap', showBasemap);
      baseButton.setAttribute('aria-pressed', String(showBasemap));
      boundaryButton.setAttribute('aria-pressed', String(!showBasemap));
      baseAttribution.hidden = !showBasemap;
      basemap?.setEnabled(showBasemap && !root.hidden);
      if (!showBasemap) basemapStatus({state: 'off'});
      else if (!basemap) basemapStatus({state: 'unavailable'});
    }
    function clearBasemap() { basemap?.destroy(); basemap = null; }
    function syncNames() {
      const shown = councilMode ? showCouncilNames : showNames;
      namesButton.setAttribute('aria-pressed', String(shown));
      namesButton.textContent = councilMode ? `${shown ? '隱藏' : '顯示'}選區編號` : `${shown ? '隱藏' : '顯示'}全部里名`;
      namesHint.textContent = councilMode
        ? `${['澎湖縣', '連江縣'].includes(geometry.countyName) ? '離島選區編號拉至旁側，以引線連回對應選區。' : ''}一、二、三等國字代表選區編號；滑鼠移到範圍或編號，或以鍵盤移至選區，可查看完整選區名稱與行政區範圍。`
        : '里名固定在各自里界內，會隨地圖一起縮放；小範圍可放大查看。';
      const enabled = shown && !namesButton.hidden;
      root.dataset.villageLabels = String(enabled);
      namesHint.hidden = !enabled;
      if (villageNames) villageNames.style.display = enabled ? '' : 'none';
      syncIslandLabels();
    }
    function countyId() { return typeof context.county === 'object' ? context.county?.id : context.county; }
    function featureKey(feature) { return feature.id || feature.code || feature.name; }
    function featureLabel(feature) { return districtMode || councilMode ? feature.name : `${feature.districtName}${feature.name}`; }
    function districtMatch(feature) {
      return !context.districtId && !context.districtName || String(feature.districtId) === String(context.districtId) || feature.districtName === context.districtName;
    }
    function selected(feature) {
      if (councilMode) return Boolean(context.zoneId && feature.id === context.zoneId);
      if (councilResult || fallbackResult) return Boolean(context.selectedVillageId && String(context.selectedVillageId) === String(feature.id));
      if (districtMode) return Boolean(context.districtId && feature.id === context.districtId || context.districtName && feature.name === context.districtName);
      const zoneId = context.zoneId || context.zone?.id;
      if (family() === 'village' && zoneId) return feature.zoneId === zoneId;
      if (context.selectedVillageId && String(context.selectedVillageId) === String(feature.id)) return true;
      if (family() === 'village') return false;
      const ids = context.councilVillageIds || [];
      return ids.includes(feature.id) || ids.includes(feature.zoneId);
    }
    function defaultInspection() {
      const chosen = visible.find(selected);
      inspection.textContent = councilMode ? '點選議員選區範圍，直接查看該選區候選人。' : councilResult ? `目前顯示${activeCouncilZone.name}範圍內的 ${visible.length} 個村里${chosen ? ` · 已標示${featureLabel(chosen)}` : ''}。` : fallbackResult ? `候選人名單保留；${fallbackMemberView ? `顯示 ${visible.length} 個已確認村里位置` : '目前為全縣市概略，不能推定本選區範圍'}。` : districtMode ? '點選鄉鎮市區範圍，進入該區的村里地圖。' : chosen && family() === 'village' ? `已選取 ${chosen.districtName}${chosen.name}` : `點選村里範圍，${family() === 'council' ? '查看該村里所屬區域議員選區' : '查看村里長候選人'}。`;
    }
    function inspectionAnchor(feature) {
      return islandLabels.get(feature.id)?.visibleAnchor?.point || (islandLabels.has(feature.id) ? feature.labelAnchor : feature.anchor);
    }
    function positionTooltip() {
      if (!active || !svg || !svg.getScreenCTM()) { tooltip.hidden = true; return; }
      const anchor = inspectionAnchor(active);
      const point = svg.createSVGPoint(); point.x = anchor.x; point.y = anchor.y;
      let screen = point.matrixTransform(svg.getScreenCTM());
      if (islandLabels.has(active.id) && pointerPosition) {
        const hit = document.elementFromPoint(pointerPosition.x, pointerPosition.y);
        const hovered = hit?.closest?.('[data-council-zone-id],[data-label-council-zone-id]');
        const hoveredId = hovered?.getAttribute('data-council-zone-id') || hovered?.getAttribute('data-label-council-zone-id');
        // A hovered piece can be visible while the other islands are offscreen.
        if (hoveredId === featureKey(active)) screen = pointerPosition;
      }
      const rect = frame.getBoundingClientRect();
      const topInset = Math.max(0, Number(options.getViewportTopInset?.()) || 0);
      if (screen.x < rect.left || screen.x > rect.right || screen.y < rect.top || screen.y > rect.bottom
          || screen.x < 0 || screen.x > window.innerWidth || screen.y < topInset || screen.y > window.innerHeight) { tooltip.hidden = true; return; }
      tooltip.hidden = false;
      const width = tooltip.offsetWidth;
      const height = tooltip.offsetHeight;
      const topMin = Math.max(8, topInset - rect.top + 8);
      const topMax = Math.min(rect.height - height - 8, window.innerHeight - rect.top - height - 8);
      let top = screen.y - rect.top - height - 10;
      if (top < topMin) top = screen.y - rect.top + 10;
      tooltip.style.left = `${Math.max(8, Math.min(rect.width - width - 8, screen.x - rect.left - width / 2))}px`;
      tooltip.style.top = `${Math.max(topMin, Math.min(topMax, top))}px`;
    }
    function keepFocusedFeatureVisible(feature, group) {
      requestAnimationFrame(() => {
        if (destroyed || root.hidden || !svg || !group.isConnected || document.activeElement !== group) return;
        const matrix = svg.getScreenCTM(); if (!matrix) return;
        const anchor = inspectionAnchor(feature);
        const point = svg.createSVGPoint(); point.x = anchor.x; point.y = anchor.y;
        const screen = point.matrixTransform(matrix);
        // Natural Tab can scroll a zoomed SVG's old path bounds into view.
        // After that scroll, retain the newly focused geographic point onscreen.
        const topInset = Math.max(0, Number(options.getViewportTopInset?.()) || 0);
        if (screen.y < topInset + Math.max(56, tooltip.offsetHeight + 18) || screen.y > window.innerHeight - 56) {
          window.scrollBy({top: screen.y - (topInset + window.innerHeight) / 2, left: 0, behavior: 'auto'});
        }
        positionTooltip();
      });
    }
    function inspect(feature) {
      if (active) features.get(featureKey(active))?.classList.remove('is-hovered');
      active = feature || null;
      if (!active) { tooltip.hidden = true; defaultInspection(); return; }
      features.get(featureKey(active))?.classList.add('is-hovered');
      tooltipDistrict.textContent = councilMode ? active.electorateLabel || KIND_LABELS[active.kind] : districtMode ? geometry.countyName : active.districtName;
      tooltipName.textContent = councilMode ? `${geometry.countyName} · ${councilDisplayName(active)}` : active.name;
      const coverage = councilMode ? active.coverage : '';
      tooltipCoverage.hidden = !coverage;
      tooltipCoverage.textContent = coverage ? `範圍：${coverage}` : '';
      tooltip.classList.toggle('has-coverage', Boolean(coverage));
      inspection.textContent = councilMode ? `${active.name} · ${active.coverage || ''}` : councilResult ? `${featureLabel(active)} · ${activeCouncilZone.name}範圍` : fallbackResult ? `${featureLabel(active)} · 核對位置，候選人名單保留` : districtMode ? `${active.name} · 點選進入村里地圖` : `${active.districtName}${active.name} · 點選${villageAction(active)}`;
      positionTooltip();
    }
    function setViewport(next) {
      if (!svg || !home) return;
      viewport = {...next};
      const cx = Math.max(home.x - home.width * .1, Math.min(home.x + home.width * 1.1, viewport.x + viewport.width / 2));
      const cy = Math.max(home.y - home.height * .1, Math.min(home.y + home.height * 1.1, viewport.y + viewport.height / 2));
      viewport.x = cx - viewport.width / 2; viewport.y = cy - viewport.height / 2;
      svg.setAttribute('viewBox', `${viewport.x} ${viewport.y} ${viewport.width} ${viewport.height}`);
      syncIslandLabels();
      zoomIn.disabled = viewport.width <= home.width / 40 + .001;
      zoomOut.disabled = viewport.width >= home.width * 1.2 - .001;
      root.dataset.zoom = (home.width / viewport.width).toFixed(2);
      positionTooltip();
      basemap?.update(viewport);
    }
    function zoom(factor) {
      if (!viewport || !home) return;
      const width = Math.max(home.width / 40, Math.min(home.width * 1.2, viewport.width / factor));
      const height = width * viewport.height / viewport.width;
      setViewport({x: viewport.x + (viewport.width - width) / 2, y: viewport.y + (viewport.height - height) / 2, width, height});
    }
    function allowPointerInspection(event) {
      if (!hoverLock) return true;
      // Changing the viewBox or hiding search results changes hit testing under a
      // stationary cursor. Retain the searched feature until the user moves it.
      if (!Number.isFinite(hoverLock.x) || !Number.isFinite(hoverLock.y)) {
        hoverLock.x = event.clientX; hoverLock.y = event.clientY;
        return false;
      }
      if (Math.hypot(event.clientX - hoverLock.x, event.clientY - hoverLock.y) <= 3) return false;
      hoverLock = null;
      return true;
    }
    function focusVillage(feature, pointer) {
      const mouseClick = pointer?.detail > 0;
      hoverLock = {key: featureKey(feature), x: mouseClick ? pointer.clientX : pointerPosition?.x ?? null,
        y: mouseClick ? pointer.clientY : pointerPosition?.y ?? null};
      const target = boxOf(feature.bounds, .65);
      const ratio = home.height / home.width;
      const width = Math.max(target.width, target.height / ratio, home.width / 40);
      const height = width * ratio;
      const center = islandLabels.has(feature.id) ? feature.labelAnchor
        : {x: (feature.bounds[0] + feature.bounds[2]) / 2, y: (feature.bounds[1] + feature.bounds[3]) / 2};
      setViewport({x: center.x - width / 2, y: center.y - height / 2, width, height});
      const targetNode = features.get(featureKey(feature)); targetNode?.focus({preventScroll: true}); inspect(feature);
      if (targetNode && islandLabels.has(feature.id)) keepFocusedFeatureVisible(feature, targetNode);
    }
    function choose(feature) {
      if (Date.now() < suppressClickUntil || destroyed) return;
      hoverLock = null;
      inspect(feature);
      if (districtMode) options.onDistrictSelect?.(feature);
      else if (councilMode) options.onCouncilSelect?.({...feature, countyId: councilGeometry.countyId, typeId: councilGeometry.typeId});
      else options.onVillageSelect?.(councilResult ? {...feature, councilZoneId: context.zoneId, countyId: councilGeometry.countyId, typeId: councilGeometry.typeId} : feature);
    }
    function missingVillages() {
      return family() === 'village' && context.districtName
        ? (geometry?.join?.missingElectionGeometry || []).filter(item => item.district === context.districtName) : [];
    }
    function appendListRecovery(parent, label = '前往村里清單查詢') {
      if (typeof options.onVillageListRequest !== 'function') return;
      const button = node('button', 'map-routing-recovery', label); button.type = 'button';
      button.addEventListener('click', () => options.onVillageListRequest()); parent.append(button);
    }
    function renderCoverageNotice() {
      const missing = missingVillages(); coverageNotice.replaceChildren(); coverageNotice.hidden = !missing.length;
      if (!missing.length) return;
      const names = missing.map(item => item.name).join('、');
      const selected = missing.find(item => item.zoneId === context.zoneId);
      coverageNotice.append(node('p', null, selected
        ? `本頁候選名單為${selected.name}；本站尚未將其圖形納入地圖。目前地圖顯示同區其他村里，不代表${selected.name}範圍。`
        : `本站地圖未顯示${names}的圖形，候選資料仍可從村里清單查詢；不以鄰近村里的圖形代替。`));
      appendListRecovery(coverageNotice, '查看完整村里清單');
    }
    function matchesQuery(text, query) {
      return typeof options.matchesSearch === 'function' ? options.matchesSearch(text, query)
        : text.replace(/台/g, '臺').includes(query.replace(/台/g, '臺'));
    }
    function renderSearch() {
      const query = search.value.trim();
      searchResults.replaceChildren(); searchResults.hidden = !query;
      if (!query) { searchStatus.textContent = ''; return; }
      const matches = visible.filter(item => {
        const text = `${featureLabel(item)} ${councilMode ? `${councilDisplayName(item)} ${item.coverage || ''}` : ''}`;
        return matchesQuery(text, query);
      });
      const missing = missingVillages().filter(item => matchesQuery(`${item.district}${item.name}`, query));
      searchStatus.textContent = `找到 ${matches.length} 個${councilMode ? '選區' : districtMode ? '行政區' : '村里'}`
        + (missing.length ? `；另有 ${missing.length} 個村里未顯示圖形，可從村里清單查詢。` : '');
      if (missing.length) {
        searchResults.append(node('p', null, `${missing.map(item => item.name).join('、')}未顯示在目前地圖，但有候選資料可從村里清單查詢。`));
        appendListRecovery(searchResults);
        if (!matches.length) return;
      }
      if (!matches.length) { searchResults.append(node('p', null, councilMode ? '沒有符合的選區，請試試選區名稱或行政區名稱。' : districtMode ? '沒有符合的行政區，請試試其他名稱。' : '沒有符合的村里，請試試鄉鎮市區名稱。')); return; }
      for (const feature of matches.slice(0, 8)) {
        const button = node('button'); button.type = 'button';
        button.setAttribute('aria-label', `在地圖上放大${featureLabel(feature)}`);
        if (!districtMode) button.append(node('span', null, councilMode ? feature.electorateLabel || KIND_LABELS[feature.kind] : feature.districtName));
        button.append(node('strong', null, feature.name), node('small', null, '放大定位 ↗'));
        button.addEventListener('click', event => { searchResults.hidden = true; focusVillage(feature, event); });
        if (family() === 'village' && !districtMode && feature.zoneId) {
          // Exact-name lookup need not rely on hitting a small irregular polygon.
          const row = node('div', 'village-map-search-row');
          const select = node('button', 'village-map-search-select'); select.type = 'button';
          select.setAttribute('aria-label', `查看${featureLabel(feature)}村里長候選人`);
          select.append(node('span', null, feature.districtName), node('strong', null, feature.name), node('small', null, '看候選人 →'));
          select.addEventListener('click', () => { searchResults.hidden = true; choose(feature); });
          button.classList.add('village-map-search-zoom'); button.replaceChildren(document.createTextNode('放大定位'));
          row.append(select, button); searchResults.append(row);
        } else searchResults.append(button);
      }
      if (matches.length > 8) searchResults.append(node('p', null, `共 ${matches.length} 個結果，請多輸入幾個字縮小範圍。`));
    }
    function renderSource() {
      const source = geometry.source || {};
      sourceText.replaceChildren();
      const link = node('a', null, source.name || source.title || '內政部國土測繪中心 · 村里界');
      const sourceUrl = source.datasetUrl || source.url;
      if (sourceUrl && /^https:\/\//.test(sourceUrl)) { link.href = sourceUrl; link.target = '_blank'; link.rel = 'noopener noreferrer'; }
      sourceText.append(link);
      if (source.geometryRevision || source.version) sourceText.append(document.createElement('br'), document.createTextNode(`圖資版本 ${source.geometryRevision || source.version}`));
      sourceText.append(document.createElement('br'), document.createTextNode('地圖為村里行政界；議員選區依選舉資料對照。'));
      const missing = missingVillages();
      if (missing.length) sourceText.append(document.createElement('br'), document.createTextNode(`本站本區地圖未納入${missing.map(item => item.name).join('、')}的圖形；候選資料仍可用村里清單查詢，地圖零結果不表示沒有候選資料。`));
      const license = node('a', null, '政府資料開放授權第 1 版'); license.href = 'https://data.gov.tw/license'; license.target = '_blank'; license.rel = 'noopener noreferrer';
      sourceText.append(document.createElement('br'), license);
      sourceText.append(document.createElement('br'), document.createTextNode('道路地名底圖：國土測繪中心臺灣通用電子地圖，需網路連線；行政界與底圖可能有不同更新時間。'));
      if (family() === 'council' && councilGeometry) {
        sourceText.append(document.createElement('br'), document.createTextNode('議員選區依中選會公告範圍合併村里界；缺少圖形來源的村里不推補。'));
        const urls = [...new Set(councilGeometry.zones.map(item => item.sourceUrl).filter(url => typeof url === 'string' && /^https:\/\//.test(url)))];
        for (const url of urls) {
          const link = node('a', null, '中選會議員選區公告'); link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer';
          sourceText.append(document.createElement('br'), link);
        }
      }
    }
    function islandCallouts(area = home, items = visible, font = home.width * .055) {
      const placements = new Map();
      if (!councilMode || !['澎湖縣', '連江縣'].includes(geometry.countyName)) return placements;
      // Keep the official geometry unchanged; labels sit in nearby open columns.
      const matzu = geometry.countyName === '連江縣';
      for (const side of ['left', 'right']) {
        const sideItems = items.filter(item => (item.labelAnchor.x < area.x + area.width * .55 ? 'left' : 'right') === side)
          .sort((a, b) => a.labelAnchor.y - b.labelAnchor.y);
        const x = area.x + area.width * (side === 'left' ? (matzu ? .28 : .18) : (matzu ? .74 : .82));
        const gap = Math.max(area.height * .11, font * 1.65);
        const inset = Math.max(gap / 2, font * .85), top = area.y + inset, bottom = area.y + area.height - inset;
        const rows = sideItems.map(item => ({item, y: Math.max(top, Math.min(bottom, item.labelAnchor.y - area.height * .08))}));
        for (let i = 1; i < rows.length; i++) rows[i].y = Math.max(rows[i].y, rows[i - 1].y + gap);
        if (rows.length && rows[rows.length - 1].y > bottom) {
          rows[rows.length - 1].y = bottom;
          for (let i = rows.length - 2; i >= 0; i--) rows[i].y = Math.min(rows[i].y, rows[i + 1].y - gap);
        }
        for (const row of rows) placements.set(row.item.id, {x, y: row.y});
      }
      return placements;
    }
    function visibleMapBounds() {
      if (!svg || !viewport) return viewport;
      const matrix = svg.getScreenCTM(), rect = svg.getBoundingClientRect();
      if (!matrix || !rect.width || !rect.height) return viewport;
      // xMidYMid meet can paint islands in the space beside the nominal viewBox.
      const inverse = matrix.inverse(), first = svg.createSVGPoint(), last = svg.createSVGPoint();
      first.x = rect.left; first.y = rect.top; last.x = rect.right; last.y = rect.bottom;
      const start = first.matrixTransform(inverse), end = last.matrixTransform(inverse);
      return {x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y)};
    }
    function visibleIslandAnchor(record, area) {
      const paths = [...(features.get(featureKey(record.feature))?.querySelectorAll('path') || [])];
      for (const candidate of record.anchors) {
        const point = candidate.point;
        if (point.x < area.x || point.x > area.x + area.width || point.y < area.y || point.y > area.y + area.height) continue;
        if (candidate.source === 'zone-label') return candidate;
        const probe = svg.createSVGPoint(); probe.x = point.x; probe.y = point.y;
        // Alternative source points must lie inside this exact drawn constituency.
        if (paths.some(path => typeof path.isPointInFill === 'function' && path.isPointInFill(probe))) return candidate;
      }
      return null;
    }
    function syncIslandLabels() {
      if (!councilMode || !svg || !viewport || !islandLabels.size) return;
      const area = visibleMapBounds(), font = Math.min(home.width * .055, viewport.width * .055 * 1.5);
      svg.setAttribute('data-callout-bounds', `${area.x} ${area.y} ${area.width} ${area.height}`);
      const anchors = new Map();
      for (const record of islandLabels.values()) {
        record.visibleAnchor = visibleIslandAnchor(record, area);
        if (record.visibleAnchor) anchors.set(record.feature.id, record.visibleAnchor);
      }
      const inView = visible.filter(feature => anchors.has(feature.id)).map(feature => ({...feature, labelAnchor: anchors.get(feature.id).point}));
      const placements = islandCallouts(area, inView, font);
      for (const {feature, group, text, line, anchor, badge} of islandLabels.values()) {
        const point = placements.get(feature.id), located = anchors.get(feature.id);
        group.style.display = point ? '' : 'none';
        if (!point) { group.removeAttribute('data-label-anchor-source'); group.removeAttribute('data-label-anchor-reference'); continue; }
        const sourcePoint = located.point;
        group.setAttribute('data-label-anchor-source', located.source);
        group.setAttribute('data-label-anchor-reference', located.reference);
        const halfWidth = font * Math.max(.8, (text.textContent.length + .6) / 2), halfHeight = font * .75;
        line.setAttribute('x1', sourcePoint.x); line.setAttribute('y1', sourcePoint.y);
        line.setAttribute('x2', point.x + (sourcePoint.x < point.x ? -halfWidth : halfWidth)); line.setAttribute('y2', point.y);
        anchor.setAttribute('cx', sourcePoint.x); anchor.setAttribute('cy', sourcePoint.y); anchor.setAttribute('r', font * .08);
        badge.setAttribute('x', point.x - halfWidth); badge.setAttribute('y', point.y - halfHeight);
        badge.setAttribute('width', halfWidth * 2); badge.setAttribute('height', halfHeight * 2); badge.setAttribute('rx', font * .22);
        text.setAttribute('x', point.x); text.setAttribute('y', point.y); text.setAttribute('font-size', font);
        text.style.fontSize = `${font}px`; text.style.strokeWidth = `${font * .16}px`;
      }
    }
    function renderGeometry() {
      clearBasemap();
      villageNames = null; islandLabels = new Map();
      districtMode = family() === 'village' && context.level === 'county';
      councilMode = family() === 'council' && context.level === 'county' && Boolean(councilGeometry);
      activeCouncilZone = family() === 'council' && context.level === 'result' ? councilGeometry?.zones.find(item => item.id === context.zoneId) || null : null;
      councilResult = Boolean(activeCouncilZone);
      fallbackResult = family() === 'council' && context.level === 'result' && !councilGeometry;
      const fallbackMembers = new Set((context.councilVillageIds || []).map(String));
      fallbackMemberView = fallbackResult && fallbackMembers.size > 0;
      const districtView = Boolean((context.level === 'district' || context.level === 'result') && (context.districtId || context.districtName) && family() === 'village');
      const councilMembers = new Set(activeCouncilZone?.villageIds || []);
      visible = councilMode ? councilGeometry.zones.filter(item => item.kind === councilKind && renderableShape(item)) : councilResult ? geometry.villages.filter(item => councilMembers.has(item.id)) : fallbackMemberView ? geometry.villages.filter(item => fallbackMembers.has(String(item.id)) || item.zoneId && fallbackMembers.has(String(item.zoneId))) : districtMode ? (geometry.districts || []).filter(renderableShape) : geometry.villages.filter(item => !districtView || districtMatch(item));
      features = new Map(); active = null; hoverLock = null;
      root.dataset.geometryMode = councilMode ? 'council' : districtMode ? 'district' : 'village';
      root.dataset.councilKind = family() === 'council' ? councilKind : '';
      root.dataset.councilFallback = String(family() === 'council' && !councilGeometry);
      renderCouncilControls();
      if (!visible.length || councilResult && !renderableShape(activeCouncilZone)) { showError(fallbackMemberView ? '目前選區的已確認村里沒有可顯示圖形，候選人名單保留；請回到上層或使用清單。' : councilMode || councilResult ? '這個議員選區尚無已核對的圖形來源，可從清單選擇並查看候選人；不推補缺漏範圍。' : districtMode ? '行政區地圖尚未載入，可從下方清單選擇鄉鎮市區。' : '這個行政區的村里地圖尚未對應，可從下方清單選擇。'); return; }
      home = councilResult ? boxOf(activeCouncilZone.bounds) : districtView || fallbackMemberView ? boxOf(boundsOf(visible)) : (() => { const [x,y,width,height] = geometry.viewBox.split(/\s+/).map(Number); return {x,y,width,height}; })();
      svg = svgNode('svg', {viewBox: geometry.viewBox, role: 'group', 'aria-labelledby': `${instanceId}-svg-title ${instanceId}-svg-description`, preserveAspectRatio: 'xMidYMid meet'});
      const mapUnit = councilMode ? '議員選區' : districtMode ? '行政區' : '村里';
      svg.append(svgNode('title', {id: `${instanceId}-svg-title`}, `${geometry.countyName}${councilResult ? activeCouncilZone.name : districtView ? visible[0].districtName : ''}${mapUnit}選擇地圖`));
      svg.append(svgNode('desc', {id: `${instanceId}-svg-description`}, councilMode ? '每個範圍是目前種類的一個議員選區。點選範圍直接查看該選區候選人。Tab 移至選區，Enter 或空白鍵選擇。地理位置不判定選民資格。' : districtMode ? '每個範圍是一個鄉鎮市區。點選範圍可進入村里地圖。Tab 移至行政區，Enter 或空白鍵選擇。可搜尋名稱放大定位，或用加減按鈕縮放、拖曳移動。' : '每個範圍是一個村里。點選範圍可查詢選舉資料。Tab 移至村里，Enter 或空白鍵選擇。可搜尋村里名稱放大定位，或用加減按鈕縮放、拖曳移動。'));
      const shapes = svgNode('g', {class: 'village-map-shapes'});
      for (const feature of visible) {
        const action = councilMode ? '查看該選區議員候選人' : districtMode ? '進入村里地圖' : councilResult ? `標示在${activeCouncilZone.name}內的位置` : fallbackResult ? '核對位置，候選人名單保留' : villageAction(feature);
        const group = svgNode('g', {class: `village-map-village${councilMode ? ' village-map-council-zone' : ''}`, role: 'button', tabindex: 0, [councilMode ? 'data-council-zone-id' : districtMode ? 'data-district-id' : 'data-village-id']: featureKey(feature), 'data-zone-id': feature.zoneId || '', 'aria-label': `${featureLabel(feature)}，${action}`, 'aria-pressed': String(selected(feature))});
        group.classList.toggle('is-selected', selected(feature));
        group.append(svgNode('path', {d: feature.path, 'fill-rule': geometry.fillRule || 'evenodd', 'vector-effect': 'non-scaling-stroke'}));
        group.append(svgNode('title', {}, councilMode ? `${geometry.countyName} · ${councilDisplayName(feature)}；範圍：${feature.coverage || '本次未取得'}` : featureLabel(feature)));
        group.addEventListener('click', () => choose(feature));
        group.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(feature); } });
        group.addEventListener('pointerenter', event => { if (!pointerDrag && allowPointerInspection(event)) inspect(feature); });
        group.addEventListener('pointerleave', () => { if (!pointerDrag && !hoverLock && document.activeElement !== group) inspect(null); });
        group.addEventListener('focus', () => {
          // Preserve keyboard feedback when pan/scroll changes the polygon
          // under a stationary pointer. Actual pointer movement releases it.
          if (hoverLock?.key !== featureKey(feature)) {
            hoverLock = {key: featureKey(feature), x: pointerPosition?.x ?? null, y: pointerPosition?.y ?? null};
          }
          const anchor = inspectionAnchor(feature);
          const pointerFocus = islandLabels.has(feature.id) && lastInputWasPointer;
          const focusBounds = islandLabels.has(feature.id) ? visibleMapBounds() : viewport;
          if (!pointerFocus && focusBounds && (anchor.x < focusBounds.x || anchor.x > focusBounds.x + focusBounds.width || anchor.y < focusBounds.y || anchor.y > focusBounds.y + focusBounds.height)) {
            setViewport({...viewport, x: anchor.x - viewport.width / 2, y: anchor.y - viewport.height / 2});
          }
          inspect(feature);
          if (!pointerFocus) keepFocusedFeatureVisible(feature, group);
        });
        group.addEventListener('blur', () => {
          if (hoverLock?.key === featureKey(feature)) hoverLock = null;
          if (active && featureKey(active) === featureKey(feature)) inspect(null);
        });
        shapes.append(group); features.set(featureKey(feature), group);
      }
      svg.append(shapes);
      const outlines = svgNode('g', {class: 'village-map-district-outlines', 'aria-hidden': 'true'});
      const names = svgNode('g', {class: 'village-map-district-labels', 'aria-hidden': 'true'});
      for (const district of !councilMode && !councilResult && !fallbackMemberView ? geometry.districts || [] : []) {
        if (districtView && !visible.some(item => item.districtName === district.name)) continue;
        if (district.path) outlines.append(svgNode('path', {d: district.path, 'fill-rule': 'evenodd', 'vector-effect': 'non-scaling-stroke'}));
        if (district.anchor && !districtView) names.append(svgNode('text', {x: district.anchor.x, y: district.anchor.y}, district.name));
      }
      svg.append(outlines, names);
      if (councilResult) {
        const outline = svgNode('g', {class: 'village-map-council-outline', 'aria-hidden': 'true', 'pointer-events': 'none'});
        outline.append(svgNode('path', {d: activeCouncilZone.path, 'fill-rule': councilGeometry.fillRule || 'evenodd', 'vector-effect': 'non-scaling-stroke'})); svg.append(outline);
      }
      namesButton.hidden = !(districtView || councilMode || councilResult || fallbackMemberView);
      villageNames = svgNode('g', {class: 'village-map-name-labels', 'aria-hidden': 'true'});
      const callouts = islandCallouts();
      if (districtView || councilMode || councilResult || fallbackMemberView) for (const feature of visible) {
        const group = svgNode('g', {[councilMode ? 'data-label-council-zone-id' : 'data-label-village-id']: feature.id});
        const callout = callouts.get(feature.id);
        const point = callout || feature.labelAnchor;
        const box = feature.labelBox;
        // Fixed SVG units: text and village boundaries share the same viewBox.
        // The label box comes from a verified rectangle inside this village.
        const labelText = councilMode ? councilNumberLabel(feature) : feature.name;
        // Refit short numbers inside the same verified inscribed circle.
        const radius = councilMode ? feature.labelPlacement?.safeRadius : null;
        const fit = Number.isFinite(radius) && radius > 0 ? radius * 2 / Math.hypot(labelText.length + .5, 1.6)
          : Math.min(box.width / (labelText.length + .5), box.height / 1.6);
        const font = callout ? home.width * .055 : Math.min(fit, home.width * .035);
        const text = svgNode('text', {x:point.x, y:point.y, 'font-size':font}, labelText);
        text.style.fontSize = `${font}px`; text.style.strokeWidth = `${font*.16}px`;
        if (callout) {
          group.classList.add('village-map-council-callout');
          const halfWidth = font * Math.max(.8, (labelText.length + .6) / 2), halfHeight = font * .75;
          const edgeX = point.x + (feature.labelAnchor.x < point.x ? -halfWidth : halfWidth);
          const line = svgNode('line', {x1: feature.labelAnchor.x, y1: feature.labelAnchor.y, x2: edgeX, y2: point.y, class: 'village-map-callout-line', 'vector-effect': 'non-scaling-stroke'});
          const anchor = svgNode('circle', {cx: feature.labelAnchor.x, cy: feature.labelAnchor.y, r: font * .08, class: 'village-map-callout-anchor'});
          const badge = svgNode('rect', {x: point.x - halfWidth, y: point.y - halfHeight, width: halfWidth * 2, height: halfHeight * 2, rx: font * .22, class: 'village-map-callout-badge', 'vector-effect': 'non-scaling-stroke'});
          group.append(line, anchor, badge);
          const memberIds = new Set((feature.villageIds || []).map(String));
          const anchors = [
            {point: feature.labelAnchor, source: 'zone-label', reference: feature.id},
            {point: feature.anchor, source: 'zone-reference', reference: feature.id},
            ...(geometry.villages || []).filter(village => memberIds.has(String(village.id)))
              .map(village => ({point: village.labelAnchor, source: 'member-village-label', reference: village.id}))
          ].filter(candidate => candidate.point && Number.isFinite(candidate.point.x) && Number.isFinite(candidate.point.y));
          islandLabels.set(feature.id, {feature, group, text, line, anchor, badge, anchors, visibleAnchor: null});
        }
        group.append(text); villageNames.append(group);
        group.addEventListener('click', () => choose(feature));
        group.addEventListener('pointerenter', event => { if (!pointerDrag && allowPointerInspection(event)) inspect(feature); });
        group.addEventListener('pointerleave', () => { if (!pointerDrag && !hoverLock) inspect(null); });
      }
      svg.append(villageNames);
      canvas.replaceChildren(svg); canvas.setAttribute('aria-busy', 'false');
      if (window.TaiwanVillageBasemap) {
        basemap = window.TaiwanVillageBasemap.create(svg, {geometry: councilMode || councilResult ? councilGeometry : geometry, onStatus: basemapStatus});
      } else {
        basemapStatus({state: showBasemap ? 'unavailable' : 'off'});
      }
      toolbar.hidden = false; search.disabled = false;
      count.textContent = `${visible.length.toLocaleString('zh-TW')} 個${councilMode ? '選區' : districtMode ? '行政區' : '村里'}`;
      if (missingVillages().length) count.textContent = `地圖顯示 ${visible.length.toLocaleString('zh-TW')} 個村里`;
      renderCoverageNotice();
      title.textContent = councilMode ? `${geometry.countyName} · ${KIND_LABELS[councilKind]}選區地圖` : councilResult ? `${geometry.countyName} · ${activeCouncilZone.name}村里地圖` : fallbackResult ? `${geometry.countyName} · ${fallbackMemberView ? '已確認村里位置' : '村里概略圖'}` : `${geometry.countyName}${districtView ? ` · ${visible[0].districtName}` : ''}${districtMode ? '行政區地圖' : '村里地圖'}`;
      description.textContent = councilMode ? '點選選區範圍，直接查看該選區候選人。' : councilResult ? `${activeCouncilZone.coverage || activeCouncilZone.name}；點村里可標示其位置。` : fallbackResult ? fallbackMemberView ? '選區合併圖形未載入；只呈現已確認能對應本選區的村里位置，候選人名單保留。' : '全縣市概略地圖，不能由此推定目前選區範圍；候選人名單保留。' : districtMode ? '直接點選鄉鎮市區，進入該區的完整村里地圖。' : `直接點選村里範圍，${family() === 'council' ? '進入所屬區域議員選區' : '查看村里長候選人'}。`;
      label.textContent = councilMode ? '找選區' : districtMode ? '找行政區' : '找村里';
      search.placeholder = councilMode ? '輸入選區或行政區名稱' : districtMode ? '輸入鄉鎮市區名稱' : '輸入村里或鄉鎮市區名稱';
      borderKey.lastChild.textContent = councilMode ? '議員選區界' : districtMode ? '行政區界' : '村里界';
      zoomIn.setAttribute('aria-label', `放大${mapUnit}地圖`); zoomOut.setAttribute('aria-label', `縮小${mapUnit}地圖`);
      baseButton.textContent = `底圖＋${councilMode ? '選區' : districtMode ? '行政區' : '里界'}`;
      boundaryButton.textContent = `只看${councilMode ? '選區' : districtMode ? '行政區' : '里界'}`;
      setViewport(home); defaultInspection(); renderSource(); renderSearch();
      syncBasemapMode();
      syncNames();
      svg.addEventListener('pointerdown', event => {
        if (event.button !== 0 || pointerDrag || !svg.getScreenCTM()) return;
        hoverLock = null;
        const point = svg.createSVGPoint(); point.x = event.clientX; point.y = event.clientY;
        const matrix = svg.getScreenCTM().inverse();
        pointerDrag = {id: event.pointerId, clientX: event.clientX, clientY: event.clientY, point: point.matrixTransform(matrix), matrix, start: {...viewport}, moved: false};
      });
      svg.addEventListener('pointermove', event => {
        if (!pointerDrag) {
          if ((hoverLock || islandLabels.size) && allowPointerInspection(event)) {
            const target = event.target.closest?.('.village-map-village,[data-label-village-id],[data-label-council-zone-id]');
            const key = target?.getAttribute('data-council-zone-id') || target?.getAttribute('data-village-id') || target?.getAttribute('data-district-id') || target?.getAttribute('data-label-village-id') || target?.getAttribute('data-label-council-zone-id');
            inspect(visible.find(feature => String(featureKey(feature)) === key) || null);
          }
          return;
        }
        if (!pointerDrag || pointerDrag.id !== event.pointerId) return;
        if (!pointerDrag.moved && Math.hypot(event.clientX - pointerDrag.clientX, event.clientY - pointerDrag.clientY) < 5) return;
        if (!pointerDrag.moved) { pointerDrag.moved = true; svg.setPointerCapture?.(event.pointerId); root.classList.add('is-dragging'); inspect(null); }
        const point = svg.createSVGPoint(); point.x = event.clientX; point.y = event.clientY;
        const now = point.matrixTransform(pointerDrag.matrix);
        setViewport({...pointerDrag.start, x: pointerDrag.start.x + pointerDrag.point.x - now.x, y: pointerDrag.start.y + pointerDrag.point.y - now.y});
      });
      const endPointer = event => {
        if (!pointerDrag || pointerDrag.id !== event.pointerId) return;
        if (pointerDrag.moved) suppressClickUntil = Date.now() + 350;
        if (svg.hasPointerCapture?.(event.pointerId)) svg.releasePointerCapture(event.pointerId);
        pointerDrag = null; root.classList.remove('is-dragging');
      };
      svg.addEventListener('pointerup', endPointer); svg.addEventListener('pointercancel', endPointer);
      svg.addEventListener('lostpointercapture', endPointer);
      svg.addEventListener('pointerleave', () => { if (pointerDrag && !pointerDrag.moved) pointerDrag = null; });
    }
    function showError(message = '村里地圖暫時無法載入，仍可從下方分區清單繼續查詢。') {
      clearBasemap(); coverageNotice.hidden = true;
      baseInfo.hidden = true; layerControls.hidden = true;
      councilControls.hidden = true;
      svg = null; active = null; tooltip.hidden = true; toolbar.hidden = true; search.disabled = true;
      canvas.setAttribute('aria-busy', 'false');
      const notice = node('p', 'village-map-message', message);
      const retry = node('button', 'village-map-retry', '重新載入村里地圖'); retry.type = 'button';
      retry.addEventListener('click', () => { geometry = null; viewKey = ''; update(context); });
      notice.append(node('br'), retry); canvas.replaceChildren(notice);
      inspection.textContent = '可繼續使用分區清單。'; count.textContent = '圖資未載入';
    }
    async function update(next) {
      context = {...next}; const request = ++sequence;
      const enabled = Boolean(context.enabled !== false && countyId() && TYPES.has(context.typeId) && ['county', 'district', 'result'].includes(context.level));
      root.hidden = !enabled;
      if (!enabled || destroyed) { basemap?.setEnabled(false); return; }
      baseInfo.hidden = false; layerControls.hidden = false;
      root.dataset.countyId = countyId(); root.dataset.level = context.level;
      if (family() === 'council') resolveCouncilKind();
      const key = contextKey();
      if (geometry && String(geometry.countyId) === String(countyId()) && key === viewKey && svg) {
        for (const feature of visible) { const item = features.get(featureKey(feature)); item.classList.toggle('is-selected', selected(feature)); item.setAttribute('aria-pressed', String(selected(feature))); }
        syncBasemapMode();
        syncNames(); positionTooltip();
        renderCouncilControls();
        renderCoverageNotice(); defaultInspection(); return;
      }
      if (key !== viewKey) { search.value = ''; searchResults.hidden = true; pointerDrag = null; hoverLock = null; root.classList.remove('is-dragging'); }
      viewKey = key;
      clearBasemap();
      councilControls.hidden = true; councilRetry.hidden = true;
      title.textContent = `${context.county?.name || ''}${family() === 'council' ? '議員選區' : '村里'}地圖`;
      description.textContent = '正在載入區域邊界…'; count.textContent = '載入中';
      coverageNotice.hidden = true;
      canvas.setAttribute('aria-busy', 'true'); canvas.replaceChildren(node('p', 'village-map-message', `正在載入${family() === 'council' ? '議員選區' : '村里'}地圖…`));
      svg = null; tooltip.hidden = true; toolbar.hidden = true; search.disabled = true;
      try {
        const id = countyId(); const url = options.geometryUrl?.(id) || `./assets/maps/${id}-villages.json?v=mercator-labels-1`;
        const loads = await Promise.allSettled([load(id, url), ...(family() === 'council' ? [load(id, councilUrl(id), validateCouncil)] : [])]);
        if (request !== sequence || destroyed || root.hidden) return;
        if (loads[0].status !== 'fulfilled') throw loads[0].reason;
        geometry = loads[0].value;
        const councilLoad = loads[1];
        const candidate = councilLoad?.status === 'fulfilled' ? councilLoad.value : null;
        councilGeometry = candidate && sameProjection(geometry, candidate) && (['council'].includes(context.typeId) || candidate.typeId === context.typeId) ? candidate : null;
        councilLoadError = family() === 'council' && !councilGeometry;
        if (family() === 'council') resolveCouncilKind();
        viewKey = contextKey(); renderGeometry();
      } catch {
        if (request !== sequence || destroyed || root.hidden) return;
        geometry = null; showError();
      }
    }
    listen(zoomIn, 'click', () => zoom(1.7)); listen(zoomOut, 'click', () => zoom(1 / 1.7));
    listen(reset, 'click', () => { hoverLock = null; if (home) setViewport(home); inspect(null); });
    listen(search, 'input', renderSearch);
    listen(search, 'keydown', event => { if (event.key === 'Escape') { search.value = ''; renderSearch(); } });
    listen(window, 'resize', () => { syncIslandLabels(); positionTooltip(); });
    listen(window, 'scroll', positionTooltip, {passive: true});
    listen(window, 'pointermove', event => { pointerPosition = {x: event.clientX, y: event.clientY}; }, true);
    listen(window, 'pointerdown', () => { lastInputWasPointer = true; }, true);
    listen(window, 'keydown', () => { lastInputWasPointer = false; }, true);
    if (window.ResizeObserver) {
      labelResizeObserver = new ResizeObserver(() => { syncIslandLabels(); positionTooltip(); });
      labelResizeObserver.observe(frame);
    }
    listen(baseButton, 'click', () => { showBasemap = true; syncBasemapMode(); });
    listen(boundaryButton, 'click', () => { showBasemap = false; syncBasemapMode(); });
    listen(baseRetry, 'click', () => basemap?.retry());
    listen(councilRetry, 'click', () => { cache.delete(councilUrl(countyId())); councilGeometry = null; viewKey = ''; update(context); });
    listen(namesButton, 'click', () => {
      if (councilMode) showCouncilNames = !showCouncilNames;
      else showNames = !showNames;
      syncNames();
    });
    syncBasemapMode();
    return {update, destroy() { destroyed = true; sequence++; labelResizeObserver?.disconnect(); clearBasemap(); listeners.forEach(remove => remove()); root.replaceChildren(); root.classList.remove('is-dragging'); root.hidden = true; }};
  }
  return {create, councilDisplayName};
})();
