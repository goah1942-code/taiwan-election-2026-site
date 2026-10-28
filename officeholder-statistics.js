window.OfficeholderStatistics=(()=>{
  'use strict';
  const normalize=value=>String(value||'').normalize('NFKC').replaceAll('台','臺').replace(/\s/g,'');
  const isActing=row=>String(row.office||'').includes('代理')||/[（(]\s*代理\s*[)）]/.test(String(row.name||''));
  function summarize(records,county=''){
    const scoped=records.filter(row=>!county||normalize(row.county)===normalize(county));
    const counts=new Map();let acting=0;
    for(const row of scoped){const party=String(row.party||'').trim();counts.set(party,(counts.get(party)||0)+1);if(isActing(row))acting++;}
    const total=scoped.length;
    return {total,acting,actingShare:total?acting/total*100:null,parties:[...counts].map(([party,count])=>({party,count,share:total?count/total*100:null})).sort((a,b)=>b.count-a.count||a.party.localeCompare(b.party,'zh-Hant'))};
  }
  function ballotTotals(data,office,ballotId,county=''){
    const elections=data?.elections?.[office]||[];
    const event=elections.find(e=>e.id===ballotId)||elections[0];
    if(!event)return null;
    const totals=county?event.counties[county]:event.national;
    return {event,totals:totals||null};
  }
  const $=id=>document.getElementById(id),root=$('inc-office-statistics');
  const labels={president:'總統',mayor:'縣市長',legislator:'立委',council:'議員',village:'村里長'};
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const number=value=>value==null?'—':value.toLocaleString('zh-TW');
  const percent=value=>value==null?'—':value>0&&value<0.1?'<0.1%':value.toFixed(1)+'%';
  const partyLabel=party=>party==='無'?'無黨籍（來源：無）':party||'來源未列黨籍';
  let context,scope='',voteData,pending,voteError=false,ballot='',routeNote='';
  function focus(){if(root.hidden)return;$('inc-statistics-heading').focus({preventScroll:true});$('inc-statistics-heading').scrollIntoView({block:'start'});}
  function replaceInvalidRoute(name,value){
    const url=new URL(location.href);
    if(url.searchParams.get('office')!==context.office||!url.searchParams.has(name))return;
    url.searchParams.set(name,value);
    if(url.href!==location.href)history.replaceState(null,'',url);
  }
  function persist(){
    const url=new URL(location.href);url.searchParams.set('tab','incumbents');url.searchParams.set('office',context.office);
    url.searchParams.set('statCounty',scope||'all');
    if(context.office==='legislator'&&ballot)url.searchParams.set('statBallot',ballot);else url.searchParams.delete('statBallot');
    url.hash='inc-statistics-heading';if(url.href!==location.href)history.pushState(null,'',url);
  }
  function selectScope(value){
    if(!context||value&&!context.counties.some(c=>c.name===value))return;
    scope=value;routeNote='';render();persist();
  }
  function distributionRow(party,value,share){
    return `<tr style="--party-accent:${window.ElectionPartyStyle.color(party)}"><th scope="row">${window.ElectionPartyStyle.badge(party,partyLabel(party))}</th><td>${number(value)}</td><td><div class="inc-stat-share"><span>${escape(percent(share))}</span><div class="inc-stat-track" aria-hidden="true"><i style="width:${share||0}%"></i></div></div></td></tr>`;
  }
  function renderChoices(id,items,selected){
    const group=$(id),buttons=[...group.children];
    if(buttons.length!==items.length||buttons.some((button,i)=>button.value!==items[i].value||button.textContent!==items[i].label)){
      group.replaceChildren(...items.map(item=>{
        const button=document.createElement('button');button.type='button';button.value=item.value;button.textContent=item.label;return button;
      }));
    }
    for(const button of group.children)button.setAttribute('aria-pressed',String(button.value===selected));
  }
  async function loadVotes(retry=false){
    if(voteData||pending||(voteError&&!retry))return;
    voteError=false;
    pending=fetch('./incumbents-data/statistics-votes.json?v=20261018-office-statistics-v1').then(response=>{if(!response.ok)throw Error('票數資料讀取失敗');return response.json();});
    try{voteData=await pending;if(!voteData.elections?.president)throw Error('票數格式錯誤');}
    catch{voteData=null;voteError=true;}
    finally{pending=null;render();if(location.hash==='#inc-history-heading')window.IncumbentHistory?.show(false);}
  }
  function render(){
    if(!context)return;
    const {office,rows,index,counties}=context,counts=summarize(rows,scope),all=summarize(rows);
    const hasPeople=office!=='president',hasVotes=office!=='village';
    root.hidden=!rows.length;$('inc-stat-notes').hidden=!rows.length;
    $('inc-statistics-heading').textContent=`${scope||'全台'}${labels[office]}統計`;
    $('inc-stat-route-note').hidden=!routeNote;$('inc-stat-route-note').textContent=routeNote;
    $('inc-stat-quick-summary').textContent=`目前看${scope||'全台'}，${hasPeople?'收錄 '+number(counts.total)+(office==='legislator'?' 人':' 名冊人次')+'。':''}統計範圍獨立於姓名搜尋；可用統計範圍按鈕更換縣市。`;
    window.IncumbentHistory?.update({office,scope,counties});
    renderChoices('inc-stat-scope',[{value:'',label:'全台'},...counties.map(c=>({value:c.name,label:c.name}))],scope);
    $('inc-stat-brief').textContent={president:'2024總統候選人票，依推薦政黨加總。',mayor:'人數依現任名冊；票數為2022選舉，含嘉義市重行選舉。',legislator:'人數依現任名冊，縣市僅計區域立委；票種只影響票數。',council:'人數依現任名冊；票數為2022議員選舉，含全部議員類別。',village:'以名冊任職紀錄計人次；代理包括職稱或姓名的明確註記。目前未提供村里長歷年票數，下方另可看總統／縣市長歷史。'}[office];
    $('inc-statistics-scope').textContent=`統計範圍：${scope||'全台'}。現任名冊：${index.checkedAt} 快照（非即時）。`;
    $('inc-stats-total-card').hidden=!hasPeople;$('inc-stats-total').textContent=number(counts.total);
    $('inc-stats-total-card').querySelector('dt').textContent=office==='legislator'?'現任名冊總人數':'現任名冊收錄人次';
    $('inc-stats-acting-card').hidden=office!=='village';$('inc-stats-acting-share-card').hidden=office!=='village';
    $('inc-stats-acting').textContent=number(counts.acting);$('inc-stats-acting-share').textContent=percent(counts.actingShare);
    $('inc-stats-valid-card').hidden=!hasVotes;
    $('inc-count-statistics').hidden=!hasPeople;$('inc-vote-statistics').hidden=!hasVotes;
    $('inc-stat-columns').classList.toggle('single-statistic',!hasPeople||!hasVotes);
    $('inc-stat-people-definition').hidden=!hasPeople;
    $('inc-stat-people-definition').textContent=office==='legislator'
      ? '現任人數依名冊中的未離職委員計算；各縣市僅計區域立委，不分區及原住民立委計入全台總數，不歸入縣市。黨籍依來源所列，非即時同步。'
      : '人數以名冊每筆任職紀錄計人次；同名不合併，兼代或同里多筆可能重複計入，不等於不重複自然人數。黨籍依來源所列，可能尚未反映異動。'+(office==='village'?'職稱或姓名括號明確註記「代理」者計入代理人數。':'');
    $('inc-stat-count-unit').textContent=office==='legislator'?'人':'人次';
    const peopleScope=`${scope||'全台'}${office==='legislator'&&scope?'區域立委':labels[office]}`;
    $('inc-count-stat-heading').textContent=`${peopleScope}：政黨${office==='legislator'?'人數':'人次'}與比例`;
    $('inc-count-context').textContent=`現任名冊 · ${index.checkedAt} 快照`;
    $('inc-count-unit-heading').textContent=office==='legislator'?'人數':'收錄人次';$('inc-count-share-heading').textContent=office==='legislator'?'人數比例':'人次比例';
    $('inc-stat-county-people-header').textContent=office==='legislator'?'現任名冊人數':'現任名冊人次';
    $('inc-stats-parties').innerHTML=counts.parties.map(p=>distributionRow(p.party,p.count,p.share)).join('');
    $('inc-count-denominator').textContent=`分母：全部 ${number(counts.total)} ${office==='legislator'?'人':'名冊人次'}`;
    $('inc-stats-party-total').textContent=number(counts.total);$('inc-stats-party-percent').textContent=counts.total?'100%':'—';
    const variants=voteData?.elections?.[office]||[];
    if(variants.length&&!variants.some(e=>e.id===ballot)){
      if(ballot&&office==='legislator')routeNote=[routeNote,'網址票種無法辨識，已改看2024不分區政黨票。'].filter(Boolean).join(' ');
      ballot=office==='legislator'?'party-2024':variants[0].id;
      if(office==='legislator')replaceInvalidRoute('statBallot',ballot);
    }
    $('inc-stat-route-note').hidden=!routeNote;$('inc-stat-route-note').textContent=routeNote;
    $('inc-ballot-wrap').hidden=office!=='legislator';
    renderChoices('inc-ballot',office==='legislator'?variants.map(e=>({value:e.id,label:e.label})):[],ballot);
    const votes=ballotTotals(voteData,office,ballot,scope),total=votes?.totals?.validVotes;
    $('inc-stats-valid').textContent=number(total);
    $('inc-stats-valid-label').textContent=votes?`${votes.event.year} 年有效票`:'選舉有效票';
    $('inc-vote-error').hidden=!hasVotes||!voteError;
    $('inc-vote-stat-heading').textContent=votes?`${scope||'全台'} · ${votes.event.label}：政黨票數與比例`:`${scope||'全台'}：政黨票數與比例`;
    $('inc-vote-denominator').textContent=!hasVotes?'':votes?`分母：全部有效票 ${number(total)} 票`:(voteError?'票數尚未載入，人數統計仍可查看。':'正在載入中選會票數…');
    $('inc-vote-definition').hidden=!hasVotes;
    $('inc-vote-definition').textContent=hasVotes?(votes?.event.note||'')+(office==='president'?'總統候選人得票依推薦政黨加總。':office==='legislator'?'票種分開計算；各縣市票數依投票所在地彙總，請勿將區域、原住民與不分區票相加。':'')+' 票數採例行選舉結果，不混入任內補選；人數與票數來自不同時點，不直接對應同一批人。':'';
    const parties=votes?.totals?.parties||[];
    $('inc-stats-votes').innerHTML=parties.map(p=>distributionRow(p.party,p.votes,total?p.votes/total*100:null)).join('');
    $('inc-vote-tfoot').hidden=total==null;$('inc-votes-total').textContent=number(total);$('inc-votes-percent').textContent=total?'100%':'—';
    const source=votes&&voteData.sources[votes.event.sourceId];
    $('inc-vote-source').replaceChildren();
    if(source){const a=document.createElement('a');a.href=source.url;a.textContent='票數來源：'+source.label+' ↗';a.target='_blank';a.rel='noopener noreferrer';$('inc-vote-source').append(a);}
    $('inc-stat-source').innerHTML=[...new Set(rows.map(r=>r.sourceId))].map(id=>{
      const source=index.sources[id];return source?`<a href="${escape(source.url)}" target="_blank" rel="noopener noreferrer">${escape(source.label)} ↗</a>`:'';
    }).join(' ');
    $('inc-stat-county-people-header').hidden=!hasPeople;$('inc-stat-county-votes-header').hidden=!hasVotes;$('inc-stat-county-acting-header').hidden=office!=='village';
    const nationalVotes=ballotTotals(voteData,office,ballot)?.totals;
    $('inc-stats-counties').replaceChildren(...counties.map(item=>{
      const people=summarize(rows,item.name),v=ballotTotals(voteData,office,ballot,item.name)?.totals;
      const tr=document.createElement('tr');tr.classList.toggle('is-selected',scope===item.name);
      const th=document.createElement('th');th.scope='row';const button=document.createElement('button');button.type='button';button.textContent=item.name;button.setAttribute('aria-label',`查看${item.name}政黨人數與票數比例`);button.addEventListener('click',()=>{selectScope(item.name);focus();});th.append(button);tr.append(th);
      const values=[];if(hasPeople)values.push(people.total?number(people.total):'未收錄');if(office==='village')values.push(number(people.acting));if(hasVotes)values.push(number(v?.validVotes));
      for(const value of values){const td=document.createElement('td');td.textContent=value;tr.append(td);}return tr;
    }));
    if(office==='legislator'){
      const special=[...new Set(rows.map(r=>r.county))].filter(name=>!counties.some(c=>normalize(c.name)===normalize(name)));
      for(const name of special){const tr=document.createElement('tr'),th=document.createElement('th');th.scope='row';th.textContent=name;tr.append(th);const td=document.createElement('td');td.textContent=number(summarize(rows,name).total);tr.append(td);const empty=document.createElement('td');empty.textContent='不歸屬縣市';tr.append(empty);$('inc-stats-counties').append(tr);}
    }
    $('inc-stats-counties-total').hidden=!hasPeople;$('inc-stats-counties-total').textContent=number(all.total);
    $('inc-stats-counties-acting').hidden=office!=='village';$('inc-stats-counties-acting').textContent=number(all.acting);
    $('inc-stats-counties-votes').hidden=!hasVotes;$('inc-stats-counties-votes').textContent=number(nationalVotes?.validVotes);
    $('inc-county-stat-caption').textContent=`各縣市${labels[office]}總覽${votes?' · '+votes.event.label:''}`;
    window.dispatchEvent(new Event('page-notes-ready'));
  }
  function update(next){
    if(!root)return;
    const officeChanged=!context||context.office!==next.office;let scopeNeedsCorrection=false;
    const changed=officeChanged||context.county!==next.county;
    if(changed)scope=next.counties.some(c=>normalize(c.name)===normalize(next.county))?next.counties.find(c=>normalize(c.name)===normalize(next.county)).name:'';
    if(officeChanged){
      const query=new URLSearchParams(location.search),sameOffice=query.get('office')===next.office;routeNote='';
      if(sameOffice&&query.has('statCounty')){
        const requested=query.get('statCounty');
        if(requested==='all')scope='';
        else {const found=next.counties.find(c=>normalize(c.name)===normalize(requested));if(found)scope=found.name;else{routeNote='網址縣市無法辨識，已回到目前名冊範圍。';scopeNeedsCorrection=true;}}
      }
      ballot=sameOffice?query.get('statBallot')||'':'';
    }
    context=next;
    if(scopeNeedsCorrection)replaceInvalidRoute('statCounty',scope||'all');
    render();if(next.office!=='village')loadVotes();
  }
  if(root){
    $('inc-stat-scope').addEventListener('click',event=>{const button=event.target.closest('button');if(button)selectScope(button.value);});
    $('inc-ballot').addEventListener('click',event=>{const button=event.target.closest('button');if(button){ballot=button.value;routeNote='';render();persist();}});
    root.addEventListener('click',event=>{const button=event.target.closest('[data-inc-stat-jump]');if(!button)return;if(button.dataset.incStatJump==='history')window.IncumbentHistory?.show();else if(context?.onRead)context.onRead('inc-stat-columns');else{$('inc-stat-columns').focus({preventScroll:true});$('inc-stat-columns').scrollIntoView({block:'start'});}});
    $('inc-votes-retry').addEventListener('click',()=>loadVotes(true));
  }
  function reset(){$('inc-stat-notes').hidden=true;context=null;if(root)root.hidden=true;window.IncumbentHistory?.reset();}
  return {update,reset,selectScope,summarize,ballotTotals};
})();
