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
  let context,scope='',voteData,pending,voteError=false,ballot='';
  function focus(){if(root.hidden)return;$('inc-statistics-heading').focus({preventScroll:true});$('inc-statistics-heading').scrollIntoView({block:'start'});}
  function distributionRow(party,value,share){
    return `<tr><th scope="row">${escape(partyLabel(party))}</th><td>${number(value)}</td><td><div class="inc-stat-share"><span>${escape(percent(share))}</span><div class="inc-stat-track" aria-hidden="true"><i style="width:${share||0}%"></i></div></div></td></tr>`;
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
    finally{pending=null;render();}
  }
  function render(){
    if(!context)return;
    const {office,rows,index,counties}=context,counts=summarize(rows,scope),all=summarize(rows);
    const hasPeople=office!=='president',hasVotes=office!=='village';
    root.hidden=!rows.length;
    $('inc-statistics-heading').textContent=`${scope||'全台'}${labels[office]}統計`;
    renderChoices('inc-stat-scope',[{value:'',label:'全台'},...counties.map(c=>({value:c.name,label:c.name}))],scope);
    $('inc-stat-brief').textContent={president:'2024總統候選人票，依推薦政黨加總。',mayor:'人數依現任名冊；票數為2022選舉，含嘉義市重行選舉。',legislator:'人數依現任名冊，縣市僅計區域立委；票種只影響票數。',council:'人數依現任名冊；票數為2022議員選舉，含全部議員類別。',village:'以名冊任職紀錄計人次；代理包括職稱或姓名的明確註記。'}[office];
    $('inc-statistics-scope').textContent=`統計範圍：${scope||'全台'}。現任名冊：${index.checkedAt} 快照（非即時）。`;
    $('inc-stats-total-card').hidden=!hasPeople;$('inc-stats-total').textContent=number(counts.total);
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
    $('inc-count-stat-heading').textContent='現任名冊：政黨人數與比例';
    $('inc-stats-parties').innerHTML=counts.parties.map(p=>distributionRow(p.party,p.count,p.share)).join('');
    $('inc-count-denominator').textContent=`分母：${number(counts.total)} ${office==='legislator'?'人':'名冊人次'}（包含無黨籍及來源未列黨籍）。`;
    $('inc-stats-party-total').textContent=number(counts.total);$('inc-stats-party-percent').textContent=counts.total?'100%':'—';
    const variants=voteData?.elections?.[office]||[];
    if(variants.length&&!variants.some(e=>e.id===ballot))ballot=office==='legislator'?'party-2024':variants[0].id;
    $('inc-ballot-wrap').hidden=office!=='legislator';
    renderChoices('inc-ballot',office==='legislator'?variants.map(e=>({value:e.id,label:e.label})):[],ballot);
    const votes=ballotTotals(voteData,office,ballot,scope),total=votes?.totals?.validVotes;
    $('inc-stats-valid').textContent=number(total);
    $('inc-stats-valid-label').textContent=votes?`${votes.event.year} 年有效票`:'選舉有效票';
    $('inc-vote-error').hidden=!hasVotes||!voteError;
    $('inc-vote-stat-heading').textContent=votes?`${votes.event.label}：政黨票數與比例`:'政黨票數與比例';
    $('inc-vote-denominator').textContent=!hasVotes?'':votes?`分母：${number(total)} 張有效票（全部候選人／政黨）；不含無效票。`:(voteError?'票數尚未載入，人數統計仍可查看。':'正在載入中選會票數…');
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
      const th=document.createElement('th');th.scope='row';const button=document.createElement('button');button.type='button';button.textContent=item.name;button.setAttribute('aria-label',`查看${item.name}政黨人數與票數比例`);button.addEventListener('click',()=>{scope=item.name;render();focus();});th.append(button);tr.append(th);
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
  }
  function update(next){
    if(!root)return;
    const officeChanged=!context||context.office!==next.office;
    const changed=officeChanged||context.county!==next.county;
    if(changed)scope=next.counties.some(c=>normalize(c.name)===normalize(next.county))?next.counties.find(c=>normalize(c.name)===normalize(next.county)).name:'';
    if(officeChanged)ballot='';
    context=next;
    render();if(next.office!=='village')loadVotes();
  }
  if(root){
    $('inc-stat-scope').addEventListener('click',event=>{const button=event.target.closest('button');if(button){scope=button.value;render();}});
    $('inc-ballot').addEventListener('click',event=>{const button=event.target.closest('button');if(button){ballot=button.value;render();}});
    $('inc-votes-retry').addEventListener('click',()=>loadVotes(true));
  }
  function reset(){context=null;if(root)root.hidden=true;}
  return {update,reset,summarize,ballotTotals};
})();
