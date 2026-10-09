/* Official NLSC EMAP tiles, aligned with the local SVG's Web Mercator transform. */
window.TaiwanVillageBasemap = (() => {
  const NS = 'http://www.w3.org/2000/svg';
  const WORLD = 40075016.68557849;
  const TILE_SIZE = 256;
  const MAX_ZOOM = 19;
  let instanceNumber = 0;
  function svgNode(tag, attrs = {}) {
    const element = document.createElementNS(NS, tag);
    for (const [name, value] of Object.entries(attrs)) element.setAttribute(name, String(value));
    return element;
  }
  function finiteBox(box) {
    return box && ['x', 'y', 'width', 'height'].every(key => Number.isFinite(box[key])) && box.width > 0 && box.height > 0;
  }
  function intersect(left, right) {
    const x = Math.max(left.x, right.x), y = Math.max(left.y, right.y);
    const endX = Math.min(left.x + left.width, right.x + right.width);
    const endY = Math.min(left.y + left.height, right.y + right.height);
    return endX > x && endY > y ? {x, y, width: endX - x, height: endY - y} : null;
  }
  function affinePoint(matrix, x, y) {
    return {x: matrix.a * x + matrix.c * y + matrix.e, y: matrix.b * x + matrix.d * y + matrix.f};
  }
  function viewportFromSvg(svg) {
    const values = (svg.getAttribute('viewBox') || '').trim().split(/\s+/).map(Number);
    return values.length === 4 ? {x: values[0], y: values[1], width: values[2], height: values[3]} : null;
  }
  function screenCoverage(svg) {
    const rect = svg.getBoundingClientRect();
    const matrix = svg.getScreenCTM();
    if (!matrix || !rect.width || !rect.height) return null;
    let inverse;
    try { inverse = matrix.inverse(); } catch { return null; }
    const points = [
      affinePoint(inverse, rect.left, rect.top), affinePoint(inverse, rect.right, rect.top),
      affinePoint(inverse, rect.left, rect.bottom), affinePoint(inverse, rect.right, rect.bottom),
    ];
    const x = Math.min(...points.map(point => point.x)), y = Math.min(...points.map(point => point.y));
    const width = Math.max(...points.map(point => point.x)) - x, height = Math.max(...points.map(point => point.y)) - y;
    // EMAP contains ordinary 256px raster labels. Use CSS pixels, without a DPR
    // multiplier, so a Retina display does not halve the road-label text size.
    const cssPixelsPerUnit = Math.max(Math.hypot(matrix.a, matrix.b), Math.hypot(matrix.c, matrix.d));
    const box = {x, y, width, height};
    return finiteBox(box) && Number.isFinite(cssPixelsPerUnit) && cssPixelsPerUnit > 0 ? {box, cssPixelsPerUnit} : null;
  }
  function validTransform(transform) {
    return transform?.crs === 'EPSG:3857' && Number.isFinite(transform.scale) && transform.scale > 0 &&
      Array.isArray(transform.translate) && transform.translate.length === 2 && transform.translate.every(Number.isFinite);
  }
  function tileRange(box, transform, zoom) {
    const count = 2 ** zoom;
    const scale = transform.scale, [tx, ty] = transform.translate;
    const world = transform.worldWidthMeters || WORLD;
    const left = (box.x - tx) / scale, right = (box.x + box.width - tx) / scale;
    const north = (ty - box.y) / scale, south = (ty - box.y - box.height) / scale;
    const x1 = Math.max(0, Math.floor((left + world / 2) / world * count + 1e-10));
    const x2 = Math.min(count - 1, Math.ceil((right + world / 2) / world * count - 1e-10) - 1);
    const y1 = Math.max(0, Math.floor((world / 2 - north) / world * count + 1e-10));
    const y2 = Math.min(count - 1, Math.ceil((world / 2 - south) / world * count - 1e-10) - 1);
    return {x1, x2, y1, y2, total: Math.max(0, x2 - x1 + 1) * Math.max(0, y2 - y1 + 1)};
  }
  function create(svg, options = {}) {
    const id = `village-basemap-${++instanceNumber}`;
    const geometry = options.geometry || {};
    const layer = svgNode('g', {class: 'village-basemap-tiles', 'aria-hidden': 'true', 'pointer-events': 'none'});
    const defs = svgNode('defs'); layer.append(defs);
    const firstContent = Array.from(svg.children).find(child => !['title', 'desc', 'defs'].includes(child.localName));
    svg.insertBefore(layer, firstContent || null);
    const metadataRegions = geometry.regions?.length ? geometry.regions : [{id: 'main', geoTransform: geometry.geoTransform}];
    const multiRegion = metadataRegions.length > 1;
    const regions = metadataRegions.map((region, index) => {
      const transform = region.geoTransform || (!multiRegion ? geometry.geoTransform : null);
      const clipId = `${id}-region-${index}`;
      const clip = svgNode('clipPath', {id: clipId, clipPathUnits: 'userSpaceOnUse'});
      const clipRect = svgNode('rect'); clip.append(clipRect); defs.append(clip);
      const group = svgNode('g', {class: 'village-basemap-region', 'data-region': region.id || index, 'clip-path': `url(#${clipId})`});
      layer.append(group);
      return {index, transform, frame: region.frame, group, clipRect};
    });
    let enabled = false, destroyed = false, epoch = 0, timer = null, currentViewport = null, lastStatus = '';
    const records = new Map();
    const debounceMs = Number.isFinite(options.debounceMs) ? Math.max(0, Math.min(1000, options.debounceMs)) : 120;
    const maxTiles = Number.isFinite(options.maxTiles) ? Math.max(1, Math.floor(options.maxTiles)) : 256;
    let observer = null;

    function report(state, values = {}) {
      if (destroyed) return;
      const status = {state, loaded: 0, total: 0, failed: 0, ...values};
      layer.setAttribute('data-state', state);
      const key = JSON.stringify(status);
      if (key === lastStatus) return;
      lastStatus = key;
      options.onStatus?.(status);
    }
    function removeRecord(key, record) {
      record.image.removeEventListener('load', record.onLoad);
      record.image.removeEventListener('error', record.onError);
      record.image.removeAttribute('href');
      record.image.remove(); records.delete(key);
    }
    function clearTiles() { for (const [key, record] of records) removeRecord(key, record); }
    function cancelTimer() { if (timer != null) clearTimeout(timer); timer = null; }
    function reportBatch() {
      if (destroyed || !enabled) return;
      let loaded = 0, failed = 0, pending = 0, total = 0;
      for (const record of records.values()) {
        if (record.epoch !== epoch) continue;
        total++;
        if (record.state === 'loaded') loaded++;
        else if (record.state === 'failed') failed++;
        else pending++;
      }
      const state = pending ? 'loading' : loaded === total && total ? 'ready' : loaded && failed ? 'partial' : total ? 'error' : 'unavailable';
      report(state, {loaded, failed, total});
    }
    function makeTile(region, zoom, x, y, key) {
      const transform = region.transform;
      const span = (transform.worldWidthMeters || WORLD) / 2 ** zoom;
      const [tx, ty] = transform.translate, scale = transform.scale;
      const image = svgNode('image', {
        class: 'village-basemap-tile',
        x: (-((transform.worldWidthMeters || WORLD) / 2) + x * span) * scale + tx,
        y: ty - (((transform.worldWidthMeters || WORLD) / 2) - y * span) * scale,
        width: span * scale, height: span * scale,
        preserveAspectRatio: 'none', 'data-zoom': zoom, 'data-row': y, 'data-col': x,
      });
      const record = {image, epoch, state: 'pending', onLoad: null, onError: null};
      function complete(state) {
        record.state = state;
        if (!destroyed && enabled && record.epoch === epoch && records.get(key) === record) reportBatch();
      }
      record.onLoad = () => complete('loaded'); record.onError = () => complete('failed');
      image.addEventListener('load', record.onLoad); image.addEventListener('error', record.onError);
      records.set(key, record); region.group.append(image);
      // SVG images use the browser's ordinary HTTP cache. No proxy, prefetch, or
      // application-side download/cache is involved; row precedes column here.
      const url = options.tileUrl ? options.tileUrl(zoom, y, x) : `https://wmts.nlsc.gov.tw/wmts/EMAP/default/GoogleMapsCompatible/${zoom}/${y}/${x}`;
      image.setAttribute('href', url);
      return record;
    }
    function refresh() {
      timer = null;
      if (destroyed || !enabled) return;
      const coverage = screenCoverage(svg);
      if (!coverage || regions.some(region => !validTransform(region.transform) || multiRegion && !finiteBox(region.frame))) {
        clearTiles(); report('unavailable'); return;
      }
      const wanted = new Set();
      for (const region of regions) {
        const area = multiRegion ? intersect(coverage.box, region.frame) : coverage.box;
        const clipBox = multiRegion ? region.frame : coverage.box;
        for (const [key, value] of Object.entries(clipBox)) region.clipRect.setAttribute(key, value);
        if (!area) continue;
        const transform = region.transform;
        const ideal = Math.log2((transform.worldWidthMeters || WORLD) * transform.scale * coverage.cssPixelsPerUnit / TILE_SIZE);
        let zoom = Math.max(0, Math.min(MAX_ZOOM, Math.round(ideal)));
        let range = tileRange(area, transform, zoom);
        while (range.total > maxTiles && zoom > 0) range = tileRange(area, transform, --zoom);
        region.group.setAttribute('data-zoom', zoom);
        for (let y = range.y1; y <= range.y2; y++) {
          for (let x = range.x1; x <= range.x2; x++) {
            const key = `${region.index}:${zoom}:${y}:${x}`; wanted.add(key);
            const record = records.get(key) || makeTile(region, zoom, x, y, key);
            record.epoch = epoch;
          }
        }
      }
      for (const [key, record] of records) if (!wanted.has(key)) removeRecord(key, record);
      reportBatch();
    }
    function update(viewport) {
      if (destroyed) return;
      currentViewport = finiteBox(viewport) ? {...viewport} : options.getViewport?.() || viewportFromSvg(svg);
      epoch++; cancelTimer();
      if (!enabled) { report('off'); return; }
      timer = setTimeout(refresh, debounceMs);
    }
    function setEnabled(next) {
      if (destroyed || enabled === Boolean(next)) return;
      enabled = Boolean(next); epoch++; cancelTimer();
      layer.style.display = enabled ? '' : 'none';
      if (!enabled) { clearTiles(); report('off'); }
      else refresh();
    }
    function retry() {
      if (destroyed || !enabled) return;
      epoch++; cancelTimer();
      for (const [key, record] of records) if (record.state === 'failed') removeRecord(key, record);
      refresh();
    }
    const onResize = () => update(currentViewport);
    window.addEventListener('resize', onResize);
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(onResize); observer.observe(svg);
    }
    layer.style.display = 'none'; report('off');
    if (options.enabled) setEnabled(true);
    return {
      update, setEnabled, retry,
      destroy() {
        if (destroyed) return;
        destroyed = true; enabled = false; epoch++; cancelTimer();
        window.removeEventListener('resize', onResize); observer?.disconnect();
        clearTiles(); layer.remove();
      },
    };
  }
  return {create};
})();
