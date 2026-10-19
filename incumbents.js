(() => {
  'use strict';
  const $ = id => document.getElementById(id), root = $('incumbents-panel');
  if (!root) return;
  const roles = ['president', 'mayor', 'legislator', 'council', 'village'];
  const labels = {president:'總統', mayor:'縣市長', legislator:'立委', council:'議員', village:'里長'};
  const officeGuide={"president":{"short":"國家元首","description":"代表國家，依憲法行使總統職權。","source":"https://www.president.gov.tw/POP/286","sourceLabel":"總統府：總統職權","flow":"直接看現任總統，或查看全台政黨票數與歷年變化。"},"mayor":{"short":"縣市行政首長","description":"統籌縣市行政與地方施政。","source":"https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=A0040003","sourceLabel":"地方制度法第55、56條","flow":"從條列名冊找縣市，再看該縣市政黨分布與歷年變化。"},"legislator":{"short":"中央民意代表","description":"在立法院審議法律與中央預算。","source":"https://www.ly.gov.tw/EngPages/Detail.aspx?nodeid=161&pid=10","sourceLabel":"立法院：職權","flow":"先選縣市，再選立委選區；不分區與原住民名單有獨立入口。"},"council":{"short":"地方民意代表","description":"在地方議會審議自治法規與縣市預算。","source":"https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=A0040003","sourceLabel":"地方制度法第35、36條","flow":"先選縣市，再明確選擇議員選區。"},"village":{"short":"村里公共事務","description":"辦理村里公務及公所交辦事項。","source":"https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=A0040003","sourceLabel":"地方制度法第59條","flow":"先選縣市和鄉鎮市區，再明確選擇村里。"}};
  const normalize = text => String(text || '').normalize('NFKC').replaceAll('台', '臺').replace(/\s/g, '').toLowerCase();
  const collator = new Intl.Collator('zh-Hant', {numeric:true});
  function geographicRow(row,role,geography){
    const found=role==='legislator'?geography?.areas?.[row.area]:geography?.areas?.[row.county]?.[row.area];
    const range=found&&normalize(found.officialArea).startsWith(normalize(row.county))?found:undefined;
    const special=role==='legislator'?({'全國不分區及僑居國外國民':'不分區立委','平地原住民選舉區':'平地原住民立委','山地原住民選舉區':'山地原住民立委'}[row.county]||''):'';
    const scope=range?.scope||'',number=Number(range?.officialArea?.match(/第(\d+)選舉區/)?.[1]);
    const kind=scope?(role==='legislator'?'區域立委':scope.includes('山地原住民')?'山地原住民議員':scope.includes('平地原住民')?'平地原住民議員':'區域議員'):special;
    return {...row,scope,scopeName:range?.officialArea||'',scopeNumber:Number.isFinite(number)&&number>0?number:null,
      scopeKind:kind,scopeMode:scope?'geographic':special?'national':'unknown',
      scopeCountywide:role==='council'&&['平地','山地'].some(kind=>normalize(scope)===normalize(row.county)+'之'+kind+'原住民'),
      scopeSourceURL:scope?geography.sourceURL+(range.sourcePages?.length?'#page='+range.sourcePages[0]:''):''};
  }
  // A village is identified by both its administrative district and its name.
  function groupRows(records, office, county, district='') {
    const groups = new Map();
    for (const row of records) {
      if (normalize(row.county) !== normalize(county) || (district && row.district !== district)) continue;
      const key = JSON.stringify([row.district, row.area]);
      if (!groups.has(key)) groups.set(key, {key, district:row.district, area:row.area,
        label:office === 'village' ? [row.district,(!row.area||normalize(row.area)===normalize(row.county))?'村里待確認':row.area].filter(Boolean).join(' · ') : (/^第/.test(row.area.replace(county,'')) ? row.area.replace(county,'') : row.area),
        scope:row.scope||'',scopeCountywide:Boolean(row.scopeCountywide),scopeName:row.scopeName||'',scopeKind:row.scopeKind||'',scopeMode:row.scopeMode||'unknown',scopeNumber:row.scopeNumber??null,scopeSourceURL:row.scopeSourceURL||'', rows:[]});
      groups.get(key).rows.push(row);
    }
    return [...groups.values()].sort((a,b)=>collator.compare(a.district,b.district)||((a.scopeNumber??Infinity)-(b.scopeNumber??Infinity))||collator.compare(a.area,b.area));
  }
  function matches(row, query) {
    return !query || normalize([row.name,row.county,row.district,row.area,row.office,row.scope,row.scopeName].join(' ')).includes(normalize(query));
  }
  function searchGroups(available,query){
    const text=normalize(query);
    const exactName=Boolean(text)&&available.some(group=>group.rows.some(row=>normalize(row.name)===text));
    const geographicSearch=Boolean(text)&&!exactName&&available.some(group=>{
      if(group.scopeMode!=='geographic'||group.scopeCountywide)return false;
      const geography=normalize(group.scope).replace(/之(?:平地|山地)原住民.*$/,'').replace(/等\d+[里村]$/,'');
      return geography.split(/[、，,；;及－—：:（）()]/u).some(name=>/^[\p{Script=Han}]+[區鄉鎮市里村]$/u.test(name)&&(name===text||(Array.from(name.slice(0,-1)).length>=2&&name.slice(0,-1)===text)));
    });
    return available.map(group=>{
      const direct=group.rows.filter(row=>matches(row,query));
      const matchedCountywide=geographicSearch&&group.scopeCountywide;
      return {...group,matchedCountywide,matchingRows:matchedCountywide?group.rows:direct};
    }).filter(group=>group.matchingRows.length);
  }
  let index, counties=[], geometry, mapPending, office='president', rows=[], county='', district='', area='', view='list', page=1, sequence=0;
  const cache = new Map(), pageSize=30;let legislativeGeography,councilGeography;let routeWarning='',invalidRouteArea=false;
  const mapSizeMedia=window.matchMedia('(max-width:760px)');let mapView='';
  const unit=role=>['mayor','council','village'].includes(role)?'人次':'人';
  function statisticsCounty(){const selected=counties.find(c=>normalize(c.name)===normalize(county));if(selected)return selected.name;const names=[...new Set(rows.filter(r=>matches(r,$('inc-search').value)).map(r=>r.county))];return office==='mayor'&&$('inc-search').value&&names.length===1?(counties.find(c=>normalize(c.name)===normalize(names[0]))?.name||''):'';}
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
    if(url.searchParams.get('office')!==office||(url.searchParams.get('incCounty')||'')!==county)for(const key of ['statCounty','statBallot','historyType','historyYear'])url.searchParams.delete(key);
    url.searchParams.set('tab','incumbents');url.searchParams.set('office',office);
    for (const [key,value] of [['incCounty',county],['incDistrict',district],['incArea',area],['incView',hierarchical()?view:'']]) {
      if (value) url.searchParams.set(key,value); else url.searchParams.delete(key);
    }
    url.hash='';
    if (url.href!==location.href) history[replace?'replaceState':'pushState'](null,'',url);
    window.ElectionPageTabs?.settleContextNotice('incumbents');
  }
  const readingTargets=new Set(['inc-result-heading','inc-zone-heading','inc-selected-heading','inc-statistics-heading','inc-stat-columns','inc-history-heading']);
  function rosterHeading(){return (county&&(area||!hierarchical()))||(!hierarchical()&&$('inc-search').value)?'inc-selected-heading':county?'inc-zone-heading':'inc-result-heading';}
  function focusHeading(id,writePosition=false) {
    if (root.hidden) return;
    const request=sequence;
    window.ElectionPageTabs?.pinContextReturn('incumbents');
    requestAnimationFrame(()=>{
      const target=$(id);
      if(request!==sequence||root.hidden||!target||!target.getClientRects().length)return;
      if(writePosition&&readingTargets.has(id)){
        const url=new URL(location.href);url.hash=id;
        if(url.href!==location.href)history.pushState(null,'',url);
      }
      target.focus({preventScroll:true});target.scrollIntoView({block:'start',behavior:'auto'});
    });
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
    return searchGroups(groupRows(rows,office,county,district),query);
  }
  function chooseCounty(name, focusStats=false) {
    routeWarning='';invalidRouteArea=false;
    county=name;district='';area='';page=1;$('inc-search').value='';
    configureDistrict();render();updateUrl();focusHeading(focusStats?'inc-statistics-heading':area?'inc-selected-heading':'inc-zone-heading');
  }
  function renderOfficeGuide(){
    const guide=officeGuide[office];
    $('inc-role-heading').textContent=`${labels[office]} · ${guide.short}`;
    $('inc-role-description').textContent=guide.description;
    $('inc-role-next').textContent=['legislator','council','village'].includes(office)&&counties.some(c=>normalize(c.name)===normalize(county))?`目前查看${county}，${office==='village'?'請選擇行政區，再明確選擇村里':'請從選區列表選擇要看的名單'}。`:guide.flow;
    if(office==='legislator'&&county&&!counties.some(c=>normalize(c.name)===normalize(county)))$('inc-role-next').textContent=`目前查看${county}；這類名單不依縣市分配，政黨分布與歷年票以全台為範圍。`;
    $('inc-role-source').href=guide.source;$('inc-role-source').textContent=guide.sourceLabel+' ↗';
  }
  function renderStatistics() {
    renderOfficeGuide();
    $('inc-show-stats').hidden=!rows.length;$('inc-show-history').hidden=!rows.length;
    const scopeName=statisticsCounty()||'全台';$('inc-show-stats').textContent=`看${scopeName}政黨分布 ↓`;$('inc-show-history').textContent=`${scopeName}總統／縣市長歷年票 ↓`;$('inc-village-steps').hidden=office!=='village';
    const step=!county?1:!area?2:3;
    for(const item of root.querySelectorAll('[data-village-step]')){
      const current=Number(item.dataset.villageStep)===step;item.classList.toggle('is-current',current);
      if(current)item.setAttribute('aria-current','step');else item.removeAttribute('aria-current');
    }
    window.OfficeholderStatistics?.update({office,county,rows,index,counties,onRead:id=>focusHeading(id,true)});
  }
  function renderCountyList() {
    const query=normalize($('inc-search').value);
    const visible=counties.filter(c=>normalize(c.name).includes(query));
    $('inc-county-list').replaceChildren(...visible.map(c=>{
      const button=document.createElement('button');button.type='button';button.dataset.incCounty=c.name;
      button.innerHTML=`<strong>${escape(c.name)}</strong><span>收錄 ${countyCount(c.name).toLocaleString('zh-TW')} ${unit(office)}</span>`;
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
  function mapScale(){return $('inc-map-canvas').querySelector('svg')?.getBoundingClientRect().width/Number(geometry.viewBox.split(/\s+/)[2])||1;}
  function panMapPoint(x,y){
    const viewport=$('inc-map-viewport');if(viewport.dataset.mode!=='readable')return;
    const scale=mapScale();viewport.scrollLeft=x*scale-viewport.clientWidth/2;viewport.scrollTop=y*scale-viewport.clientHeight/2;
  }
  function panMapRegion(id,focus=false){
    const region=geometry?.regions?.find(r=>r.id===id),viewport=$('inc-map-viewport');if(!region?.frame)return;
    const {x,y,width,height}=region.frame;
    panMapPoint(x+width/2,id==='mainland'?y+viewport.clientHeight/(2*mapScale()):y+height/2);
    if(focus){
      const target=region.isInset?[...viewport.querySelectorAll('[data-inc-map-county]')].find(node=>node.dataset.incMapCounty===region.name):viewport;
      (target||viewport).focus({preventScroll:true});viewport.scrollIntoView({block:'nearest'});
    }
  }
  function applyMapView(){
    const viewport=$('inc-map-viewport'),mode=mapView||(mapSizeMedia.matches?'readable':'overview'),changed=viewport.dataset.mode!==mode;
    viewport.dataset.mode=mode;
    for(const button of root.querySelectorAll('[data-inc-map-view]'))button.setAttribute('aria-pressed',String(button.dataset.incMapView===mode));
    $('inc-map-help').textContent=mode==='readable'?'放大閱讀：可上下左右捲動，或用位置按鈕移至本島與離島；點縣市名稱選擇。':'全圖總覽：可查看全台位置；選「放大閱讀」看大字地圖。';
    if(changed)requestAnimationFrame(()=>{if(view!=='map'||county)return;if(mode==='readable')panMapRegion('mainland');else{viewport.scrollLeft=0;viewport.scrollTop=0;}});
  }
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
      // Leave room for larger name controls while preserving the boundary geometry.
      const x=shape.label.x+(item.name==='花蓮縣'?6:0),y=shape.label.y+(item.name==='嘉義市'?10:0);
      const label=svgNode('g',{class:'inc-map-label-group','data-inc-map-label':item.name});
      if(shape.anchor&&Math.hypot(x-shape.anchor.x,y-shape.anchor.y)>24)label.append(svgNode('line',{x1:x,y1:y,x2:shape.anchor.x,y2:shape.anchor.y,class:'inc-map-leader'}));
      label.append(svgNode('rect',{x:x-31,y:y-19,width:62,height:38,rx:4}),svgNode('text',{x,y,'text-anchor':'middle','dominant-baseline':'central'},item.name));
      const eligible=!normalize($('inc-search').value)||normalize(item.name).includes(normalize($('inc-search').value));
      node.style.opacity=label.style.opacity=eligible?'1':'.18';node.setAttribute('tabindex',eligible?'0':'-1');node.setAttribute('aria-disabled',String(!eligible));
      const choose=()=>{if(eligible)chooseCounty(item.name);};
      node.addEventListener('click',choose);label.addEventListener('click',choose);
      node.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();choose();}});
      for(const target of [node,label]){
        target.addEventListener('pointerenter',()=>{node.classList.add('is-hovered');label.classList.add('is-hovered');});
        target.addEventListener('pointerleave',()=>{node.classList.remove('is-hovered');label.classList.remove('is-hovered');});
      }
      node.addEventListener('focus',()=>{label.classList.add('is-focused');if(node.matches(':focus-visible'))panMapPoint(x,y);});node.addEventListener('blur',()=>label.classList.remove('is-focused'));
      shapes.append(node);mapLabels.append(label);
    }
    svg.append(shapes,mapLabels);$('inc-map-canvas').replaceChildren(svg);$('inc-map-canvas').setAttribute('aria-busy','false');
    for(const button of root.querySelectorAll('[data-inc-map-view],[data-inc-map-region]'))button.disabled=false;
    applyMapView();
    const query=normalize($('inc-search').value),matches=geometry.counties.filter(c=>normalize(c.name).includes(query));
    if(query&&matches.length===1)requestAnimationFrame(()=>panMapPoint(matches[0].label.x,matches[0].label.y));
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
    $('inc-status').textContent=items.length?`${total===items.length?'共':'選區共 '+total+' '+unit(office)+'，符合搜尋'} ${items.length.toLocaleString('zh-TW')} ${unit(office)}${items.length>pageSize?`，顯示第 ${first+1}–${Math.min(first+pageSize,items.length)} 人`:''}。`:'沒有符合條件的名冊資料。可清除搜尋或更換選區。';
    $('inc-results').className=office==='president'?'inc-results':'inc-person-list'+(office==='mayor'?' inc-mayor-list':'');
    $('inc-results').innerHTML=items.slice(first,first+pageSize).map(personMarkup).join('');
    $('inc-page').textContent=`第 ${page} / ${pages} 頁`;$('inc-prev').disabled=page===1;$('inc-next').disabled=page===pages;$('inc-pagination').hidden=items.length<=pageSize;
  }
  function render() {
    const browsing=hierarchical()&&!county, selected=hierarchical()&&Boolean(county), query=$('inc-search').value;
    const national=office==='legislator'&&county&&!counties.some(c=>normalize(c.name)===normalize(county));
    $('inc-route-note').hidden=!routeWarning;$('inc-route-note').textContent=routeWarning;
    $('inc-directory').dataset.stage=browsing?'county':selected?'district':'flat';
    $('inc-result-heading').textContent=browsing?`選擇縣市 · ${labels[office]}`:selected?`${county} · ${labels[office]}`:`${labels[office]}名冊`;
    $('inc-county-browser').hidden=!browsing;$('inc-workspace').hidden=browsing;$('inc-zone-sidebar').hidden=!selected;$('inc-return-counties').hidden=!selected;
    $('inc-filters').hidden=office==='president';$('inc-search-label').textContent=browsing?'搜尋縣市':national?'搜尋本類別姓名':selected?'搜尋本縣市姓名、行政區或選區':'搜尋縣市長姓名或縣市';
    $('inc-search').placeholder=browsing?'例如：新北市、澎湖縣':national?'輸入立委姓名':selected?'輸入行政區、姓名、選區或村里名':'例如：臺北市、姓名';
    $('inc-clear').hidden=!query;
    $('inc-search-hint').hidden=!['legislator','council'].includes(office)||!county||national;
    const covered=rows.filter(r=>normalize(r.county)===normalize(county)).every(r=>r.scope);
    $('inc-search-hint').textContent=national?'':covered?'可用行政區或村里名找官方選區範圍。區域、平地原住民與山地原住民分開標示；地名不判定個人領票資格。':'此屆部分選區範圍暫未載入或待確認，可先用姓名或選區編號查詢，再核對官方來源；找不到不代表沒有現任者。';
    renderStatistics();
    if(browsing){renderCountyList();return;}
    $('inc-workspace').classList.toggle('has-sidebar',selected);$('inc-change-zone').hidden=!selected;$('inc-change-zone').textContent=national?'查看名冊類別 ↑':'更換選區 ↑';
    if(selected){
      $('inc-sidebar-county').textContent=county;$('inc-return-counties').textContent=national?'重選縣市或類別':'重選縣市';
      const list=$('inc-zone-list'),oldScroll=list.scrollTop;
      const available=groups();if(!available.some(g=>g.key===area))area=national&&!invalidRouteArea&&available.length===1?available[0].key:'';
      const current=available.find(g=>g.key===area);
      list.classList.toggle('is-short-list',available.length>0&&available.length<=3);
      if(available.some(group=>group.matchedCountywide))$('inc-search-hint').textContent+=' 本次也列出涵蓋全縣市的原住民選區，請依資格確認。';
      $('inc-zone-heading').textContent=national?'名冊類別':office==='village'?'村里選區列表':'選區列表';
      const unknown=office==='village'?available.filter(g=>!g.area||normalize(g.area)===normalize(county)).length:0;
      $('inc-zone-count').textContent=`${available.length-unknown} 個${national?'名冊類別':office==='village'?'村里':'選區'}${query?'符合搜尋':''}${unknown?' · '+unknown+'項村里待確認':''}`;
      list.replaceChildren(...available.map(group=>{
        const button=document.createElement('button');button.type='button';button.dataset.incArea=group.key;button.setAttribute('aria-pressed',String(group.key===area));
        button.innerHTML=`<strong>${escape(group.label)}</strong>${office==='legislator'||office==='council'?`<span class="inc-scope-kind">${escape(group.scopeKind||'類別待確認')}${group.scopeCountywide?' · 全縣市':''}</span><span class="inc-zone-scope">${escape(group.scopeMode==='national'?'全國名單，依相應選舉類別查詢':group.scope||'此屆地理範圍待確認')}</span>`:''}<small>收錄 ${group.rows.length} ${unit(office)}${group.key===area?' · 目前':''}</small>`;
        button.addEventListener('click',()=>{routeWarning='';invalidRouteArea=false;area=group.key;page=1;render();updateUrl();focusHeading('inc-selected-heading');});return button;
      }));list.scrollTop=oldScroll;
      const activeButton=list.querySelector('[aria-pressed=true]');
      if(activeButton&&list.clientHeight){
        if(activeButton.offsetTop<list.scrollTop)list.scrollTop=activeButton.offsetTop;
        else if(activeButton.offsetTop+activeButton.offsetHeight>list.scrollTop+list.clientHeight)list.scrollTop=activeButton.offsetTop+activeButton.offsetHeight-list.clientHeight;
      }
      $('inc-selected-heading').textContent=current?`${current.label} · 現任${labels[office]}`:available.length?(national?'請選擇名冊類別':office==='village'?'請選擇村里':'請選擇選區'):'沒有符合條件的選區';
      $('inc-result-pane').classList.toggle('is-awaiting-village',!current&&available.length>0);
      $('inc-selected-context').textContent=current?`${county}${office==='village'?' · 村里依行政區分開列出':' · 選區名稱依現任名冊列載'}`:'請調整搜尋或行政區。';
      renderResults(current?current.matchingRows:[],current?.rows.length||0);
      if(!current&&available.length){const kind=national?'名冊類別':office==='village'?'村里':'選區';$('inc-selected-context').textContent=`已選擇${county}，請從${kind}列表點選要查詢的${kind}。`;$('inc-status').textContent=`選定${kind}後，這裡才會顯示對應名冊；${national?'請點選要查看的類別。':'不會自動替你選第一區。'}`;}
      $('inc-selected-geography').hidden=!current||!['legislator','council'].includes(office)||national;
      if(national&&current){$('inc-selected-context').textContent='全國名單，未按縣市分配；請依相應選舉類別查看。';$('inc-selected-scope').textContent='';$('inc-geography-source').removeAttribute('href');}
      else if(current?.scopeMode==='geographic')$('inc-selected-context').textContent=`${county} · ${current.scopeKind} · 地理範圍不判定個人選民資格。`;
      if(current&&!national&&['legislator','council'].includes(office)){
        $('inc-selected-scope').textContent=current.scope||'此屆選區地理範圍尚未完成對照，請以官方資料核對；可先用選區編號或姓名查名冊。';
        $('inc-geography-source').href=current.scopeSourceURL||'https://data.cec.gov.tw/';
        $('inc-geography-title').textContent=office==='council'?'查看2022年當屆官方選區範圍':'查看第11屆官方選區範圍';
      }
      if(office==='village'&&current&&current.rows.length>1)$('inc-selected-context').textContent+=' · 此區有多筆名冊紀錄，任職情形請核對官方來源。';
      if(office==='village')renderStatistics();
    }else{
      $('inc-result-pane').classList.remove('is-awaiting-village');
      $('inc-selected-heading').textContent=office==='mayor'?`${county||'全台'}縣市長條列名單`:'現任總統';
      $('inc-selected-context').textContent=query?`目前搜尋「${query}」；只顯示符合條件的名冊。`:'';renderResults(rows.filter(r=>matches(r,query)));
    }
  }
  async function fetchJson(path) {const response=await fetch(path);if(!response.ok)throw Error('讀取失敗');return response.json();}
  async function load(next,writeRoute=false,{restoreReading=false,preserveQuery=false}={}) {
    // Returning to the same roster keeps its in-memory search and page, never URL/storage.
    const sameRoster=next.office===office&&(next.county||'')===county&&(next.district||'')===district&&(next.area||'')===area&&(!hierarchical()||(next.view||view)===view);
    const previousQuery=preserveQuery&&sameRoster?{text:$('inc-search').value,page}:null;
    const request=++sequence;routeWarning='';invalidRouteArea=false;$('inc-route-note').hidden=true;office=next.office;county=next.county||'';district=next.district||'';area=next.area||'';view=next.view||view;page=1;rows=[];
    renderOfficeGuide();
    window.OfficeholderStatistics?.reset();$('inc-office-statistics').hidden=true;$('inc-show-stats').hidden=true;$('inc-show-history').hidden=true;$('inc-selected-geography').hidden=true;$('inc-search-hint').hidden=true;$('inc-village-steps').hidden=true;
    $('inc-search').value='';$('inc-directory').setAttribute('aria-busy','true');$('inc-filters').disabled=true;
    $('inc-county-browser').hidden=true;$('inc-workspace').hidden=false;$('inc-workspace').classList.remove('has-sidebar');$('inc-zone-sidebar').hidden=true;$('inc-return-counties').hidden=true;
    $('inc-results').replaceChildren();$('inc-pagination').hidden=true;$('inc-error').hidden=true;$('inc-status').textContent='正在載入官方名冊…';$('inc-selected-heading').textContent=`${labels[office]}名冊`;
    for(const button of root.querySelectorAll('[data-inc-office]'))button.setAttribute('aria-pressed',String(button.dataset.incOffice===office));
    try{
      const results=await Promise.all([index?Promise.resolve(index):fetchJson('./incumbents-data/index.json?v=20261018-incumbents-v1'),counties.length?Promise.resolve(counties):fetchJson('./data/counties.json').then(x=>x.counties)]);
      if(request!==sequence)return;[index,counties]=results;
      for(const meta of index.offices){const label=document.createElement('span'),count=document.createElement('span');label.textContent='收錄';count.className='inc-office-count';count.textContent=`${meta.count.toLocaleString('zh-TW')} ${unit(meta.id)}`;root.querySelector(`[data-inc-office="${meta.id}"] small`).replaceChildren(label,count);}
      const meta=index.offices.find(x=>x.id===office);if(!cache.has(office))cache.set(office,await fetchJson(meta.path+'?v='+meta.sha256.slice(0,16)));
      if(request!==sequence)return;rows=cache.get(office).records;
      if(office==='legislator'){
        try{if(!legislativeGeography)legislativeGeography=await fetchJson('./incumbents-data/legislative-constituencies.json?v=20261018-five-minute-r01');}catch{legislativeGeography=null;}
        if(request!==sequence)return;rows=rows.map(row=>geographicRow(row,office,legislativeGeography));
      }
      if(office==='council'){
        try{if(!councilGeography)councilGeography=await fetchJson('./incumbents-data/council-constituencies.json?v=20261018-five-minute-r03');}catch{councilGeography=null;}
        if(request!==sequence)return;rows=rows.map(row=>geographicRow(row,office,councilGeography));
      }
      const valid=[...counties.map(c=>c.name),...(office==='legislator'?[...new Set(rows.map(r=>r.county))]:[])];
      county=(hierarchical()||office==='mayor')?(valid.find(name=>normalize(name)===normalize(county))||''):'';
      if(previousQuery){$('inc-search').value=previousQuery.text;page=previousQuery.page;}
      else if(office==='mayor'&&county)$('inc-search').value=county;
      if(hierarchical()&&next.county&&!county)routeWarning='網址中的縣市目前無法對應，請重新選擇縣市。';
      configureDistrict();
      if(county&&next.district&&!district)routeWarning+='網址中的行政區目前無法對應，已列出本縣市所有選區。';
      if(county&&area&&!groupRows(rows,office,county,district).some(group=>group.key===area)){area='';invalidRouteArea=true;routeWarning+=`網址中的選區目前無法對應；已保留${county}，請從下方列表重新選擇。`;}
      if(routeWarning){
        const corrected=new URL(location.href);
        if(next.county&&!county)for(const key of ['incCounty','incDistrict','incArea'])corrected.searchParams.delete(key);
        if(next.district&&!district)corrected.searchParams.delete('incDistrict');
        if(invalidRouteArea)corrected.searchParams.delete('incArea');
        if(corrected.href!==location.href)history.replaceState(null,'',corrected);
      }
      $('inc-checked').textContent=`收錄查核：${index.checkedAt} · 非即時同步`;
      $('inc-source-note').textContent=['mayor','council','village'].includes(office)?'地方名冊未提供逐筆任免日期；代理職稱依來源保留，缺漏不代表缺額。黨籍為來源所列，可能尚未反映異動。':office==='legislator'?'依立法院第11屆資料，排除已離職者；不分區與原住民名單另列，不依縣市分配。':'依總統府現任總統介紹，顯示就任日期與官方連結。';
      const sources=[...new Set(rows.flatMap(r=>[r.sourceId,r.additionalSourceId].filter(Boolean)))];$('inc-sources').innerHTML=sources.map(id=>`<li>${link(id)}${index.sources[id].sourceUpdatedAt?`（來源日期：${escape(index.sources[id].sourceUpdatedAt)}）`:''}</li>`).join('');
      $('inc-stale').hidden=Date.now()-Date.parse(index.checkedAt+'T00:00:00+08:00')<30*86400000;
      render();if(writeRoute)updateUrl();
      if(routeWarning)focusHeading('inc-route-note');else if(readingTargets.has(location.hash.slice(1)))focusHeading(location.hash.slice(1));else if(restoreReading)focusHeading(rosterHeading());
    }catch{if(request!==sequence)return;rows=[];$('inc-status').textContent='名冊暫時無法載入，請重新載入。';$('inc-error').hidden=false;}
    finally{if(request===sequence){$('inc-filters').disabled=!rows.length;$('inc-directory').setAttribute('aria-busy','false');}}
  }
  for(const button of root.querySelectorAll('[data-inc-office]'))button.addEventListener('click',()=>{const next=button.dataset.incOffice;if(next===office&&rows.length&&next!=='village')return;const keepCounty=next!==office&&['legislator','council','village'].includes(next)&&counties.some(c=>normalize(c.name)===normalize(county))?county:'';load({office:next,county:keepCounty,view:next==='village'?'list':view},true);});
  for(const button of root.querySelectorAll('[data-inc-view]'))button.addEventListener('click',()=>{view=button.dataset.incView;$('inc-search').value='';render();updateUrl();});
  for(const button of root.querySelectorAll('[data-inc-map-view]'))button.addEventListener('click',()=>{mapView=button.dataset.incMapView;applyMapView();});
  for(const button of root.querySelectorAll('[data-inc-map-region]'))button.addEventListener('click',()=>{mapView='readable';applyMapView();requestAnimationFrame(()=>panMapRegion(button.dataset.incMapRegion,true));});
  mapSizeMedia.addEventListener('change',()=>{if(!mapView&&geometry&&!root.hidden&&view==='map'&&!county)applyMapView();});
  $('inc-return-counties').addEventListener('click',()=>{routeWarning='';invalidRouteArea=false;county='';district='';area='';page=1;$('inc-search').value='';render();updateUrl();focusHeading('inc-result-heading');});
  $('inc-change-zone').addEventListener('click',()=>focusHeading('inc-zone-heading',true));
  $('inc-district').addEventListener('change',()=>{routeWarning='';invalidRouteArea=false;district=$('inc-district').value;area='';page=1;render();updateUrl();});
  $('inc-search').addEventListener('input',()=>{
    page=1;
    if(office==='mayor')county=counties.find(c=>normalize(c.name)===normalize($('inc-search').value))?.name||'';
    render();if(county||office==='mayor')updateUrl(true);
  });
  $('inc-clear').addEventListener('click',()=>{
    $('inc-search').value='';page=1;if(office==='mayor')county='';render();
    if(county||office==='mayor')updateUrl(true);$('inc-search').focus();
  });
  for(const [id,delta] of [['inc-prev',-1],['inc-next',1]])$(id).addEventListener('click',()=>{page+=delta;render();focusHeading('inc-selected-heading');});
  $('inc-show-stats').addEventListener('click',()=>{window.OfficeholderStatistics?.selectScope(statisticsCounty());focusHeading('inc-statistics-heading');});
  $('inc-show-history').addEventListener('click',()=>{window.OfficeholderStatistics?.selectScope(statisticsCounty());window.IncumbentHistory?.show();});
  $('inc-stats-return').addEventListener('click',()=>{
    focusHeading(rosterHeading(),true);
  });
  $('inc-retry').addEventListener('click',()=>load({office,county,district,area,view}));
  let opened=false;function open(){if(!root.hidden&&!opened){opened=true;load(route());}}
  window.ElectionIncumbentContext=Object.freeze({get(){
    const current=opened?{office,county:statisticsCounty()||county}:route();
    const selected=counties.find(c=>normalize(c.name)===normalize(current.county));
    return {office:current.office,countyId:selected?.id||'',countyName:selected?.name||current.county||''};
  }});
  addEventListener('page-tab-change',async event=>{
    if(event.detail?.tab!=='incumbents')return;
    if(event.detail.contextChanged||event.detail.restore){opened=true;await load(route(),false,{preserveQuery:Boolean(event.detail.restore)&&!event.detail.contextChanged});}else open();
    if(event.detail.restore)focusHeading(rosterHeading());
  });
  addEventListener('popstate',()=>{if(!root.hidden){opened=true;load(route(),false,{restoreReading:true,preserveQuery:true});}});open();
})();
