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

  const officeLabels = {mayor:'縣市長', council:'議員', village:'村里長', president:'總統', legislator:'立委'};
  function contextLabel(value) {
    return [value?.countyName || '全台', officeLabels[value?.office] || '選舉職務'].join('／');
  }
  function makeReturnButton(from) {
    const back=document.createElement('button');back.type='button';back.className='page-context-back';
    back.textContent=from==='incumbents'?'返回剛才的現任者':'返回剛才的候選人';
    back.addEventListener('click',()=>activate(from,{historyMode:'push',restore:true}));
    return back;
  }
  function clearContextReturn() {
    document.querySelectorAll('.page-context-back,.page-context-return').forEach(node=>node.remove());
    document.getElementById('query-navigation')?.classList.remove('has-context-return');
    for(const panel of Object.values(panels))panel.classList.remove('has-context-return');
  }
  function syncContextReturn(next, placement='preserve') {
    const from=new URLSearchParams(location.search).get('returnTo');
    const valid=next==='candidates'&&from==='incumbents'||next==='incumbents'&&from==='candidates';
    if(!valid){clearContextReturn();return;}
    const notice=panels[next].querySelector('.page-context-notice');
    const existing=panels[next].querySelector('.page-context-back');
    if(notice&&placement==='preserve'&&existing)return;
    if(notice&&placement==='inline'){
      clearContextReturn();notice.append(makeReturnButton(from));return;
    }
    clearContextReturn();
    const back=makeReturnButton(from),queryNav=document.getElementById('query-navigation');
    if(next==='candidates'&&queryNav&&!queryNav.hidden){
      queryNav.insertBefore(back,document.getElementById('query-action-menu'));
      queryNav.classList.add('has-context-return');
    }else{
      const bar=document.createElement('nav');bar.className='page-context-return';
      bar.setAttribute('aria-label','跨分頁返回');bar.append(back);
      panels[next].querySelector('.intro')?.after(bar);
      panels[next].classList.add('has-context-return');
    }
  }
  function settleContextNotice(key) {
    if(document.body.dataset.activeTab!==key)return;
    panels[key]?.querySelector('.page-context-notice')?.remove();
    syncContextReturn(key);
  }
  function pinContextReturn(key) {
    if(document.body.dataset.activeTab!==key)return;
    syncContextReturn(key,'fixed');
  }
  window.ElectionPageTabs=Object.freeze({settleContextNotice,pinContextReturn});

  let contextScrollFrame=null;
  addEventListener('scroll',()=>{
    if(contextScrollFrame!==null)return;
    contextScrollFrame=requestAnimationFrame(()=>{
      contextScrollFrame=null;
      const key=document.body.dataset.activeTab,panel=panels[key];
      const notice=panel?.querySelector('.page-context-notice');
      const back=panel?.querySelector('.page-context-back');
      if(!notice||!back)return;
      const box=notice.getBoundingClientRect(),inline=notice.contains(back);
      // Separate thresholds avoid oscillating when moving the button changes height.
      const pin=inline&&box.bottom<=8;
      const unpin=!inline&&box.top>=24&&box.bottom<=window.innerHeight-8;
      if(!pin&&!unpin)return;
      const active=document.activeElement;
      const restoreFocus=active===back;
      syncContextReturn(key,pin?'fixed':'inline');
      if(restoreFocus)panel.querySelector('.page-context-back')?.focus({preventScroll:true});
    });
  },{passive:true});

  function showContextNotice(next, from, context, moveFocus = true, applied = false) {
    for (const panel of Object.values(panels)) panel.querySelector('.page-context-notice')?.remove();
    clearContextReturn();
    if (!context || !['candidates','incumbents'].includes(next) || !['candidates','incumbents'].includes(from)) return;
    const supported = ['mayor','council','village'].includes(context.office);
    const destination = next === 'candidates' ? '2026登記資料' : '現任名冊快照';
    const current = next === 'candidates' ? window.ElectionCandidateContext?.get() : window.ElectionIncumbentContext?.get();
    let message;
    if (applied) message = `已接續${contextLabel(context)}，現在查看${destination}。${context.office === 'mayor' ? '縣市長以條列名單顯示。' : '請依這個時點的範圍選擇選區；不同年度不以同號自動配對。'}`;
    else if (!supported) message = next === 'candidates'
      ? `你剛才查看的是現任${officeLabels[context.office] || '公職'}。這裡收錄2026九合一登記資料，沒有總統或立委候選名單；下方保留先前的地方選舉查詢。`
      : '這個職務尚無對應的現任名冊；下方保留先前的現任者查詢，請選擇已收錄的職務。';
    else message = `剛才：${contextLabel(context)}。下方保留本分頁的${contextLabel(current)}查詢。${context.countyId ? '可用下方按鈕接續剛才的縣市與職務，再依各屆範圍選區。' : '請先選定縣市；現任名冊與2026登記資料為不同時點。'}`;
    const notice = document.createElement('section');notice.className = 'page-context-notice';notice.tabIndex = -1;
    notice.setAttribute('aria-label', '跨分頁查詢說明');
    const text = document.createElement('p');text.textContent = message;notice.append(text);
    if (!applied && supported && context.countyId) {
      const carry = document.createElement('button');carry.type = 'button';carry.className = 'page-context-carry';
      carry.textContent = `接續${context.countyName}${officeLabels[context.office]}${next === 'candidates' ? '候選人' : '現任名冊'}`;
      carry.addEventListener('click', () => {
        const url = new URL(location.href);
        if (next === 'candidates') {
          url.searchParams.delete('tab');url.searchParams.set('county', context.countyId);url.searchParams.set('type', context.office);url.searchParams.set('view','county');
          for (const key of ['district','zone']) url.searchParams.delete(key);
        } else {
          url.searchParams.set('tab','incumbents');url.searchParams.set('office',context.office);url.searchParams.set('incCounty',context.countyName);url.searchParams.set('incView','list');
          for (const key of ['incDistrict','incArea','statCounty','statBallot','historyType','historyYear']) url.searchParams.delete(key);
        }
        url.hash='';if(url.href!==location.href)history.pushState(null,'',url);
        showContextNotice(next,from,context,true,true);
        window.dispatchEvent(new CustomEvent('page-tab-change',{detail:{tab:next,fromTab:from,contextChanged:true}}));
      });
      notice.append(carry);
    }
    notice.append(makeReturnButton(from));panels[next].querySelector('.intro')?.after(notice);
    if(moveFocus)requestAnimationFrame(()=>{if(!panels[next].hidden&&notice.isConnected){notice.focus({preventScroll:true});notice.scrollIntoView({block:'start'});}});
  }

  function activate(key, {historyMode, focus = false, restore = false} = {}) {
    const next = Object.hasOwn(panels, key) ? key : 'candidates';
    const previousTab = document.body.dataset.activeTab;
    const userTransition = historyMode === 'push' && previousTab && previousTab !== next;
    const context = userTransition && !restore ? (previousTab === 'incumbents'
      ? window.ElectionIncumbentContext?.get() : previousTab === 'candidates' ? window.ElectionCandidateContext?.get() : null) : null;
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
      if(userTransition){
        if(!restore&&['candidates','incumbents'].includes(previousTab)&&['candidates','incumbents'].includes(next))url.searchParams.set('returnTo',previousTab);
        else url.searchParams.delete('returnTo');
      }
      if (next !== 'candidates') url.searchParams.set('tab', next);
      else url.searchParams.delete('tab');
      if (hashPanel() && hashPanel() !== next) url.hash = '';
      if (url.href !== location.href) history[historyMode === 'push' ? 'pushState' : 'replaceState'](null, '', url);
    }
    if (focus || focusWasHidden) tabs.find(tab => tab.dataset.pageTab === next).focus({preventScroll: true});
    if(userTransition||!historyMode)showContextNotice(next,previousTab,context,!focus);
    syncContextReturn(next);
    window.dispatchEvent(new CustomEvent('page-tab-change', {detail:{tab:next,fromTab:previousTab,restore:Boolean(restore)}}));
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
