/* Complete historical vote distributions, independent of current officeholder counts. */
window.IncumbentHistory=(()=>{
  'use strict';
  const $=id=>document.getElementById(id),root=$('inc-history');
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const number=value=>value==null?'—':value.toLocaleString('zh-TW');
  const percentage=value=>value==null?'—':value>0&&value<0.1?'<0.1%':value.toFixed(1)+'%';
  const partyLabel=name=>name==='無'?'無黨籍（來源：無）':name||'來源未列';
  const color=name=>window.ElectionPartyStyle.color(name);
  const cache=new Map();let context,data,kind='president',year='',sequence=0,key='',routeNote='';
  function comparison(current,previous){
    const old=new Map((previous?.parties||[]).map(p=>[p.party,p]));
    const names=[...current.parties.map(p=>p.party),...[...old.keys()].filter(name=>!current.parties.some(p=>p.party===name))];
    return names.map(name=>{const now=current.parties.find(p=>p.party===name),before=old.get(name);
      const share=now?now.votes/current.validVotes*100:null,oldShare=before?before.votes/previous.validVotes*100:null;
      return {party:name,votes:now?.votes??null,share,previousVotes:before?.votes??null,previousShare:oldShare,change:share!=null&&oldShare!=null?share-oldShare:null};});
  }
  function changeLabel(value){
    if(value===0)return '0.0 個百分點';
    if(Math.abs(value)<0.1)return `${value>0?'上升':'下降'}不到0.1 個百分點`;
    return `${value>0?'+':''}${value.toFixed(1)} 個百分點`;
  }
  function setRouteNote(message,append=false){routeNote=append&&routeNote?routeNote+' '+message:message;$('inc-history-route-note').textContent=routeNote;$('inc-history-route-note').hidden=!routeNote;}
  function writeRoute(){
    const url=new URL(location.href);url.searchParams.set('tab','incumbents');url.searchParams.set('office',context.office);
    url.searchParams.set('statCounty',context.scope||'all');url.searchParams.set('historyType',kind);url.searchParams.set('historyYear',String(year));url.hash='inc-history-heading';
    if(url.href!==location.href)history.pushState(null,'',url);
  }
  function render(){
    if(!context||!data)return;
    const events=data.elections.filter(e=>e.type===kind).sort((a,b)=>a.year-b.year);
    if(!events.length){$('inc-history-status').textContent='此範圍尚無這類歷史資料。';return;}
    if(!events.some(e=>String(e.year)===String(year))){
      const requested=year;year=events.at(-1).year;
      if(requested){
        setRouteNote(`${context.scope||'全台'}未收錄 ${requested} 年${kind==='president'?'總統':'縣市長'}選舉，已改顯示 ${year} 年；可從下方重新選年。`,true);
        const url=new URL(location.href);
        if(url.searchParams.get('office')===context.office&&url.searchParams.has('historyYear')){
          url.searchParams.set('historyType',kind);url.searchParams.set('historyYear',String(year));
          history.replaceState(null,'',url);
        }
      }
    }
    const index=events.findIndex(e=>String(e.year)===String(year)),current=events[index],previous=events[index-1];
    $('inc-history-heading').textContent=`${context.scope||'全台'}歷年政治分布`;
    $('inc-history-status').textContent=`${current.year} 年${current.label}選舉 · ${context.scope||'全台'} · 完整有效票分布`;
    $('inc-history-note').textContent='這裡看總統／縣市長歷年得票；'+(['legislator','council','village'].includes(context.office)?'不是立委、議員或村里長的歷年結果。':'不是現任人數或本次登記名單。')+'全部來源政黨、無黨籍及連署分類均列入。';
    for(const button of root.querySelectorAll('[data-inc-history-type]'))button.setAttribute('aria-pressed',String(button.dataset.incHistoryType===kind));
    const years=$('inc-history-years'),ordered=[...events].reverse(),buttons=[...years.children];
    if(buttons.length!==ordered.length||buttons.some((b,i)=>b.value!==String(ordered[i].year))){
      years.replaceChildren(...ordered.map(e=>{const b=document.createElement('button');b.type='button';b.value=String(e.year);b.textContent=String(e.year)+'年';return b;}));
    }
    for(const button of years.children)button.setAttribute('aria-pressed',String(button.value===String(year)));
    const rows=comparison(current,previous);
    $('inc-history-bar').innerHTML=rows.filter(r=>r.votes!=null).map((r,i)=>`<i title="${escape(partyLabel(r.party))} ${percentage(r.share)}" style="width:${r.share}%;background:${color(r.party,i)}"></i>`).join('');
    $('inc-history-caption').textContent=`${context.scope||'全台'} ${current.year}年${current.label} · 政黨票數與比例`;
    $('inc-history-change-heading').textContent=previous?`比${previous.year}年`:'前次比較';
    $('inc-history-rows').innerHTML=rows.map((r,i)=>{
      const change=!previous?'無前次資料':r.votes==null?'本次未列':r.previousVotes==null?'上次未列':changeLabel(r.change);
      return `<tr><th scope="row">${window.ElectionPartyStyle.badge(r.party,partyLabel(r.party))}</th><td>${number(r.votes)}</td><td>${percentage(r.share)}</td><td>${change}</td></tr>`;
    }).join('');
    $('inc-history-total').textContent=number(current.validVotes);
    $('inc-history-comparison-note').textContent=`分母：${number(current.validVotes)}張有效票；不含無效票。${previous?'變化與'+previous.year+'年同類選舉比較，使用各年自己的有效票分母；分類依來源原名，上次或本次未列者不計差值。':'這是本範圍已收錄最早的同類選舉。'}`;
    $('inc-history-denominator').textContent=`分母：全部有效票 ${number(current.validVotes)} 票`;
    $('inc-history-source').href=current.sourceUrl;$('inc-history-source').textContent=`${current.year}年${current.label} · 中選會來源 ↗`;
    $('inc-history-coverage').textContent=`${data.coverageNote} 本站歷史資料核對日：${data.checkedOn}；非官方即時更新。`;
    $('inc-history-content').hidden=false;$('inc-history-retry').hidden=true;
    window.dispatchEvent(new Event('page-notes-ready'));
  }
  async function update(next){
    if(!root)return;
    const nextKey=next.counties.find(c=>c.name===next.scope)?.id||'national';
    if(context&&key===nextKey&&context.office===next.office)return;
    const route=new URLSearchParams(location.search),fresh=!context||context.office!==next.office;
    let invalidType=false;
    if(fresh){
      const sameOffice=route.get('office')===next.office,requested=route.get('historyType');
      invalidType=sameOffice&&route.has('historyType')&&!['president','mayor'].includes(requested);
      kind=sameOffice&&['president','mayor'].includes(requested)?requested:next.office==='president'?'president':'mayor';
      year=sameOffice?route.get('historyYear')||'':'';
    }
    for(const id of ['inc-history-note','inc-history-comparison-note','inc-history-coverage'])$(id).textContent='';
    context=next;key=nextKey;data=null;setRouteNote(invalidType?`網址中的歷史選舉種類無法辨識，已改看${kind==='president'?'總統票':'縣市長票'}。`:'');const request=++sequence;
    if(invalidType){const url=new URL(location.href);url.searchParams.set('historyType',kind);history.replaceState(null,'',url);}
    root.hidden=false;$('inc-history-heading').textContent=`${next.scope||'全台'}歷年政治分布`;
    $('inc-history-status').textContent='正在讀取完整歷史政黨資料…';$('inc-history-content').hidden=true;$('inc-history-retry').hidden=true;
    try{
      if(!cache.has(nextKey))cache.set(nextKey,fetch(`./incumbents-data/history/${nextKey}.json?v=20261018-five-minute-r01`).then(r=>{if(!r.ok)throw Error('讀取失敗');return r.json();}).then(value=>{
        if(!value.elections?.length||value.elections.some(e=>!e.validVotes||!e.parties?.length||e.parties.reduce((sum,p)=>sum+p.votes,0)!==e.validVotes))throw Error('歷史資料不完整');
        return value;
      }).catch(error=>{cache.delete(nextKey);throw error;}));
      const value=await cache.get(nextKey);if(request!==sequence)return;
      data=value;render();if(location.hash==='#inc-history-heading')show(false);
    }catch{if(request!==sequence)return;$('inc-history-status').textContent='歷史資料暫時無法載入，現任名冊與最近一次選舉統計仍可使用。';$('inc-history-retry').hidden=false;}
  }
  function show(write=true){if(!root||root.hidden||$('incumbents-panel').hidden)return;if(context&&write)writeRoute();$('inc-history-heading').focus({preventScroll:true});$('inc-history-heading').scrollIntoView({block:'start'});}
  function reset(){for(const id of ['inc-history-note','inc-history-comparison-note','inc-history-coverage'])$(id).textContent='';context=null;data=null;sequence++;if(root)root.hidden=true;}
  if(root){
    for(const button of root.querySelectorAll('[data-inc-history-type]'))button.addEventListener('click',()=>{kind=button.dataset.incHistoryType;year='';setRouteNote('');render();writeRoute();});
    $('inc-history-years').addEventListener('click',event=>{const button=event.target.closest('button');if(button){year=button.value;setRouteNote('');render();writeRoute();}});
    $('inc-history-retry').addEventListener('click',()=>{const next=context;context=null;update(next);});
  }
  return {update,show,reset,comparison,changeLabel};
})();
