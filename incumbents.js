(() => {
  'use strict';
  const $ = id => document.getElementById(id), root = $('incumbents-panel');
  if (!root) return;
  const roles = ['president', 'mayor', 'legislator', 'council', 'village'];
  const labels = {president:'總統', mayor:'縣市長', legislator:'立委', council:'議員', village:'里長'};
  const normalize = text => String(text || '').normalize('NFKC').replaceAll('台', '臺').replace(/\s/g, '').toLowerCase();
  const collator = new Intl.Collator('zh-Hant', {numeric:true});
  // A village is identified by both its administrative district and its name.
  function groupRows(records, office, county, district='') {
    const groups = new Map();
    for (const row of records) {
      if (normalize(row.county) !== normalize(county) || (district && row.district !== district)) continue;
      const key = JSON.stringify([row.district, row.area]);
      if (!groups.has(key)) groups.set(key, {key, district:row.district, area:row.area,
        label:office === 'village' ? [row.district,row.area].filter(Boolean).join(' · ') : (/^第/.test(row.area.replace(county,'')) ? row.area.replace(county,'') : row.area),
        rows:[]});
      groups.get(key).rows.push(row);
    }
    return [...groups.values()].sort((a,b)=>collator.compare(a.district,b.district)||collator.compare(a.area,b.area));
  }
  function matches(row, query) {
    return !query || normalize([row.name,row.county,row.district,row.area,row.office].join(' ')).includes(normalize(query));
  }
  let index, counties=[], geometry, mapPending, office='president', rows=[], county='', district='', area='', view='list', page=1, sequence=0;
  const cache = new Map(), pageSize=30;
  const hierarchical = () => ['legislator','council','village'].includes(office);
  const countyCount = name => rows.filter(r=>normalize(r.county)===normalize(name)).length;
  const escape = text => String(text ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function link(id,label) {
    const source=index.sources[id];
    if (!source) return '';
    const url=new URL(source.url);
    if (url.protocol!=='https:' || !url.hostname.endsWith('.gov.tw')) return '';
    return `<a href="${escape(url.href)}" target="_blank" rel="noopener noreferrer">${escape(label||source.label)}<span aria-hidden="true"> ↗</span><span class="sr-only">（另開分頁）</span></a>`;
  }
  function route() {
    const q=new URLSearchParams(location.search);
    return {office:roles.includes(q.get('office'))?q.get('office'):'president',county:q.get('incCounty')||'',district:q.get('incDistrict')||'',area:q.get('incArea')||'',view:q.get('incView')==='map'?'map':'list'};
  }
  function updateUrl(replace=false) {
    const url=new URL(location.href);
    url.searchParams.set('tab','incumbents');url.searchParams.set('office',office);
    for (const [key,value] of [['incCounty',county],['incDistrict',district],['incArea',area],['incView',hierarchical()?view:'']]) {
      if (value) url.searchParams.set(key,value); else url.searchParams.delete(key);
    }
    url.hash='';
    if (url.href!==location.href) history[replace?'replaceState':'pushState'](null,'',url);
  }
  function focusHeading(id) {
    if (root.hidden) return;
    requestAnimationFrame(()=>{if(!root.hidden){$(id).focus({preventScroll:true});$(id).scrollIntoView({block:'start',behavior:'auto'});}});
  }
  function configureDistrict() {
    const values=[...new Set(rows.filter(r=>normalize(r.county)===normalize(county)).map(r=>r.district).filter(Boolean))].sort(collator.compare);
    $('inc-district').replaceChildren(new Option('全部鄉鎮市區',''),...values.map(v=>new Option(v,v)));
    if (!values.includes(district)) district='';
    $('inc-district').value=district;
    $('inc-district-wrap').hidden=office!=='village';
  }
  function groups() {
    const query=$('inc-search').value;
    return groupRows(rows,office,county,district).filter(g=>g.rows.some(r=>matches(r,query)));
  }
  function chooseCounty(name) {
    county=name;district='';area='';page=1;$('inc-search').value='';
    configureDistrict();render();updateUrl();focusHeading('inc-selected-heading');
  }
  function renderCountyList() {
    const query=normalize($('inc-search').value);
    const visible=counties.filter(c=>normalize(c.name).includes(query));
    $('inc-county-list').replaceChildren(...visible.map(c=>{
      const button=document.createElement('button');button.type='button';button.dataset.incCounty=c.name;
      button.innerHTML=`<strong>${escape(c.name)}</strong><span>收錄 ${countyCount(c.name).toLocaleString('zh-TW')} 人</span>`;
      button.addEventListener('click',()=>chooseCounty(c.name));return button;
    }));
    $('inc-county-status').textContent=visible.length===22?'全台 22 縣市，選擇後查看選區與名單。':visible.length?`符合 ${visible.length} 個縣市。`:'找不到此縣市，請調整搜尋文字。';
    const special=office==='legislator'?[...new Set(rows.map(r=>r.county))].filter(name=>!counties.some(c=>normalize(c.name)===normalize(name))):[];
    $('inc-national-options').hidden=!special.length;
    $('inc-national-list').replaceChildren(...special.map(name=>{
      const button=document.createElement('button');button.type='button';button.textContent=`${name} · ${countyCount(name)} 人`;button.addEventListener('click',()=>chooseCounty(name));return button;
    }));
    for(const button of root.querySelectorAll('[data-inc-view]'))button.setAttribute('aria-pressed',String(button.dataset.incView===view));
    $('inc-county-list').hidden=view==='map';$('inc-county-map').hidden=view!=='map';
    if(view==='map')ensureMap();
  }
  const svgNode=(tag,attributes={},text)=>{
    const element=document.createElementNS('http://www.w3.org/2000/svg',tag);
    for(const [key,value] of Object.entries(attributes))element.setAttribute(key,String(value));
    if(text!=null)element.textContent=text;return element;
  };
  function renderMap() {
    const svg=svgNode('svg',{viewBox:geometry.viewBox,role:'group','aria-labelledby':'inc-map-title inc-map-description'});
    svg.append(svgNode('title',{id:'inc-map-title'},'現任者查詢：台灣22縣市地圖'),svgNode('desc',{id:'inc-map-description'},'選擇縣市後查看選區與名單。Tab移至縣市，Enter或空白鍵選擇。離島另框放大。'));
    for(const region of geometry.regions||[]){
      if(!region.isInset||!region.frame)continue;
      const {x,y,width,height}=region.frame;
      svg.append(svgNode('rect',{x,y,width,height,rx:10,class:'inc-map-frame','aria-hidden':'true'}),svgNode('text',{x:x+10,y:y+20,class:'inc-map-region','aria-hidden':'true'},region.title||region.name));
      const inset=region.transforms?.find(t=>t.id==='wuqiu');
      if(inset?.frame)svg.append(svgNode('text',{x:inset.frame.x+inset.frame.width/2,y:inset.frame.y-4,'text-anchor':'middle',class:'inc-map-inset','aria-hidden':'true'},'烏坵'));
    }
    const shapes=svgNode('g'),mapLabels=svgNode('g',{'aria-hidden':'true'});
    for(const shape of geometry.counties){
      const item=counties.find(c=>c.id===shape.id);if(!item)continue;
      const node=svgNode('g',{role:'button',tabindex:0,'data-inc-map-county':item.name,'aria-label':`${item.name}，查看${labels[office]}選區與名單`,class:'inc-map-county'});
      node.append(svgNode('path',{d:shape.path,'fill-rule':'evenodd',class:'inc-map-shape'}));
      const {x,y}=shape.label;const label=svgNode('g',{class:'inc-map-label-group'});
      if(shape.anchor&&Math.hypot(x-shape.anchor.x,y-shape.anchor.y)>24)label.append(svgNode('line',{x1:x,y1:y,x2:shape.anchor.x,y2:shape.anchor.y,class:'inc-map-leader'}));
      label.append(svgNode('rect',{x:x-31,y:y-13,width:62,height:26,rx:4}),svgNode('text',{x,y,'text-anchor':'middle','dominant-baseline':'central'},item.name));
      const eligible=!normalize($('inc-search').value)||normalize(item.name).includes(normalize($('inc-search').value));
      node.style.opacity=label.style.opacity=eligible?'1':'.18';node.setAttribute('tabindex',eligible?'0':'-1');node.setAttribute('aria-disabled',String(!eligible));
      const choose=()=>{if(eligible)chooseCounty(item.name);};
      node.addEventListener('click',choose);label.addEventListener('click',choose);
      node.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();choose();}});
      for(const target of [node,label]){
        target.addEventListener('pointerenter',()=>{node.classList.add('is-hovered');label.classList.add('is-hovered');});
        target.addEventListener('pointerleave',()=>{node.classList.remove('is-hovered');label.classList.remove('is-hovered');});
      }
      node.addEventListener('focus',()=>label.classList.add('is-focused'));node.addEventListener('blur',()=>label.classList.remove('is-focused'));
      shapes.append(node);mapLabels.append(label);
    }
    svg.append(shapes,mapLabels);$('inc-map-canvas').replaceChildren(svg);$('inc-map-canvas').setAttribute('aria-busy','false');
    const source=geometry.source;
    $('inc-map-source').textContent=`圖資：${source?.name||source?.title||'內政部縣市界線'}；地圖僅用於選擇縣市，選區依名冊列載。`;
  }
  async function ensureMap() {
    if(geometry){renderMap();return;}
    if(mapPending)return;
    $('inc-map-canvas').setAttribute('aria-busy','true');$('inc-map-canvas').textContent='正在載入縣市地圖…';
    mapPending=fetchJson('./assets/taiwan-counties.json');
    try{
      const data=await mapPending;
      if(data.counties?.length!==22||data.counties.some(c=>!c.path||!c.label||!counties.some(x=>x.id===c.id)))throw Error('圖資不完整');
      geometry=data;if(view==='map'&&!county&&hierarchical())renderMap();
    }catch{
      const p=document.createElement('p');p.textContent='地圖暫時無法載入，可改用列表選擇縣市。';
      const retry=document.createElement('button');retry.type='button';retry.textContent='重新載入地圖';retry.addEventListener('click',ensureMap);
      const list=document.createElement('button');list.type='button';list.textContent='改用列表顯示';list.addEventListener('click',()=>{view='list';render();updateUrl();});
      $('inc-map-canvas').replaceChildren(p,retry,list);$('inc-map-canvas').setAttribute('aria-busy','false');
    }finally{mapPending=null;}
  }
  function personMarkup(r) {
    const party=r.party==='無'?'無黨籍（來源：無）':r.party||'來源未列';
    if(office==='president')return `<li class="inc-card"><div class="inc-card-top"><h3>${escape(r.name)}</h3><span class="inc-office">${escape(r.office)}</span></div><p class="inc-area">${escape(r.area)}</p><p class="inc-note">${escape(r.note)}</p><div class="inc-links">${link(r.sourceId,'官方來源')}</div></li>`;
    return `<li class="inc-person-row">${office==='mayor'?`<strong class="inc-person-county">${escape(r.county)}</strong>`:''}<h3>${escape(r.name)}</h3><span class="inc-person-office">${escape(r.office)}</span><span class="inc-person-party"><small>來源所列黨籍</small>${escape(party)}</span><div class="inc-links">${link(r.sourceId,'官方來源')}${r.additionalSourceId?link(r.additionalSourceId,'代理職務說明'):''}</div>${r.note?`<p class="inc-person-note">${escape(r.note)}</p>`:''}</li>`;
  }
  function renderResults(items,total=items.length) {
    const pages=Math.max(1,Math.ceil(items.length/pageSize));page=Math.min(page,pages);const first=(page-1)*pageSize;
    $('inc-status').textContent=items.length?`${total===items.length?'共':'選區共 '+total+' 人，符合搜尋'} ${items.length.toLocaleString('zh-TW')} 人${items.length>pageSize?`，顯示第 ${first+1}–${Math.min(first+pageSize,items.length)} 人`:''}。`:'沒有符合條件的名冊資料。可清除搜尋或更換選區。';
    $('inc-results').className=office==='president'?'inc-results':'inc-person-list'+(office==='mayor'?' inc-mayor-list':'');
    $('inc-results').innerHTML=items.slice(first,first+pageSize).map(personMarkup).join('');
    $('inc-page').textContent=`第 ${page} / ${pages} 頁`;$('inc-prev').disabled=page===1;$('inc-next').disabled=page===pages;$('inc-pagination').hidden=items.length<=pageSize;
  }
  function render() {
    const browsing=hierarchical()&&!county, selected=hierarchical()&&Boolean(county), query=$('inc-search').value;
    $('inc-directory').dataset.stage=browsing?'county':selected?'district':'flat';
    $('inc-result-heading').textContent=browsing?`選擇縣市 · ${labels[office]}`:selected?`${county} · ${labels[office]}`:`${labels[office]}名冊`;
    $('inc-county-browser').hidden=!browsing;$('inc-workspace').hidden=browsing;$('inc-zone-sidebar').hidden=!selected;$('inc-return-counties').hidden=!selected;
    $('inc-filters').hidden=office==='president';$('inc-search-label').textContent=browsing?'搜尋縣市':selected?'搜尋本縣市姓名或選區':'搜尋縣市長姓名或縣市';
    $('inc-search').placeholder=browsing?'例如：新北市、澎湖縣':selected?'輸入姓名、選區或村里名':'例如：臺北市、姓名';
    $('inc-clear').hidden=!query;
    if(browsing){renderCountyList();return;}
    $('inc-workspace').classList.toggle('has-sidebar',selected);$('inc-change-zone').hidden=!selected;
    if(selected){
      $('inc-sidebar-county').textContent=county;
      const list=$('inc-zone-list'),oldScroll=list.scrollTop;
      const available=groups();if(!available.some(g=>g.key===area))area=available[0]?.key||'';
      const current=available.find(g=>g.key===area);
      $('inc-zone-heading').textContent=office==='village'?'村里選區列表':'選區列表';
      $('inc-zone-count').textContent=`${available.length} 個${office==='village'?'村里':'選區'}${query?'符合搜尋':''}`;
      list.replaceChildren(...available.map(group=>{
        const button=document.createElement('button');button.type='button';button.dataset.incArea=group.key;button.setAttribute('aria-pressed',String(group.key===area));
        button.innerHTML=`<strong>${escape(group.label)}</strong><small>收錄 ${group.rows.length} 人${group.key===area?' · 目前':''}</small>`;
        button.addEventListener('click',()=>{area=group.key;page=1;render();updateUrl();focusHeading('inc-selected-heading');});return button;
      }));list.scrollTop=oldScroll;
      const activeButton=list.querySelector('[aria-pressed=true]');
      if(activeButton&&list.clientHeight){
        if(activeButton.offsetTop<list.scrollTop)list.scrollTop=activeButton.offsetTop;
        else if(activeButton.offsetTop+activeButton.offsetHeight>list.scrollTop+list.clientHeight)list.scrollTop=activeButton.offsetTop+activeButton.offsetHeight-list.clientHeight;
      }
      $('inc-selected-heading').textContent=current?`${current.label} · 現任${labels[office]}`:'沒有符合條件的選區';
      $('inc-selected-context').textContent=current?`${county}${office==='village'?' · 村里依行政區分開列出':' · 選區名稱依現任名冊列載'}`:'請調整搜尋或行政區。';
      renderResults(current?current.rows.filter(r=>matches(r,query)):[],current?.rows.length||0);
    }else{
      $('inc-selected-heading').textContent=office==='mayor'?'全台縣市長條列名單':'現任總統';
      $('inc-selected-context').textContent='';renderResults(rows.filter(r=>matches(r,query)));
    }
  }
  async function fetchJson(path) {const response=await fetch(path);if(!response.ok)throw Error('讀取失敗');return response.json();}
  async function load(next,writeRoute=false) {
    const request=++sequence;office=next.office;county=next.county||'';district=next.district||'';area=next.area||'';view=next.view||view;page=1;rows=[];
    $('inc-search').value='';$('inc-directory').setAttribute('aria-busy','true');$('inc-filters').disabled=true;
    $('inc-county-browser').hidden=true;$('inc-workspace').hidden=false;$('inc-workspace').classList.remove('has-sidebar');$('inc-zone-sidebar').hidden=true;$('inc-return-counties').hidden=true;
    $('inc-results').replaceChildren();$('inc-pagination').hidden=true;$('inc-error').hidden=true;$('inc-status').textContent='正在載入官方名冊…';$('inc-selected-heading').textContent=`${labels[office]}名冊`;
    for(const button of root.querySelectorAll('[data-inc-office]'))button.setAttribute('aria-pressed',String(button.dataset.incOffice===office));
    try{
      const results=await Promise.all([index?Promise.resolve(index):fetchJson('./incumbents-data/index.json?v=20261018-incumbents-v1'),counties.length?Promise.resolve(counties):fetchJson('./data/counties.json').then(x=>x.counties)]);
      if(request!==sequence)return;[index,counties]=results;
      for(const meta of index.offices)root.querySelector(`[data-inc-office="${meta.id}"] small`).textContent=`${meta.count.toLocaleString('zh-TW')} 人`;
      const meta=index.offices.find(x=>x.id===office);if(!cache.has(office))cache.set(office,await fetchJson(meta.path+'?v='+meta.sha256.slice(0,16)));
      if(request!==sequence)return;rows=cache.get(office).records;
      const valid=[...counties.map(c=>c.name),...(office==='legislator'?[...new Set(rows.map(r=>r.county))]:[])];
      county=hierarchical()?(valid.find(name=>normalize(name)===normalize(county))||''):'';
      configureDistrict();
      $('inc-checked').textContent=`收錄查核：${index.checkedAt} · 非即時同步`;
      $('inc-source-note').textContent=['mayor','council','village'].includes(office)?'地方名冊未提供逐筆任免日期；代理職稱依來源保留，缺漏不代表缺額。黨籍為來源所列，可能尚未反映異動。':office==='legislator'?'依立法院第11屆資料，排除已離職者；不分區與原住民名單另列，不依縣市分配。':'依總統府現任總統介紹，顯示就任日期與官方連結。';
      const sources=[...new Set(rows.flatMap(r=>[r.sourceId,r.additionalSourceId].filter(Boolean)))];$('inc-sources').innerHTML=sources.map(id=>`<li>${link(id)}${index.sources[id].sourceUpdatedAt?`（來源日期：${escape(index.sources[id].sourceUpdatedAt)}）`:''}</li>`).join('');
      $('inc-stale').hidden=Date.now()-Date.parse(index.checkedAt+'T00:00:00+08:00')<30*86400000;
      render();if(writeRoute)updateUrl();
    }catch{if(request!==sequence)return;rows=[];$('inc-status').textContent='名冊暫時無法載入，請重新載入。';$('inc-error').hidden=false;}
    finally{if(request===sequence){$('inc-filters').disabled=!rows.length;$('inc-directory').setAttribute('aria-busy','false');}}
  }
  for(const button of root.querySelectorAll('[data-inc-office]'))button.addEventListener('click',()=>{const next=button.dataset.incOffice;if(next===office&&rows.length)return;load({office:next,view},true);});
  for(const button of root.querySelectorAll('[data-inc-view]'))button.addEventListener('click',()=>{view=button.dataset.incView;$('inc-search').value='';render();updateUrl();});
  $('inc-return-counties').addEventListener('click',()=>{county='';district='';area='';page=1;$('inc-search').value='';render();updateUrl();focusHeading('inc-result-heading');});
  $('inc-change-zone').addEventListener('click',()=>focusHeading('inc-zone-heading'));
  $('inc-district').addEventListener('change',()=>{district=$('inc-district').value;area='';page=1;render();updateUrl();});
  $('inc-search').addEventListener('input',()=>{page=1;render();if(county)updateUrl(true);});
  $('inc-clear').addEventListener('click',()=>{$('inc-search').value='';page=1;render();if(county)updateUrl(true);$('inc-search').focus();});
  for(const [id,delta] of [['inc-prev',-1],['inc-next',1]])$(id).addEventListener('click',()=>{page+=delta;render();focusHeading('inc-selected-heading');});
  $('inc-retry').addEventListener('click',()=>load({office,county,district,area,view}));
  let opened=false;function open(){if(!root.hidden&&!opened){opened=true;load(route());}}
  addEventListener('page-tab-change',open);addEventListener('popstate',()=>{if(!root.hidden){opened=true;load(route());}});open();
})();
