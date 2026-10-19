/* County-level historical vote shares. Standalone, dependency-free renderer. */
(function () {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const palette = ['#7958a0', '#ac532c', '#795f13', '#a64370', '#496c83', '#76645c', '#526b32', '#9a427d'];
  let instanceCount = 0;

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = String(text);
    return node;
  }

  function svgElement(tag, attrs, text) {
    const node = document.createElementNS(SVG_NS, tag);
    Object.entries(attrs || {}).forEach(([key, value]) => node.setAttribute(key, String(value)));
    if (text != null) node.textContent = String(text);
    return node;
  }

  function partyColor(party, index) {
    if (party.name === '中國國民黨' || party.name === '國民黨') return '#245baa';
    if (party.name === '民主進步黨' || party.name === '民進黨') return '#217846';
    if (party.name === '台灣民眾黨' || party.name === '臺灣民眾黨' || party.name === '民眾黨') return '#087e8a';
    return palette[index % palette.length];
  }

  function partyLabel(party) {
    return party.name === '無' ? '無黨籍（來源：無）' : party.name || '來源未列黨籍';
  }

  function getShare(election, partyId) {
    if (!Object.prototype.hasOwnProperty.call(election.shares || {}, partyId)) return null;
    const value = election.shares[partyId];
    if (value == null || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 && number <= 100 ? number : null;
  }

  function getVotes(election, partyId) {
    const value = election.voteCounts?.[partyId];
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
  }

  // A zero aggregate can mean the source did not list this endorsement
  // category. Do not infer that from zero alone or from party history.
  function participationStatus(election, partyId) {
    if (getVotes(election, partyId) !== 0) return '';
    const listed = election.participatingParties;
    if (!Array.isArray(listed) || listed.some(id => typeof id !== 'string')) return '參選分類未確認';
    return listed.includes(partyId) ? '本次有此參選分類' : '本次未列此參選分類';
  }

  function appendParticipationStatus(node, election, partyId) {
    const text = participationStatus(election, partyId);
    if (text) node.append(element('small', 'ph-participation-status', text));
  }

  function blueGreenTotals(election, pair) {
    if (pair.length !== 2) return null;
    const votes = pair.map(party => getVotes(election, party.id));
    if (votes.some(value => value == null)) return null;
    const total = votes[0] + votes[1];
    return Number.isSafeInteger(total) ? {votes, total} : null;
  }

  function selectedTotals(election, selectedParties) {
    if (!selectedParties.length) return null;
    const votes = selectedParties.map(party => getVotes(election, party.id));
    if (votes.some(value => value == null)) return null;
    const total = votes.reduce((sum, value) => sum + value, 0);
    return Number.isSafeInteger(total) ? {votes, total} : null;
  }

  function modeShare(election, partyId, mode, pair, selectedParties) {
    if (mode === 'selected') {
      const totals = selectedTotals(election, selectedParties);
      const votes = getVotes(election, partyId);
      return totals?.total && votes != null ? votes / totals.total * 100 : null;
    }
    if (mode !== 'blue-green') return getShare(election, partyId);
    const totals = blueGreenTotals(election, pair);
    if (!totals?.total) return null;
    // Allocate display basis points once so the two displayed percentages sum to 100.00%.
    const blue = Math.round(totals.votes[0] / totals.total * 10000);
    if (partyId === pair[0].id) return blue / 100;
    if (partyId === pair[1].id) return (10000 - blue) / 100;
    return null;
  }

  function voteText(votes) {
    return votes == null ? '票數未知' : `${votes.toLocaleString('zh-TW')} 票`;
  }

  function percentage(value) {
    return value == null ? '—' : `${value.toFixed(2)}%`;
  }

  function electionLabel(election) {
    return election.label || (election.type === 'president' ? '總統' : '縣市長');
  }

  function safeSourceUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
    } catch (_) { return null; }
  }

  function sourceLink(election) {
    const url = safeSourceUrl(election.sourceUrl);
    if (!url) return element('span', 'ph-source-unavailable', '來源未提供');
    const isZip = new URL(url).pathname.toLowerCase().endsWith('.zip');
    const link = element('a', 'ph-source-link', isZip ? '中選會原始檔 ZIP ↗' : '中選會資料 ↗');
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.title = election.sourceLabel || `${election.year} 年${electionLabel(election)}中選會資料`;
    link.setAttribute('aria-label', `${election.year} 年${electionLabel(election)}${election.sourceLabel || '中選會資料'}（另開分頁）`);
    return link;
  }

  function normalise(data) {
    const seen = new Set();
    const parties = (data.parties || []).filter(party => {
      if (!party || party.id == null || typeof party.name !== 'string' || seen.has(String(party.id))) return false;
      seen.add(String(party.id));
      return true;
    }).map((party, index) => ({...party, id: String(party.id), color: partyColor(party, index)}));
    const elections = (data.elections || []).filter(election => election &&
      Number.isInteger(Number(election.year)) && ['president', 'mayor'].includes(election.type))
      .map(election => ({...election, year: Number(election.year)}))
      .sort((a, b) => a.year - b.year || (a.type === 'president' ? -1 : 1));
    return {parties, elections};
  }

  function makeChart(parties, elections, active, selectedIndex, selectElection, id, valueFor, mode) {
    // Position by election year. A second election in the same year occupies its own slot.
    const times = elections.map(election => election.year + (election.type === 'president' ? 0.05 : 0.85));
    const min = Math.min(...times), max = Math.max(...times);
    const gaps = times.slice(1).map((time, index) => time - times[index]).filter(gap => gap > 0);
    const minimumGap = gaps.length ? Math.min(...gaps) : 1;
    // Keep nearby elections at least 64px apart, including on a narrow phone screen.
    const width = Math.ceil(Math.max(660, elections.length * 66 + 66, (max - min) / minimumGap * 64 + 70));
    const height = 320;
    const left = 32, right = width - 32, top = 20, bottom = 251;
    const xAt = index => times.length === 1 ? (left + right) / 2 : left + (times[index] - min) / (max - min) * (right - left);
    const yAt = share => bottom - share / 100 * (bottom - top);
    const svg = svgElement('svg', {viewBox: `0 0 ${width} ${height}`, class: 'ph-chart', role: 'group',
      'aria-labelledby': `${id}-chart-title ${id}-chart-description`});
    svg.style.minWidth = `${width}px`;
    svg.style.width = `${width}px`;
    svg.append(svgElement('title', {id: `${id}-chart-title`}, '歷史政黨得票比例折線圖'));
    svg.append(svgElement('desc', {id: `${id}-chart-description`}, `${mode === 'blue-green' ? '縱軸以國民黨與民進黨票數合計為分母，兩黨比例合計 100%。' : mode === 'selected' ? '縱軸以已開啟政黨的票數合計為分母，所選政黨比例合計 100%。' : '縱軸為占當次全部有效票的得票百分比。'}從 0 到 100%。圓點為總統選舉，方點為縣市長選舉。各年度票數、比例與來源列在下方表格。`));

    for (let share = 0; share <= 100; share += 20) {
      const y = yAt(share);
      svg.append(svgElement('line', {x1: 0, x2: width, y1: y, y2: y, class: 'ph-grid'}));
    }
    if (selectedIndex != null) {
      svg.append(svgElement('line', {x1: xAt(selectedIndex), x2: xAt(selectedIndex), y1: top, y2: bottom,
        class: 'ph-selection-line'}));
    }

    const points = [];
    parties.filter(party => active.has(party.id)).forEach(party => {
      const participated = elections.map((election, index) =>
        Array.isArray(election.participatingParties) && election.participatingParties.includes(party.id) ? index : -1)
        .filter(index => index >= 0);
      if (mode !== 'blue-green' && !participated.length) return;
      const first = mode === 'blue-green' ? 0 : participated[0];
      const last = mode === 'blue-green' ? elections.length - 1 : participated[participated.length - 1];
      const chartShare = (election, index) => index < first || index > last ? null : valueFor(election, party.id);
      let path = '';
      let previousKnown = false;
      elections.forEach((election, index) => {
        const share = chartShare(election, index);
        if (share == null) { previousKnown = false; return; }
        path += `${previousKnown ? ' L' : ' M'}${xAt(index).toFixed(2)},${yAt(share).toFixed(2)}`;
        previousKnown = true;
      });
      svg.append(svgElement('path', {d: path.trim(), fill: 'none', stroke: party.color, 'stroke-width': 2.5,
        'stroke-linejoin': 'round', 'stroke-linecap': 'round', class: 'ph-series', 'data-party-id': party.id, 'aria-hidden': 'true'}));
      elections.forEach((election, index) => {
        const share = chartShare(election, index);
        if (share == null) return;
        const attrs = {fill: party.color, stroke: '#fff', 'stroke-width': 1.5, class: 'ph-point',
          'data-party-id': party.id, 'data-year': election.year, 'data-election-type': election.type, 'aria-hidden': 'true'};
        const marker = election.type === 'president'
          ? svgElement('circle', {...attrs, cx: xAt(index), cy: yAt(share), r: 4.8})
          : svgElement('rect', {...attrs, x: xAt(index) - 4.8, y: yAt(share) - 4.8, width: 9.6, height: 9.6, rx: 0.8});
        const point = {election, party, share, index, x: xAt(index), y: yAt(share)};
        const group = svgElement('g', {class: 'ph-data-point', tabindex: '0', role: 'button',
          'data-point-index': points.length, 'data-party-id': party.id, 'data-year': election.year,
          'data-election-type': election.type,
          'aria-label': `${election.year} 年${electionLabel(election)} · ${partyLabel(party)} ${percentage(share)}${mode === 'blue-green' ? '（藍綠合計 100%）' : mode === 'selected' ? '（所選政黨合計 100%）' : ''}${participationStatus(election, party.id) ? ' · ' + participationStatus(election, party.id) : ''}`});
        group.append(svgElement('circle', {cx: point.x, cy: point.y, r: 10, class: 'ph-point-hit', 'aria-hidden': 'true'}), marker);
        point.node = group;
        points.push(point);
        svg.append(group);
      });
    });

    // Keyboard reading starts with the recent results visible on first entry.
    // Keep coordinates and path chronology unchanged; group parties by year.
    [...points].sort((a, b) => b.index - a.index).forEach(point => svg.append(point.node));

    [...elections.entries()].reverse().forEach(([index, election]) => {
      const x = xAt(index);
      const label = svgElement('g', {class: 'ph-event-label', tabindex: '0', role: 'button',
        'data-election-index': index,
        'aria-label': `查看 ${election.year} 年${electionLabel(election)}各政黨比例`,
        'aria-pressed': selectedIndex === index ? 'true' : 'false'});
      label.append(svgElement('rect', {x: x - 28, y: bottom + 8, width: 56, height: 52, rx: 5, class: 'ph-event-hit'}));
      label.append(svgElement('text', {x, y: bottom + 27, 'text-anchor': 'middle', class: 'ph-year'}, election.year));
      label.append(svgElement('text', {x, y: bottom + 46, 'text-anchor': 'middle', class: 'ph-event-type'}, electionLabel(election)));
      label.addEventListener('click', () => selectElection(index));
      label.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault(); selectElection(index);
        }
      });
      svg.append(label);
    });
    return {svg, points};
  }

  function render(container, data, options) {
    if (!(container instanceof Element)) throw new TypeError('PartyHistory.render requires a container element.');
    options = options || {};
    data = data || {};
    const {parties, elections} = normalise(data);
    const id = `party-history-${++instanceCount}`;
    container.replaceChildren();
    container.classList.add('party-history');
    container.tabIndex = -1;
    if (!parties.length || !elections.length) {
      container.append(element('p', 'ph-empty', '此縣市尚無可顯示的歷史政黨得票資料。'));
      return {setShareMode() {}, getShareMode() { return 'all'; }, destroy() { container.replaceChildren(); }};
    }
    const active = new Set(parties.map(party => party.id));
    const blueGreen = [parties.find(party => ['中國國民黨', '國民黨'].includes(party.name)),
      parties.find(party => ['民主進步黨', '民進黨'].includes(party.name))].filter(Boolean);
    let shareMode = ['selected', 'blue-green'].includes(options.shareMode) ? options.shareMode : 'all';
    const visibleParties = () => shareMode === 'blue-green' ? blueGreen : parties.filter(party => active.has(party.id));
    const valueFor = (election, partyId) => modeShare(election, partyId, shareMode, blueGreen, visibleParties());
    let selectedIndex = null;
    const countyName = options.countyName || data.countyName || '';
    const heading = element('div', 'ph-heading');
    const title = element('h3', '', '歷史政黨得票比例');
    title.id = `${id}-heading`;
    heading.append(title, element('span', 'ph-county', countyName));
    container.setAttribute('aria-labelledby', title.id);
    container.append(heading);
    container.append(element('p', 'ph-intro', '縣市長與總統選舉的歷史得票比例，依當年推薦政黨歸類；並非民調或 2026 年支持度。'));
    const checkedOn = typeof data.checkedOn === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(data.checkedOn) ? data.checkedOn : '未取得';
    const sourceDate = element('p', 'ph-source-date');
    sourceDate.append(element('strong', '', `本站歷史資料核對日：${checkedOn}`),
      element('span', '', '此為本站核對紀錄，不代表原檔取得日或官方更新日；後兩項日期目前未取得。本站非即時同步，選舉年份另列於圖表。'));
    container.append(sourceDate);

    const modeControls = element('div', 'ph-mode-controls');
    modeControls.setAttribute('role', 'group');
    modeControls.setAttribute('aria-label', '切換歷史政黨圖表的比例分母');
    const modeButtons = new Map();
    const modeNote = element('p', 'ph-mode-note');
    modeNote.id = `${id}-mode-note`;
    [['all', '占全部有效票'], ['selected', '所選政黨合計100%'], ['blue-green', '只看藍綠（合計100%）']].forEach(([mode, label]) => {
      const button = element('button', 'ph-mode-button', label);
      button.type = 'button';
      button.setAttribute('aria-describedby', modeNote.id);
      button.addEventListener('click', () => {
        if (shareMode === mode) return;
        setShareMode(mode);
        options.onShareModeChange?.(mode);
      });
      modeButtons.set(mode, button);
      modeControls.append(button);
    });
    container.append(modeControls, modeNote);

    const controls = element('div', 'ph-party-controls');
    controls.setAttribute('role', 'group');
    controls.setAttribute('aria-label', '選擇顯示的政黨與來源分類；同時切換折線與表格欄位');
    const buttons = new Map();
    const chartId = `${id}-chart`;
    const tableId = `${id}-table`;
    modeButtons.forEach(button => button.setAttribute('aria-controls', `${chartId} ${tableId}`));
    parties.forEach(party => {
      const button = element('button', 'ph-party-button');
      button.type = 'button';
      button.style.setProperty('--ph-party-color', party.color);
      button.setAttribute('aria-pressed', 'true');
      button.setAttribute('aria-controls', `${chartId} ${tableId}`);
      const check = element('span', 'ph-party-check', '✓');
      check.setAttribute('aria-hidden', 'true');
      const swatch = element('span', 'ph-party-swatch');
      swatch.setAttribute('aria-hidden', 'true');
      button.append(check, swatch, element('span', '', partyLabel(party)));
      button.addEventListener('click', () => {
        if (active.has(party.id)) active.delete(party.id); else active.add(party.id);
        button.setAttribute('aria-pressed', active.has(party.id) ? 'true' : 'false');
        check.textContent = active.has(party.id) ? '✓' : '+';
        update();
        status.textContent = `${partyLabel(party)}已${active.has(party.id) ? '顯示' : '隱藏'}，目前顯示 ${active.size} 個來源分類。`;
      });
      buttons.set(party.id, button);
      controls.append(button);
    });
    for (const [visible, label] of [[true, '顯示全部分類'], [false, '隱藏全部分類']]) {
      const button = element('button', 'ph-selection-button', label);
      button.type = 'button';
      button.addEventListener('click', () => {
        active.clear();
        if (visible) parties.forEach(party => active.add(party.id));
        buttons.forEach((choice, partyId) => {
          choice.setAttribute('aria-pressed', String(active.has(partyId)));
          choice.querySelector('.ph-party-check').textContent = visible ? '✓' : '+';
        });
        update();
        status.textContent = visible ? `已顯示全部 ${active.size} 個來源分類。` : '已隱藏全部分類，請選擇要比較的政黨或分類。';
      });
      controls.append(button);
    }
    const partyHelp = element('a', 'ph-rule-link', '來源分類說明');
    partyHelp.href = '#party-history-help';
    controls.append(partyHelp);
    container.append(controls);
    const shapeLegend = element('div', 'ph-shape-legend');
    const denominatorLegend = element('span');
    const totalLegend = element('span');
    shapeLegend.append(element('span', '', '● 總統選舉'), element('span', '', '■ 縣市長選舉'),
      denominatorLegend, totalLegend);
    container.append(shapeLegend);
    const pairLegend = element('div', 'ph-blue-green-legend');
    blueGreen.forEach(party => {
      const label = element('span', '', partyLabel(party));
      const swatch = element('i', 'ph-detail-dot');
      swatch.style.backgroundColor = party.color;
      label.prepend(swatch);
      pairLegend.append(label);
    });
    container.append(pairLegend);
    container.append(element('p', 'ph-scroll-hint', '滑鼠移到、點選或用鍵盤移到資料點，圖框下方會列出目前顯示分類的票數、比例與分母；按 Esc 關閉。點年份也可展開數據，左右滑動看其他年份。'));
    const chartFrame = element('div', 'ph-chart-frame');
    const fixedAxis = svgElement('svg', {viewBox: '0 0 44 330', class: 'ph-fixed-axis', 'aria-hidden': 'true'});
    for (let share = 0; share <= 100; share += 20) {
      // The plot has 10px top padding; keep tick labels aligned with its horizontal grid.
      const y = 10 + 251 - share / 100 * (251 - 20);
      fixedAxis.append(svgElement('text', {x: 36, y: y + 4, 'text-anchor': 'end', class: 'ph-axis'}, `${share}%`));
    }
    const chartScroll = element('div', 'ph-chart-scroll');
    chartScroll.id = chartId;
    chartScroll.tabIndex = 0;
    chartScroll.setAttribute('role', 'region');
    chartScroll.setAttribute('aria-label', '歷史政黨折線圖，可左右捲動');
    chartFrame.append(fixedAxis, chartScroll);
    container.append(chartFrame);
    const tooltip = element('div', 'ph-chart-tooltip');
    tooltip.id = `${id}-tooltip`;
    tooltip.setAttribute('role', 'tooltip');
    tooltip.hidden = true;
    chartFrame.append(tooltip);
    const chartMessage = element('p', 'ph-all-hidden');
    chartMessage.hidden = true;
    chartFrame.append(chartMessage);
    const tooltipEvents = new AbortController();
    let chartSvg = null, chartPoints = [], focusedPoint = null, hoveredPoint = null, tappedPoint = null;
    let tooltipKey = '', tooltipDismissed = false, pointerType = 'mouse', focusFrame = null;

    function hideTooltip() {
      tooltip.hidden = true;
      chartPoints.forEach(point => point.node.removeAttribute('aria-describedby'));
    }

    function dismissTooltip() {
      tooltipDismissed = true;
      hoveredPoint = null;
      tappedPoint = null;
      hideTooltip();
    }

    function showTooltip(point) {
      if (!point || !chartSvg || !chartSvg.isConnected) return;
      const related = visibleParties();
      const key = `${shareMode}:${point.index}:${related.map(party => party.id).join('|')}`;
      if (tooltipKey !== key) {
        tooltipKey = key;
        tooltip.replaceChildren(element('strong', 'ph-tooltip-election', `${point.election.year} 年${electionLabel(point.election)}`));
        related.forEach(party => {
          const row = element('div', 'ph-tooltip-value');
          const swatch = element('span', 'ph-tooltip-swatch');
          swatch.style.backgroundColor = party.color;
          const label = element('span', 'ph-tooltip-party', partyLabel(party));
          label.append(element('small', 'ph-vote-count', voteText(getVotes(point.election, party.id))));
          appendParticipationStatus(label, point.election, party.id);
          row.append(swatch, label, element('b', '', percentage(valueFor(point.election, party.id))));
          tooltip.append(row);
        });
        tooltip.append(element('p', 'ph-tooltip-denominator', denominatorText(point.election)));
      }
      tooltipDismissed = false;
      tooltip.hidden = false;
      // The detail stays within the chart card, below the plot. All source
      // categories remain readable without clipping a tall floating tooltip.
      chartPoints.forEach(other => other.node.removeAttribute('aria-describedby'));
      point.node.setAttribute('aria-describedby', tooltip.id);
    }

    function nearestPoint(event) {
      const matrix = chartSvg?.getScreenCTM();
      if (!matrix) return null;
      const position = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
      let nearest = null, distance = 10 * 10;
      chartPoints.forEach(point => {
        const current = (position.x - point.x) ** 2 + (position.y - point.y) ** 2;
        if (current <= distance) { distance = current; nearest = point; }
      });
      return nearest;
    }

    function pointFromTarget(target) {
      const node = target instanceof Element ? target.closest('.ph-data-point') : null;
      return node && chartScroll.contains(node) ? chartPoints[Number(node.dataset.pointIndex)] : null;
    }

    function pointerMove(event) {
      if (event.pointerType === 'touch') return;
      hoveredPoint = nearestPoint(event);
      if (hoveredPoint) showTooltip(hoveredPoint, true);
      else if (focusedPoint && !tooltipDismissed) showTooltip(focusedPoint, false);
      else hideTooltip();
    }

    const eventOptions = {signal: tooltipEvents.signal};
    chartScroll.addEventListener('pointerover', pointerMove, eventOptions);
    chartScroll.addEventListener('pointermove', pointerMove, eventOptions);
    chartScroll.addEventListener('pointerleave', event => {
      if (event.relatedTarget instanceof Element && tooltip.contains(event.relatedTarget)) return;
      hoveredPoint = null;
      if (focusedPoint && !tooltipDismissed) showTooltip(focusedPoint, false);
      else if (tappedPoint && !tooltipDismissed) showTooltip(tappedPoint, true);
      else hideTooltip();
    }, eventOptions);
    chartScroll.addEventListener('pointerdown', event => { pointerType = event.pointerType; }, eventOptions);
    chartScroll.addEventListener('focusin', event => {
      focusedPoint = pointFromTarget(event.target);
      if (!focusedPoint) return;
      const point = focusedPoint;
      showTooltip(point, false);
      if (focusFrame != null) cancelAnimationFrame(focusFrame);
      focusFrame = requestAnimationFrame(() => {
        focusFrame = null;
        if (focusedPoint === point && document.activeElement === point.node) showTooltip(point, false);
      });
    }, eventOptions);
    chartScroll.addEventListener('focusout', event => {
      if (pointFromTarget(event.target)) focusedPoint = null;
      if (hoveredPoint && !tooltipDismissed) showTooltip(hoveredPoint, true);
      else if (tappedPoint && !tooltipDismissed) showTooltip(tappedPoint, true);
      else hideTooltip();
    }, eventOptions);
    chartFrame.addEventListener('click', event => {
      if (tooltip.contains(event.target)) return;
      const point = pointFromTarget(event.target) && (nearestPoint(event) || pointFromTarget(event.target));
      if (point) {
        // Overlapping hit circles can focus the last painted party; keep focus on the nearest actual point.
        if (document.activeElement !== point.node) point.node.focus({preventScroll: true});
        focusedPoint = point;
        if (focusFrame != null) { cancelAnimationFrame(focusFrame); focusFrame = null; }
        if (pointerType === 'touch' || event.pointerType === 'touch') tappedPoint = point;
        showTooltip(point, true);
      } else dismissTooltip();
    }, eventOptions);
    chartFrame.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (focusFrame != null) { cancelAnimationFrame(focusFrame); focusFrame = null; }
        dismissTooltip();
      } else if ((event.key === 'Enter' || event.key === ' ') && pointFromTarget(event.target)) {
        event.preventDefault(); showTooltip(pointFromTarget(event.target), false);
      }
    }, eventOptions);
    let viewportWidth = chartScroll.clientWidth, followLatest = true, previousFrameSize = null;
    const atLatest = () => chartScroll.scrollWidth - chartScroll.clientWidth - chartScroll.scrollLeft <= 2;
    chartScroll.addEventListener('scroll', () => {
      dismissTooltip();
      // A resize can emit a scroll event before the observer runs. Preserve the
      // previous-width reading position until the resized frame is processed.
      if (chartScroll.clientWidth === viewportWidth) followLatest = atLatest();
    }, {...eventOptions, passive: true});
    const frameObserver = new ResizeObserver(() => {
      if (!chartFrame.isConnected) return;
      const size = {width: chartFrame.clientWidth, height: chartFrame.clientHeight};
      if (previousFrameSize && size.width !== previousFrameSize.width) {
        const pointed = hoveredPoint || focusedPoint || tappedPoint;
        const showingLatest = !tooltip.hidden && pointed?.index === elections.length - 1;
        const alignLatest = followLatest || showingLatest;
        if (focusFrame != null) { cancelAnimationFrame(focusFrame); focusFrame = null; }
        dismissTooltip();
        viewportWidth = chartScroll.clientWidth;
        if (alignLatest) chartScroll.scrollLeft = Math.max(0, chartScroll.scrollWidth - chartScroll.clientWidth);
        followLatest = atLatest();
      }
      previousFrameSize = size;
    });
    frameObserver.observe(chartFrame);
    const detail = element('div', 'ph-detail');
    detail.hidden = true;
    detail.setAttribute('aria-live', 'polite');
    container.append(detail);
    const tableScroll = element('div', 'ph-table-scroll');
    tableScroll.tabIndex = 0;
    tableScroll.setAttribute('role', 'region');
    tableScroll.setAttribute('aria-label', '各年度政黨得票比例表，可左右捲動');
    container.append(tableScroll);
    const navigation = element('nav', 'result-navigation');
    navigation.setAttribute('aria-label', '歷史政黨比例查詢切換');
    [['#party-history', '返回圖表 ↑'], ['#candidate-heading', '返回候選人 ↑'],
      ['#select-heading', '更換縣市／種類 ↑']].forEach(([href, label]) => {
      const link = element('a', '', label);
      link.href = href;
      navigation.append(link);
    });
    container.append(navigation);
    const note = element('p', 'ph-reading-note');
    container.append(note);
    const coverageNote = element('p', 'ph-coverage-note');
    if (data.coverageNote) container.append(coverageNote);
    const status = element('span', 'sr-only');
    status.setAttribute('aria-live', 'polite');
    container.append(status);

    function selectElection(index) {
      selectedIndex = selectedIndex === index ? null : index;
      update();
      // Keep keyboard focus on the same event after rebuilding the SVG.
      chartScroll.querySelector(`.ph-event-label[data-election-index="${index}"]`)?.focus({preventScroll: true});
    }

    function update() {
      dismissTooltip();
      if (focusFrame != null) { cancelAnimationFrame(focusFrame); focusFrame = null; }
      focusedPoint = null;
      tooltipKey = '';
      const selectedParties = visibleParties();
      const blueMode = shareMode === 'blue-green';
      const selectedMode = shareMode === 'selected';
      container.dataset.shareMode = shareMode;
      modeButtons.forEach((button, mode) => button.setAttribute('aria-pressed', mode === shareMode ? 'true' : 'false'));
      controls.hidden = blueMode;
      pairLegend.hidden = !blueMode;
      modeNote.textContent = blueMode ? '藍綠＝中國國民黨＋民主進步黨。每黨比例＝該黨票數 ÷ 兩黨合計票數；兩者合計 100%。與 2022 上屆結果同步切換。' : selectedMode ? '比例＝該分類原始票數 ÷ 已開啟政黨與分類的票數合計。點政黨名稱可重新選擇，圖表、提示與本表一起重算；2022 上屆結果維持占全部有效票。' : '比例＝各來源分類票數 ÷ 當次全部有效票。預設顯示全部政黨、無黨籍與連署等分類，可點名稱切換圖表、提示與表格；與 2022 上屆結果同步切換。';
      denominatorLegend.textContent = blueMode ? '分母：國民黨＋民進黨票數' : selectedMode ? '占所選政黨得票' : '占當次全部有效票';
      totalLegend.textContent = blueMode ? '藍綠合計 100%' : selectedMode ? '所選合計 100%' : '隱藏分類後不一定合計 100%';
      note.textContent = blueMode ? '保留兩黨原始票數；零票旁標示當次來源的參選分類狀態。兩黨合計 0 票或票數未知時，比例顯示「—」且不畫資料點。百分比顯示至小數兩位，兩者合計 100.00%。' : selectedMode ? '折線保留第一次到最後一次參選的範圍。所選政黨任一票數未知，或合計為 0 票時，該次比例顯示「—」且不畫資料點。比例按原始票數計算；顯示至小數兩位，加總可能有微小四捨五入差異。' : '折線只顯示第一次到最後一次參選之間；零票旁標示當次來源的參選分類狀態，未知票數不當作 0。比例以當次全部有效票計算，全部分類包含全部有效票；隱藏部分分類後，顯示比例不一定合計為 100%。「無」標示為「無黨籍（來源：無）」，其他來源名稱原樣保留。';
      coverageNote.textContent = blueMode ? (data.coverageNote || '').replace('無黨籍與連署票保留於分母，不列為政黨選項。', '藍綠模式只以兩黨票數為分母。') : selectedMode ? (data.coverageNote || '').replace('無黨籍與連署票保留於分母，不列為政黨選項。', '此模式只以已開啟政黨的票數為分母。') : data.coverageNote || '';
      const chart = makeChart(parties, elections, new Set(selectedParties.map(party => party.id)), selectedIndex, selectElection, id, valueFor, shareMode);
      chartSvg = chart.svg;
      chartPoints = chart.points;
      chartScroll.replaceChildren(chart.svg);
      chartMessage.hidden = true;
      chartMessage.textContent = '';
      if (!selectedParties.length) {
        chartMessage.textContent = blueMode ? '未提供兩黨完整資料，無法計算藍綠比例。' : '目前已隱藏所有政黨。點選上方政黨即可顯示。';
        chartMessage.hidden = false;
      } else if (selectedMode && !chartPoints.length) {
        chartMessage.textContent = '所選政黨合計為 0 票或票數資料不完整，目前沒有可計算的資料點。';
        chartMessage.hidden = false;
      }
      detail.replaceChildren();
      detail.hidden = selectedIndex == null;
      if (selectedIndex != null) {
        const election = elections[selectedIndex];
        detail.append(element('strong', '', `${election.year} 年${electionLabel(election)}`));
        selectedParties.forEach(party => {
          const value = element('span', 'ph-detail-value');
          const reading = element('span', 'ph-detail-reading', `${partyLabel(party)} ${voteText(getVotes(election, party.id))} · ${percentage(valueFor(election, party.id))}`);
          appendParticipationStatus(reading, election, party.id);
          value.append(reading);
          const dot = element('i', 'ph-detail-dot');
          dot.style.backgroundColor = party.color;
          value.prepend(dot);
          detail.append(value);
        });
        detail.append(element('p', 'ph-detail-denominator', denominatorText(election)));
      }

      const table = element('table', 'ph-table');
      table.id = tableId;
      table.append(element('caption', 'sr-only', `${countyName}歷史縣市長及總統選舉政黨票數與比例（${blueMode ? '藍綠合計100%' : selectedMode ? '所選政黨合計100%' : '占全部有效票'}）`));
      const thead = element('thead');
      const header = element('tr');
      const eventHeading = element('th', 'ph-event-column', '年度／選舉');
      eventHeading.scope = 'col';
      header.append(eventHeading);
      selectedParties.forEach(party => {
        const th = element('th', 'ph-share-column', partyLabel(party));
        th.scope = 'col';
        const swatch = element('span', 'ph-table-swatch');
        swatch.style.backgroundColor = party.color;
        th.prepend(swatch);
        header.append(th);
      });
      const sourceHeading = element('th', 'ph-source-column', '來源');
      sourceHeading.scope = 'col';
      header.append(sourceHeading);
      thead.append(header);
      table.append(thead);
      const tbody = element('tbody');
      [...elections.entries()].reverse().forEach(([index, election]) => {
        const row = element('tr', selectedIndex === index ? 'ph-selected-row' : '');
        const th = element('th', 'ph-event-column');
        th.scope = 'row';
        th.append(element('strong', '', `${election.year} 年`), element('span', 'ph-table-election-type', electionLabel(election)));
        row.append(th);
        selectedParties.forEach(party => {
          const share = valueFor(election, party.id);
          const cell = element('td', 'ph-share-column', percentage(share));
          cell.append(element('small', 'ph-vote-count', voteText(getVotes(election, party.id))));
          appendParticipationStatus(cell, election, party.id);
          if (share == null) cell.setAttribute('aria-label', `${partyLabel(party)}比例無法計算；${voteText(getVotes(election, party.id))}；${[participationStatus(election, party.id), denominatorText(election)].filter(Boolean).join('；')}`);
          row.append(cell);
        });
        const source = element('td', 'ph-source-column');
        source.append(sourceLink(election));
        if (blueMode || selectedMode) source.append(element('small', 'ph-denominator', denominatorText(election)));
        if (election.geographyNote) source.append(element('small', 'ph-geography-note', election.geographyNote));
        row.append(source);
        tbody.append(row);
      });
      table.append(tbody);
      tableScroll.replaceChildren(table);
    }

    function denominatorText(election) {
      if (shareMode === 'selected') {
        if (!active.size) return '未選擇政黨，無法計算比例。';
        const totals = selectedTotals(election, visibleParties());
        if (!totals) return '所選政黨票數資料不完整，無法計算比例。';
        return totals.total ? `分母：所選政黨合計 ${voteText(totals.total)}` : '所選政黨合計 0 票，無法計算比例。';
      }
      if (shareMode !== 'blue-green') return `分母：全部有效票${getValidVotes(election) == null ? '（票數未知）' : ` ${voteText(getValidVotes(election))}`}`;
      const totals = blueGreenTotals(election, blueGreen);
      if (!totals) return '兩黨票數資料不完整，無法計算比例。';
      return totals.total ? `分母：藍綠合計 ${voteText(totals.total)}` : '藍綠合計 0 票，無法計算比例。';
    }

    function getValidVotes(election) {
      const value = election.validVotes;
      return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
    }

    function setShareMode(mode) {
      const next = ['selected', 'blue-green'].includes(mode) ? mode : 'all';
      if (shareMode === next) return;
      shareMode = next;
      update();
      status.textContent = next === 'blue-green' ? '已切換只看藍綠，兩黨合計100%。' : next === 'selected' ? '已切換所選政黨合計100%，可點政黨名稱重新選擇。' : '已切換占全部有效票，恢復原先政黨選擇。';
    }

    update();
    requestAnimationFrame(() => {
      if (chartScroll.isConnected && chartScroll.clientWidth > 0) {
        chartScroll.scrollLeft = chartScroll.scrollWidth - chartScroll.clientWidth;
        viewportWidth = chartScroll.clientWidth;
        followLatest = true;
      }
    });
    return {
      setShareMode,
      getShareMode() { return shareMode; },
      destroy() {
        frameObserver.disconnect();
        tooltipEvents.abort();
        if (focusFrame != null) cancelAnimationFrame(focusFrame);
        dismissTooltip();
        container.replaceChildren(); container.removeAttribute('aria-labelledby');
      },
      setPartyVisible(partyId, visible) {
        const button = buttons.get(String(partyId));
        if (button && active.has(String(partyId)) !== Boolean(visible)) button.click();
      }
    };
  }

  window.PartyHistory = Object.freeze({render});
}());
