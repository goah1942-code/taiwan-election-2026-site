(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const root = $('incumbents-panel');
  if (!root) return;
  const roles = ['president', 'mayor', 'legislator', 'council', 'village'];
  const labels = {president:'總統', mayor:'縣市長', legislator:'立委', council:'議員', village:'里長'};
  const normalize = text => String(text || '').normalize('NFKC').replaceAll('台', '臺').replace(/\s/g, '').toLowerCase();
  let index, office = 'president', rows = [], page = 1, sequence = 0;
  const cache = new Map();
  const pageSize = 30;
  const escape = text => String(text ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function link(id, label) {
    const source = index.sources[id];
    if (!source) return '';
    const url = new URL(source.url);
    if (url.protocol !== 'https:' || !url.hostname.endsWith('.gov.tw')) return '';
    return `<a href="${escape(url.href)}" target="_blank" rel="noopener noreferrer">${escape(label || source.label)}<span aria-hidden="true"> ↗</span><span class="sr-only">（另開分頁）</span></a>`;
  }
  function route() {
    const q = new URLSearchParams(location.search);
    return {office: roles.includes(q.get('office')) ? q.get('office') : 'president', county:q.get('incCounty') || '', district:q.get('incDistrict') || ''};
  }
  function updateUrl() {
    const url = new URL(location.href);
    url.searchParams.set('tab', 'incumbents');
    url.searchParams.set('office', office);
    for (const [key, value] of [['incCounty',$('inc-county').value],['incDistrict',$('inc-district').value]]) {
      if (value) url.searchParams.set(key,value); else url.searchParams.delete(key);
    }
    url.hash = '';
    if (url.href !== location.href) history.pushState(null,'',url);
  }
  function options(select, values, first, preferred='') {
    select.replaceChildren(new Option(first,''), ...values.map(value => new Option(value,value)));
    select.value = values.includes(preferred) ? preferred : '';
  }
  function updateDistrict(preferred='') {
    const county = $('inc-county').value;
    const values = [...new Set(rows.filter(r => !county || r.county === county).map(r => r.district).filter(Boolean))];
    options($('inc-district'),values,'全部鄉鎮市區',preferred);
    $('inc-district-wrap').hidden = office !== 'village';
  }
  function filtered() {
    const county = $('inc-county').value, district = $('inc-district').value;
    const query = normalize($('inc-search').value);
    return rows.filter(r => (!county || r.county === county) && (!district || r.district === district)
      && (!query || normalize([r.name,r.county,r.district,r.area,r.office].join(' ')).includes(query)));
  }
  function render() {
    const items = filtered(), pages = Math.max(1,Math.ceil(items.length/pageSize));
    page = Math.min(page,pages);
    const first = (page-1)*pageSize;
    $('inc-result-heading').textContent = `${labels[office]}名冊`;
    $('inc-status').textContent = items.length ? `找到 ${items.length.toLocaleString('zh-TW')} 人，顯示第 ${first+1}–${Math.min(first+pageSize,items.length)} 人。` : '找不到符合條件的資料，可清除篩選或改用姓名、地區查詢。';
    $('inc-results').innerHTML = items.slice(first,first+pageSize).map(r => `<article class="inc-card">
      <div class="inc-card-top"><h3>${escape(r.name)}</h3><span class="inc-office">${escape(r.office)}</span></div>
      <p class="inc-area">${escape([r.county,r.district,r.area !== r.county ? r.area : ''].filter(Boolean).join(' · '))}</p>
      <p class="inc-party">來源所列黨籍：${escape(r.party === '無' ? '無黨籍（來源：無）' : r.party || '來源未列')}</p>
      ${r.note ? `<p class="inc-note">${escape(r.note)}</p>` : ''}
      <div class="inc-links">${link(r.sourceId,'官方來源')}${r.additionalSourceId ? link(r.additionalSourceId,'代理職務說明') : ''}</div>
    </article>`).join('');
    $('inc-page').textContent = `第 ${page} / ${pages} 頁`;
    $('inc-prev').disabled = page === 1;
    $('inc-next').disabled = page === pages;
    $('inc-pagination').hidden = items.length <= pageSize;
    $('inc-clear').hidden = !$('inc-county').value && !$('inc-district').value && !$('inc-search').value;
  }
  async function fetchJson(path) {
    const response = await fetch(path);
    if (!response.ok) throw new Error('讀取失敗');
    return response.json();
  }
  async function load({office: next, county='', district=''}, writeRoute=false) {
    const request = ++sequence;
    office=next; page=1; rows=[];
    $('inc-search').value='';
    $('inc-filters').hidden=office==='president';
    for (const button of root.querySelectorAll('[data-inc-office]')) button.setAttribute('aria-pressed',String(button.dataset.incOffice===office));
    $('inc-results').replaceChildren();
    $('inc-pagination').hidden=true;
    $('inc-error').hidden=true;
    $('inc-filters').disabled=true;
    $('inc-directory').setAttribute('aria-busy','true');
    $('inc-result-heading').textContent=`${labels[office]}名冊`;
    $('inc-status').textContent='正在載入官方名冊…';
    try {
      index ||= await fetchJson('./incumbents-data/index.json?v=20261018-incumbents-v1');
      if (request !== sequence) return;
      for (const meta of index.offices) root.querySelector(`[data-inc-office="${meta.id}"] small`).textContent=`${meta.count.toLocaleString('zh-TW')} 人`;
      const meta=index.offices.find(x=>x.id===office);
      if (!cache.has(office)) cache.set(office,await fetchJson(meta.path+'?v='+meta.sha256.slice(0,16)));
      if (request !== sequence) return;
      rows=cache.get(office).records;
      options($('inc-county'), [...new Set(rows.map(r=>r.county))], office==='legislator'?'全部選區／類別':'全部縣市',county);
      $('inc-county-wrap').hidden=office==='president';
      $('inc-county-label').textContent=office==='legislator'?'縣市／不分區／原住民':'縣市';
      updateDistrict(district);
      $('inc-checked').textContent=`收錄查核：${index.checkedAt} · 非即時同步`;
      $('inc-source-note').textContent = ['mayor','council','village'].includes(office)
        ? '地方名冊未提供逐筆任免日期；代理職稱依來源保留，缺漏不代表缺額。黨籍為來源所列，可能尚未反映異動。'
        : office==='legislator' ? '依立法院第11屆資料，排除標記為已離職的委員；不分區與原住民選區可另外篩選。' : '依總統府現任總統介紹，顯示就任日期與官方連結。';
      const sourceIds=[...new Set(rows.flatMap(r=>[r.sourceId,r.additionalSourceId].filter(Boolean)))];
      $('inc-sources').innerHTML=sourceIds.map(id=>`<li>${link(id)}${index.sources[id].sourceUpdatedAt ? `（來源日期：${escape(index.sources[id].sourceUpdatedAt)}）` : ''}</li>`).join('');
      $('inc-stale').hidden=Date.now()-Date.parse(index.checkedAt+'T00:00:00+08:00') < 30*86400000;
      if(writeRoute) updateUrl();
      render();
    } catch {
      if(request!==sequence)return;
      rows=[];
      $('inc-status').textContent='名冊暫時無法載入，請重新載入。';
      $('inc-error').hidden=false;
    } finally {
      if(request===sequence){$('inc-filters').disabled=!rows.length;$('inc-directory').setAttribute('aria-busy','false');}
    }
  }
  for(const button of root.querySelectorAll('[data-inc-office]')) button.addEventListener('click',()=>{
    const next=button.dataset.incOffice;
    if(next===office && rows.length)return;
    $('inc-search').value='';
    load({office:next,county:$('inc-county').value},true);
  });
  $('inc-county').addEventListener('change',()=>{page=1;updateDistrict();updateUrl();render();});
  $('inc-district').addEventListener('change',()=>{page=1;updateUrl();render();});
  $('inc-search').addEventListener('input',()=>{page=1;render();});
  $('inc-clear').addEventListener('click',()=>{$('inc-county').value='';$('inc-search').value='';updateDistrict();page=1;updateUrl();render();$('inc-search').focus();});
  for(const [id,delta] of [['inc-prev',-1],['inc-next',1]]) $(id).addEventListener('click',()=>{
    page+=delta;render();$('inc-result-heading').focus();$('inc-result-heading').scrollIntoView({block:'start'});
  });
  $('inc-retry').addEventListener('click',()=>load(route()));
  let opened=false;
  function open() {if(root.hidden)return;if(!opened){opened=true;load(route());}}
  addEventListener('page-tab-change',open);
  addEventListener('popstate',()=>{if(!root.hidden){opened=true;load(route());}});
  open();
})();
