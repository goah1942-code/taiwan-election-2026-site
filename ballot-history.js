/* The previous election for an exact ballot zone, opened without leaving the notice. */
(() => {
  'use strict';
  const cache = new Map();
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const number = value => typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('zh-TW') : '—';
  const percent = value => typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(2)}%` : '—';
  let dialog, content, context, sequence = 0, modalSession = null;

  function sourceUrl(value) {
    try { const url = new URL(value); return url.protocol === 'https:' ? url.href : ''; }
    catch { return ''; }
  }

  async function load({ballot, countyId}) {
    const path = ballot?.zone?.previousPath;
    if (!path) return null;
    if (!/^2022\/\d{5}\/[a-z_]+\/(?:zones|districts)\/[a-f0-9]{12}\.json$/.test(path)
        || !path.startsWith(`2022/${countyId}/${ballot.typeId}/`)) throw new Error('上屆資料路徑無法核對。');
    if (ballot.typeId !== 'village_head' && path !== `2022/${countyId}/${ballot.typeId}/zones/${ballot.zone.id}.json`) {
      throw new Error('上屆資料與目前所選的選區無法核對。');
    }
    if (!cache.has(path)) cache.set(path, fetch(`./data/${path}`).then(response => {
      if (!response.ok) throw new Error('上屆資料暫時無法讀取，請重新開啟後再試。');
      return response.json();
    }).catch(error => { cache.delete(path); throw error; }));
    const payload = await cache.get(path);
    if (payload.year !== 2022 || payload.countyId !== countyId || payload.typeId !== ballot.typeId) {
      throw new Error('上屆資料的年度或選舉種類無法核對。');
    }
    // Village files hold the entire district. Select only this exact village ID.
    const data = ballot.typeId === 'village_head' ? payload.results?.[ballot.zone.id] : payload;
    if (!data || !Array.isArray(data.candidates) || !data.profile) return null;
    return data;
  }

  function resultHtml(data) {
    const source = sourceUrl(data.sourceUrl);
    const profile = data.profile;
    const historicalName = data.sourceZone && !/[\uE000-\uF8FF]/u.test(data.sourceZone) && data.sourceZone !== data.zone ?
      `<small>原始選區名稱：${escape(data.sourceZone)}</small>` : '';
    const candidates = data.candidates.map((candidate, index) => ({candidate, index})).sort((a, b) => {
      const left = typeof a.candidate.votes === 'number' ? a.candidate.votes : -1;
      const right = typeof b.candidate.votes === 'number' ? b.candidate.votes : -1;
      return right - left || a.index - b.index;
    });
    return `<div class="bnh-election"><strong>${escape(data.zone)}</strong><span>${escape(data.electionDate || '2022 年')}${data.electionKind === 'rerun' ? ' · 重行選舉' : ''}</span>${historicalName}</div>
      <div class="bnh-metrics"><div><span>選舉人數</span><strong>${number(profile.eligibleVoters)}</strong></div><div><span>投票數</span><strong>${number(profile.ballotsCast)}</strong></div><div><span>投票率</span><strong>${percent(profile.turnoutPercent)}</strong></div></div>
      <p class="bnh-reading">依得票數由高到低排列。得票率以本選區<strong>全部有效票 ${number(profile.validVotes)} 票</strong>為分母。</p>
      <p class="bnh-scroll-hint">左右滑動表格，可查看得票率與當選結果。</p>
      <div class="bnh-table-scroll" tabindex="0" aria-label="2022 上屆候選人投票結果表，窄螢幕可左右捲動"><table class="bnh-table"><caption>2022 年 ${escape(data.zone)}投票結果</caption><thead><tr><th scope="col">號次</th><th scope="col">候選人</th><th scope="col">推薦政黨</th><th scope="col">得票數</th><th scope="col">得票率</th><th scope="col">結果</th></tr></thead><tbody>${candidates.map(({candidate}) => `<tr class="${candidate.elected === true ? 'bnh-winner' : ''}"><td>${escape(candidate.number ?? '—')}</td><th scope="row">${escape(candidate.name || '姓名未載')}</th><td>${escape(candidate.party || '推薦政黨未載')}</td><td class="bnh-numeric">${number(candidate.votes)}</td><td class="bnh-numeric">${percent(candidate.voteSharePercent)}</td><td><span class="bnh-outcome">${candidate.elected === true ? '當選' : candidate.elected === false ? '未當選' : '—'}</span></td></tr>`).join('')}</tbody></table></div>
      ${!candidates.length ? '<p class="bnh-message">此筆上屆資料未收錄候選人結果。</p>' : ''}
      <div class="bnh-source"><span>有效票 ${number(profile.validVotes)} · 無效票 ${number(profile.invalidVotes)}</span>${source ? `<a href="${escape(source)}" target="_blank" rel="noopener noreferrer">中選會上屆結果來源 ↗</a>` : '<span>來源連結未載</span>'}</div>`;
  }

  function lockBackground() {
    const opener = document.activeElement;
    releaseBackground(false);
    const properties = ['overflow', 'overflow-x', 'overflow-y'];
    modalSession = {
      opener, x: window.scrollX, y: window.scrollY,
      styles: [document.documentElement, document.body].map(node => ({node,
        values: properties.map(name => ({name, value: node.style.getPropertyValue(name), priority: node.style.getPropertyPriority(name)}))})),
    };
    modalSession.styles.forEach(({node}) => node.style.setProperty('overflow', 'hidden', 'important'));
  }

  function releaseBackground(restorePosition = true) {
    const session = modalSession;
    if (!session) return;
    modalSession = null;
    session.styles.forEach(({node, values}) => {
      node.style.removeProperty('overflow');
      node.style.removeProperty('overflow-x');
      node.style.removeProperty('overflow-y');
      values.forEach(({name, value, priority}) => {
        if (value) node.style.setProperty(name, value, priority);
      });
    });
    if (!restorePosition) return;
    const panel = document.getElementById('voting-panel');
    if (panel?.hidden) {
      document.querySelector('[data-page-tab][aria-selected="true"]')?.focus();
      return;
    }
    window.scrollTo({left: session.x, top: session.y, behavior: 'instant'});
    const opener = session.opener;
    if (!opener?.isConnected || opener.closest('[hidden]')) return;
    opener.focus({preventScroll: true});
    const rect = opener.getBoundingClientRect();
    if (rect.top < 0 || rect.bottom > window.innerHeight || rect.left < 0 || rect.right > window.innerWidth) {
      opener.scrollIntoView({block: 'nearest', inline: 'nearest', behavior: 'instant'});
    }
  }

  function reset() {
    sequence += 1;
    if (dialog?.open) dialog.close();
    releaseBackground();
  }

  function ensureDialog() {
    if (dialog) return;
    dialog = document.createElement('dialog');
    dialog.className = 'bn-history-dialog';
    dialog.setAttribute('aria-labelledby', 'bnh-title');
    dialog.setAttribute('aria-describedby', 'bnh-context');
    dialog.innerHTML = `<header class="bnh-header"><div><span>上一次地方選舉</span><h2 id="bnh-title">2022 選舉結果</h2><p id="bnh-context"></p></div><button type="button" class="bnh-close" aria-label="關閉上次選舉結果" autofocus>關閉 <span aria-hidden="true">×</span></button></header><div class="bnh-content" aria-live="polite"></div>`;
    const panel = document.getElementById('voting-panel');
    (panel || document.body).append(dialog);
    content = dialog.querySelector('.bnh-content');
    context = dialog.querySelector('#bnh-context');
    dialog.querySelector('.bnh-close').addEventListener('click', reset);
    dialog.addEventListener('cancel', () => { sequence += 1; });
    dialog.addEventListener('close', () => {
      if (dialog.open) return;
      sequence += 1;
      content.removeAttribute('aria-busy');
      releaseBackground();
      if (panel?.hidden) document.querySelector('[data-page-tab][aria-selected="true"]')?.focus({preventScroll:true});
    });
    if (panel) new MutationObserver(() => { if (panel.hidden) reset(); }).observe(panel, {attributes:true, attributeFilter:['hidden']});
  }

  async function open(options) {
    ensureDialog();
    if (document.getElementById('voting-panel')?.hidden) return;
    const current = ++sequence;
    context.textContent = `${options.ballot.label} · ${options.ballot.zone?.area || options.ballot.zone?.name || ''}`;
    content.innerHTML = '<p class="bnh-message" role="status">正在讀取同選區的 2022 結果…</p>';
    content.setAttribute('aria-busy', 'true');
    if (!dialog.open) {
      lockBackground();
      try { dialog.showModal(); }
      catch (error) { releaseBackground(); throw error; }
    }
    try {
      const data = await load(options);
      if (current !== sequence || !dialog.open) return;
      content.innerHTML = data ? resultHtml(data) : '<p class="bnh-message">此選區沒有可直接對應的 2022 上屆資料。</p>';
    } catch (error) {
      if (current !== sequence || !dialog.open) return;
      content.innerHTML = `<p class="bnh-message" role="alert">${escape(error.message || '上屆結果讀取失敗，請稍後再試。')}</p>`;
    } finally {
      if (current === sequence) content.removeAttribute('aria-busy');
    }
  }

  window.ElectionBallotHistory = {open, reset, load};
})();
