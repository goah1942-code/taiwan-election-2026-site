/* County boundaries select the county before choosing an election constituency. */
window.TaiwanCountyMap = (() => {
  const NS = 'http://www.w3.org/2000/svg';
  const FAMILIES = {
    mayor: new Set(['mayor', 'metro_mayor', 'county_mayor']),
    council: new Set(['council', 'metro_council', 'county_council']),
    village: new Set(['village', 'village_head']),
  };
  const FAMILY_LABELS = {mayor: '縣市長選舉', council: '議員選區', village: '村里長選區'};
  function familyOf(typeId) {
    return Object.keys(FAMILIES).find(family => FAMILIES[family].has(typeId));
  }
  function svgNode(tag, attributes = {}, text) {
    const node = document.createElementNS(NS, tag);
    for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value));
    if (text != null) node.textContent = text;
    return node;
  }
  function create(root, counties, onSelect) {
    const canvas = root.querySelector('.county-map-canvas');
    const picker = root.querySelector('.county-map-select');
    const result = root.querySelector('.county-map-result');
    const figure = root.querySelector('.county-map-figure');
    const legend = root.querySelector('.county-map-legend');
    const caption = document.createElement('p');
    caption.className = 'county-map-county-caption'; caption.hidden = true;
    figure?.insertBefore(caption, legend || null);
    const countyIndex = new Map(counties.map(county => [county.id, county]));
    let context = {}, geometry = null, pending = null, failed = false;
    const mapNodes = new Map();

    function isCountyView() {
      const family = familyOf(context.typeId);
      return Boolean(context.county && (family === 'council' || family === 'village') && context.level && context.level !== 'taiwan');
    }
    function isTaiwanSelection() {
      return context.level === 'taiwan';
    }

    function syncElectionLabels() {
      const family = familyOf(context.typeId);
      const label = FAMILY_LABELS[family] || '選舉選區';
      const countyView = isCountyView();
      for (const [id, node] of mapNodes) {
        if (countyView) node.removeAttribute('aria-label');
        else node.setAttribute('aria-label', `${countyIndex.get(id).name}，查看${label}`);
      }
      const description = canvas.querySelector('#county-map-svg-description');
      if (description) description.textContent = countyView
        ? `${context.county.name}輪廓。${family === 'council' ? '從分區清單選擇議員選區。' : '從分區清單選擇行政區及村里。'}使用回到台灣選擇縣市按鈕重新選擇縣市。`
        : `點選地圖上的縣市或名稱，查看${label}${family === 'mayor' ? '。' : family === 'council' ? '，再選擇議員選區。' : '，再選擇鄉鎮市區及村里。'}離島在獨立框內放大。Tab 移至縣市，Enter 或空白鍵選擇；也可展開上方的使用縣市名稱選擇。`;
    }
    function syncSelection() {
      for (const [id, node] of mapNodes) {
        const selected = !isTaiwanSelection() && context.county?.id === id;
        node.classList.toggle('is-selected', selected);
        if (isCountyView()) node.removeAttribute('aria-pressed');
        else node.setAttribute('aria-pressed', String(selected));
      }
    }
    function syncViewport() {
      const svg = canvas.querySelector('svg');
      const countyView = isCountyView();
      root.classList.toggle('is-county-view', countyView);
      root.dataset.mapView = countyView ? 'county' : 'taiwan';
      caption.hidden = !countyView;
      caption.textContent = countyView ? `${context.county.name} · 縣市輪廓` : '';
      if (legend) legend.hidden = countyView;
      if (!svg || !geometry) return;
      const shape = countyView ? geometry.counties.find(item => item.id === context.county.id) : null;
      if (shape) {
        const [x1, y1, x2, y2] = shape.bounds;
        const width = x2 - x1, height = y2 - y1;
        // Retain every island in the county's aggregated path bounds.
        const padding = Math.max(width, height) * .12;
        const paddedWidth = width + padding * 2, paddedHeight = height + padding * 2;
        svg.setAttribute('viewBox', `${x1 - padding} ${y1 - padding} ${paddedWidth} ${paddedHeight}`);
      } else svg.setAttribute('viewBox', geometry.viewBox);
      svg.setAttribute('role', countyView ? 'img' : 'group');
      svg.querySelector('#county-map-svg-title').textContent = countyView ? `${context.county.name}輪廓` : '台灣 22 縣市選擇地圖';
      for (const [id, node] of mapNodes) {
        node.style.display = countyView && id !== context.county.id ? 'none' : '';
        node.setAttribute('tabindex', !countyView && countyIndex.get(id).available ? '0' : '-1');
        node.setAttribute('role', countyView ? 'presentation' : 'button');
        if (countyView) node.removeAttribute('aria-disabled');
        else node.setAttribute('aria-disabled', String(!countyIndex.get(id).available));
        node._mapLabel.style.display = countyView ? 'none' : '';
      }
      for (const decoration of svg.querySelectorAll('.county-map-region-frame,.county-map-region-title,.county-map-island-note')) decoration.style.display = countyView ? 'none' : '';
    }
    function renderGeometry() {
      const svg = svgNode('svg', {viewBox: geometry.viewBox, role: 'group', 'aria-labelledby': 'county-map-svg-title county-map-svg-description'});
      svg.append(svgNode('title', {id: 'county-map-svg-title'}, '台灣 22 縣市選擇地圖'));
      svg.append(svgNode('desc', {id: 'county-map-svg-description'}));
      for (const region of geometry.regions || []) {
        if (!region.frame || !region.isInset) continue;
        const {x, y, width, height} = region.frame;
        svg.append(svgNode('rect', {x, y, width, height, rx: 12, class: 'county-map-region-frame', 'aria-hidden': 'true'}));
        svg.append(svgNode('text', {x: x + 12, y: y + 21, class: 'county-map-region-title', 'aria-hidden': 'true'}, region.title || region.name));
        const wuqiu = region.transforms?.find(transform => transform.id === 'wuqiu');
        if (wuqiu?.frame) svg.append(svgNode('text', {x: wuqiu.frame.x + wuqiu.frame.width / 2, y: wuqiu.frame.y - 4, 'text-anchor': 'middle', class: 'county-map-island-note', 'aria-hidden': 'true'}, '烏坵'));
      }
      // Shapes are drawn before labels, so every small-city label remains clickable.
      const shapes = svgNode('g');
      const labels = svgNode('g', {'aria-hidden': 'true'});
      for (const shape of geometry.counties) {
        const county = countyIndex.get(shape.id);
        if (!county) continue;
        const group = svgNode('g', {class: 'county-map-country', 'data-county-id': county.id, role: 'button', tabindex: county.available ? 0 : -1,
          'aria-label': `${county.name}，查看${FAMILY_LABELS[familyOf(context.typeId)] || '選舉選區'}`, 'aria-pressed': 'false', 'aria-disabled': String(!county.available)});
        group.append(svgNode('path', {d: shape.path, class: `county-map-shape${shape.region !== 'mainland' ? ' is-inset' : ''}`, 'fill-rule': 'evenodd'}));
        const choose = () => { if (county.available && !isCountyView()) onSelect(county.id); };
        group.addEventListener('click', choose);
        group.addEventListener('keydown', event => {
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(); }
        });
        shapes.append(group);
        mapNodes.set(county.id, group);
        const {x, y} = shape.label;
        const labelGroup = svgNode('g', {class: 'county-map-label-group', 'data-map-label': county.id});
        if (shape.anchor && Math.hypot(x - shape.anchor.x, y - shape.anchor.y) > 24) {
          labelGroup.append(svgNode('line', {x1: x, y1: y, x2: shape.anchor.x, y2: shape.anchor.y, class: 'county-map-leader'}));
          labelGroup.append(svgNode('circle', {cx: shape.anchor.x, cy: shape.anchor.y, r: 2, class: 'county-map-anchor'}));
        }
        labelGroup.append(svgNode('rect', {x: x - 31, y: y - 13, width: 62, height: 26, class: 'county-map-label-box'}));
        labelGroup.append(svgNode('text', {x, y, class: 'county-map-label'}, county.name));
        labelGroup.addEventListener('click', choose);
        group.addEventListener('focus', () => labelGroup.classList.add('is-focused'));
        group.addEventListener('blur', () => labelGroup.classList.remove('is-focused'));
        for (const target of [group, labelGroup]) {
          target.addEventListener('pointerenter', () => { group.classList.add('is-hovered'); labelGroup.classList.add('is-hovered'); });
          target.addEventListener('pointerleave', () => { group.classList.remove('is-hovered'); labelGroup.classList.remove('is-hovered'); });
        }
        // Visual labels and focus styling share the same selected state as paths.
        group._mapLabel = labelGroup;
        labels.append(labelGroup);
      }
      svg.append(shapes, labels);
      canvas.replaceChildren(svg);
      canvas.setAttribute('aria-busy', 'false');
      syncViewport(); syncElectionLabels(); syncSelection();
    }
    function refreshLabels() {
      for (const [id, node] of mapNodes) {
        node._mapLabel.classList.toggle('is-selected', !isTaiwanSelection() && context.county?.id === id);
      }
    }
    async function loadGeometry() {
      if (geometry || pending || failed) return;
      canvas.setAttribute('aria-busy', 'true');
      pending = fetch('./assets/taiwan-counties.json', {cache: 'no-store'}).then(response => {
        if (!response.ok) throw new Error('地圖資料無法讀取');
        return response.json();
      });
      try {
        geometry = await pending;
        const ids = geometry.counties?.map(county => county.id) || [];
        if (ids.length !== counties.length || new Set(ids).size !== ids.length || ids.some(id => !countyIndex.has(id))) throw new Error('縣市地圖資料不完整');
        const box = typeof geometry.viewBox === 'string' ? geometry.viewBox.split(/\s+/).map(Number) : [];
        if (box.length !== 4 || box.some(value => !Number.isFinite(value)) || box[2] <= 0 || box[3] <= 0 || geometry.counties.some(shape =>
          typeof shape.path !== 'string' || !shape.path || !Number.isFinite(shape.label?.x) || !Number.isFinite(shape.label?.y) ||
          !Array.isArray(shape.bounds) || shape.bounds.length !== 4 || shape.bounds.some(value => !Number.isFinite(value)) || shape.bounds[2] <= shape.bounds[0] || shape.bounds[3] <= shape.bounds[1] ||
          (shape.anchor && (!Number.isFinite(shape.anchor.x) || !Number.isFinite(shape.anchor.y))))) throw new Error('縣市地圖格式不完整');
        renderGeometry();
        refreshLabels();
      } catch {
        mapNodes.clear();
        geometry = null; failed = true;
        const message = document.createElement('p');
        message.className = 'county-map-loading';
        message.textContent = '地圖暫時無法載入，可展開上方「使用縣市名稱選擇」繼續查詢。';
        const retry = document.createElement('button');
        retry.type = 'button'; retry.className = 'county-map-retry'; retry.textContent = '重新載入地圖';
        retry.addEventListener('click', () => { failed = false; loadGeometry(); });
        message.append(document.createElement('br'), retry);
        canvas.replaceChildren(message);
        canvas.setAttribute('aria-busy', 'false');
      } finally { pending = null; }
    }
    function update(next) {
      context = next;
      const family = familyOf(next.typeId);
      root.hidden = !family;
      const jump = document.getElementById('county-map-jump');
      if (jump) jump.hidden = root.hidden;
      if (root.hidden) return;
      const county = next.county;
      const taiwanSelection = isTaiwanSelection();
      root.querySelector('.county-map-name').textContent = taiwanSelection ? '台灣' : county?.name || '選擇縣市';
      if (picker) picker.value = county?.id || '';
      const kind = root.querySelector('.county-map-kind');
      if (taiwanSelection) kind.textContent = `點選縣市，${family === 'mayor' ? '查看縣市長候選人' : family === 'council' ? '進入議員選區' : '進入行政區與村里'}`;
      else if (family === 'mayor') kind.textContent = county?.navigationGroup === '直轄市' ? '直轄市長 · 全市一個選區' : '縣市長 · 全縣市一個選區';
      else if (next.type && !next.loading) kind.textContent = family === 'council' ? `議員 · ${next.type.zoneCount.toLocaleString('zh-TW')} 個選區` : `村里長 · ${next.type.zoneCount.toLocaleString('zh-TW')} 個村里`;
      else kind.textContent = family === 'council' ? '議員 · 選擇縣市後選擇選區' : '村里長 · 選擇縣市後選擇村里';
      const stats = root.querySelector('.county-map-stats');
      stats.replaceChildren();
      const ready = !taiwanSelection && (family === 'mayor' ? Boolean(next.zone) : Boolean(next.type)) && !next.loading && !next.error;
      stats.classList.toggle('is-message', !ready);
      if (ready) {
        const values = family === 'mayor'
          ? [['應選名額', next.zone.seats ?? '待確認', '席'], ['2026 登記', next.zone.candidateCount, '人']]
          : [[family === 'council' ? '全縣市選區' : '全縣市村里', next.type.zoneCount, '個'], ['全縣市登記', next.type.candidateCount, '人']];
        for (const [label, value, unit] of values) {
          const stat = document.createElement('div'); stat.className = 'county-map-stat';
          const caption = document.createElement('span'); caption.textContent = label;
          const number = document.createElement('strong'); number.textContent = String(value);
          const suffix = document.createElement('small'); suffix.textContent = unit;
          number.append(suffix); stat.append(caption, number); stats.append(stat);
        }
      } else stats.textContent = taiwanSelection ? '全台 22 縣市 · 點地圖開始' : next.error || '正在載入選區資料…';
      if (result) {
        const disabled = next.loading || Boolean(next.error) || !next.zone || !county?.available;
        result.setAttribute('aria-disabled', String(disabled));
        result.tabIndex = disabled ? -1 : 0;
        result.setAttribute('aria-label', `查看${county?.name || ''}候選人名單`);
      }
      root.querySelector('.county-map-status').textContent = taiwanSelection ? '台灣地圖，請選擇縣市' : next.error || (next.loading ? `正在載入${county?.name || ''}${FAMILY_LABELS[family]}` : `已選取${county?.name || ''}${FAMILY_LABELS[family]}${family === 'mayor' || next.level === 'result' ? '，候選人資料已更新' : '，請從分區清單選擇區域'}`);
      syncViewport(); syncElectionLabels(); syncSelection(); refreshLabels(); loadGeometry();
    }
    if (picker) {
      for (const county of counties) {
        const option = document.createElement('option'); option.value = county.id; option.textContent = county.name; option.disabled = !county.available;
        picker.append(option);
      }
      picker.addEventListener('change', event => onSelect(event.target.value));
    }
    result?.addEventListener('click', event => {
      if (event.currentTarget.getAttribute('aria-disabled') === 'true') event.preventDefault();
    });
    return {update};
  }
  return {create};
})();
