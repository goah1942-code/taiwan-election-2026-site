(() => {
  'use strict';
  const tabs = [...document.querySelectorAll('[data-page-tab]')];
  const panels = Object.fromEntries(tabs.map(tab => [tab.dataset.pageTab, document.getElementById(tab.getAttribute('aria-controls'))]));
  if (!tabs.length || Object.values(panels).some(panel => !panel)) return;

  function hashPanel() {
    if (['#ballot-notice', '#ballot-notice-heading', '#bn-result-heading', '#bn-print-notice', '#voting-page-title'].includes(location.hash)) return 'voting';
    try {
      const target = document.getElementById(decodeURIComponent(location.hash.slice(1)));
      for (const [key, panel] of Object.entries(panels)) if (target && panel.contains(target)) return key;
    } catch { /* Malformed fragments leave the selected tab unchanged. */ }
    return null;
  }

  function routeTab() {
    const key = new URLSearchParams(location.search).get('tab');
    return hashPanel() || (Object.hasOwn(panels, key) ? key : 'candidates');
  }

  function activate(key, {historyMode, focus = false} = {}) {
    const next = Object.hasOwn(panels, key) ? key : 'candidates';
    const activeElement = document.activeElement;
    const focusWasHidden = Object.entries(panels).some(([name, panel]) => name !== next && panel.contains(activeElement));
    for (const tab of tabs) {
      const selected = tab.dataset.pageTab === next;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
    }
    for (const [name, panel] of Object.entries(panels)) panel.hidden = name !== next;
    document.body.dataset.activeTab = next;
    const phase = document.getElementById('site-data-phase');
    if (phase) phase.textContent = next === 'incumbents' ? '資料：現任名冊快照' : '資料階段：候選人登記';

    if (historyMode) {
      const url = new URL(location.href);
      if (next !== 'candidates') url.searchParams.set('tab', next);
      else url.searchParams.delete('tab');
      if (hashPanel() && hashPanel() !== next) url.hash = '';
      if (url.href !== location.href) history[historyMode === 'push' ? 'pushState' : 'replaceState'](null, '', url);
    }
    if (focus || focusWasHidden) tabs.find(tab => tab.dataset.pageTab === next).focus({preventScroll: true});
    window.dispatchEvent(new CustomEvent('page-tab-change', {detail: {tab: next}}));
    if (next === 'candidates') requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
  }

  for (const [index, tab] of tabs.entries()) {
    tab.addEventListener('click', () => activate(tab.dataset.pageTab, {historyMode: 'push'}));
    tab.addEventListener('keydown', event => {
      let next;
      if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
      else if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = tabs.length - 1;
      else return;
      event.preventDefault();
      activate(tabs[next].dataset.pageTab, {historyMode: 'push', focus: true});
    });
  }
  addEventListener('popstate', () => activate(routeTab()));
  addEventListener('hashchange', () => activate(routeTab(), {historyMode: 'replace'}));
  activate(routeTab(), {historyMode: 'replace'});
})();
