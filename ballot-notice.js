(() => {
  'use strict';

  const IDENTITY = {
    ordinary: {label: '一般選民', key: 'generalCouncilZoneIds'},
    plain_indigenous: {label: '平地原住民選民', key: 'plainIndigenousCouncilZoneIds'},
    mountain_indigenous: {label: '山地原住民選民', key: 'mountainIndigenousCouncilZoneIds'},
  };
  const CANDIDATE_TAG_HELP = '姓名小標只依 2022 同職務、同選區紀錄比對：上屆當選＝爭取連任；上屆參選但未當選＝再次參選。未標示表示未比對到或資料未知，不代表從未參選；這不是現職身分的即時查核。';
  const PROFILE_LINK_HELP = 'WIKI（中文維基百科）／VOTETW（台灣選舉維基百科）為外部人物介紹，點選另開分頁。沒有連結表示本站目前沒有已核實的對應介紹，不代表外站一定沒有資料。';
  const SCHEDULE_URL = 'https://www.cec.gov.tw/central/article/61722';
  const REFERENDUM_URL = 'https://web.cec.gov.tw/referendum/article/64315';
  const ELECTION_LAW_URL = 'https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=D0020010';
  const REFERENDUM_LAW_URL = 'https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=D0020050';
  const WULAI_REP_SOURCE = 'https://web.cec.gov.tw/api/file/c4b572bd-102f-4e02-8870-407aa22ba63d.pdf';
  // 115 年烏來區民代表選區公告，第 1 頁。Official village coverage,
  // independent of the voter's general / plains / mountain council identity.
  const WULAI_REP = {忠治里: [1, 2], 烏來里: [2, 3], 孝義里: [2, 3], 信賢里: [3, 1], 福山里: [4, 1]};
  const jsonCache = new Map();
  const normalize = value => String(value || '').normalize('NFKC').replace(/台/g, '臺').replace(/\s/g, '');
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));
  const identityKey = value => Object.hasOwn(IDENTITY, value) ? value : 'ordinary';

  function safeUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' ? url.href : '';
    } catch { return ''; }
  }

  async function readJson(path) {
    // Requests contain fixed published data paths only, never the typed address.
    if (!jsonCache.has(path)) {
      jsonCache.set(path, fetch(path).then(response => {
        if (!response.ok) throw new Error(`資料讀取失敗（${response.status}）`);
        return response.json();
      }).catch(error => { jsonCache.delete(path); throw error; }));
    }
    return jsonCache.get(path);
  }

  function districtMatches(item, resolved) {
    return Boolean(resolved.districtName && normalize(item.districtName || item.district || item.name) === normalize(resolved.districtName));
  }

  function districtRows(links, resolved) {
    return Object.values(links?.byVillageZoneId || {}).filter(row =>
      (resolved.districtId && row.districtId === resolved.districtId) || districtMatches(row, resolved));
  }

  function councilMatch(type, links, resolved, identity) {
    const key = IDENTITY[identity].key;
    const exact = resolved.status === 'resolved' && links?.byVillageZoneId?.[resolved.villageZoneId];
    let ids;
    if (exact) {
      ids = exact[key] || [];
    } else {
      const rows = districtRows(links, resolved);
      // A district alone is enough only when every known village has the same
      // single official council zone. Split districts never use the first match.
      const signatures = new Set(rows.map(row => [...(row[key] || [])].sort().join('|')));
      ids = rows.length && signatures.size === 1 ? (rows[0][key] || []) : [];
    }
    return ids?.length === 1 ? type?.zones?.find(zone => zone.id === ids[0]) : null;
  }

  function ballot(type, zone, reason, label) {
    const event = zone?.electionEvent;
    return {
      typeId: type?.id || '', label: label || type?.label || '', type, zone: zone || null,
      status: event?.status === 'stopped' ? 'stopped' : zone ? 'matched' : 'pending',
      incomplete: event?.status === 'second_registration_announced' && !(zone?.registrationRound >= 2),
      reason: reason || '', candidates: null, electionEvent: event || null,
    };
  }

  /** Pure selection logic. resolved.villageZone may be supplied by the caller.
   * No address is sent, persisted, or used in a URL by this module.
   */
  function buildBallotPlan(index, links, resolved, inputIdentity = 'ordinary') {
    const identity = identityKey(inputIdentity);
    const types = index?.types || [];
    const ballots = [];
    const mayor = types.find(type => ['metro_mayor', 'county_mayor'].includes(type.id));
    const council = types.find(type => ['metro_council', 'county_council'].includes(type.id));
    const village = types.find(type => type.id === 'village_head');
    const countyIsCounty = /縣$/.test(index?.name || '');
    const localHead = types.find(type => type.id === (countyIsCounty ? 'town_head' : 'indigenous_district_head'));
    const localRep = types.find(type => type.id === (countyIsCounty ? 'town_representative' : 'indigenous_district_representative'));
    const localHeadZone = localHead?.zones?.find(zone => districtMatches(zone, resolved));
    const hasLocalOffices = countyIsCounty || Boolean(localHeadZone);

    if (mayor) ballots.push(ballot(mayor, mayor.zones?.length === 1 ? mayor.zones[0] : null, '縣市長選區待確認', /縣$/.test(index.name) ? '縣長' : '市長'));
    if (council) {
      const zone = councilMatch(council, links, resolved, identity);
      ballots.push(ballot(council, zone, identity === 'ordinary' ?
        '需有可核對的村里或完整行政區範圍，才能確定議員選區。' :
        '目前未能唯一對應這類選民的議員選區；請核對選民資格與官方選區公告。',
      `${/縣$/.test(index.name) ? '縣' : '市'}議員${identity === 'ordinary' ? '' : identity === 'plain_indigenous' ? '（平地原住民）' : '（山地原住民）'}`));
    }
    if (hasLocalOffices) {
      ballots.push(ballot(localHead, localHeadZone, '需先確認戶籍所在鄉鎮市／山地原住民區。', countyIsCounty ? '鄉鎮市長' : '山地原住民區長'));
      const zones = localRep?.zones?.filter(zone => districtMatches(zone, resolved)) || [];
      // The existing representative indexes do not encode village / neighbor
      // coverage. More than one zone must remain pending, even for an exact door.
      let representative = null;
      const wulai = index.id === '65000' && resolved.status === 'resolved' && normalize(resolved.districtName) === '烏來區' && WULAI_REP[resolved.villageName];
      if (wulai) {
        const matched = zones.find(zone => zone.name === `烏來區第${wulai[0]}選舉區` && zone.seats === wulai[1]);
        if (matched) representative = {...matched, geography: {
          coverage: Object.entries(WULAI_REP).filter(([, value]) => value[0] === wulai[0]).map(([name]) => name).join('、'),
          sourceUrl: WULAI_REP_SOURCE, sourcePage: 1,
        }};
      }
      ballots.push(ballot(localRep, representative, zones.length > 1 ?
        '已找到行政區，但尚未收錄民代表各選區的村里／鄰別官方對照，無法由門牌確定是哪一區。' :
        '民代表選區的官方範圍尚待核對。', countyIsCounty ? '鄉鎮市民代表' : '山地原住民區民代表'));
    }
    if (village) {
      const exactZone = resolved.status === 'resolved' ? resolved.villageZone : null;
      ballots.push(ballot(village, exactZone, resolved.status === 'resolved' ?
        '門牌已對應村里，但這個村里的登記資料尚未成功讀取。' :
        '尚未由官方門牌資料確定村里，因此不顯示推測的村里長名單。', '村里長'));
    }
    const stopped = ballots.filter(item => item.status === 'stopped').length;
    return {
      countyId: index?.id, countyName: index?.name, identity,
      identityLabel: IDENTITY[identity].label, resolved, ballots,
      localBallotCount: ballots.length - stopped,
      matchedCount: ballots.filter(item => item.status === 'matched').length,
      pendingCount: ballots.filter(item => item.status === 'pending').length,
      stoppedCount: stopped,
      complete: ballots.every(item => item.status !== 'pending'),
      districtOfficeUncertain: !countyIsCounty && !resolved.districtName && Boolean(localHead?.zones?.length),
      dataStage: index?.dataStage || 'registration',
    };
  }

  async function query(address, inputIdentity = 'ordinary') {
    if (!window.ElectionAddressResolver?.resolve) throw new Error('地址查詢模組尚未載入，請重新整理後再試。');
    const resolved = await window.ElectionAddressResolver.resolve(address);
    if (['invalid', 'data_error'].includes(resolved?.status)) return {resolved, plan: null};
    if (!resolved?.countyId || !/^\d{5}$/.test(resolved.countyId)) return {resolved, plan: null};
    const [index, linksResult] = await Promise.all([
      readJson(`./data/${resolved.countyId}/index.json`),
      readJson(`./assets/village-council-links/${resolved.countyId}.json`).catch(() => null),
    ]);
    const villageType = index.types.find(type => type.id === 'village_head');
    const district = villageType?.districts?.find(item => item.id === resolved.districtId || districtMatches(item, resolved));
    const enriched = {...resolved, normalizedAddress: resolved.normalizedAddress || address.trim(), districtId: resolved.districtId || district?.id};
    if (resolved.status === 'resolved' && district?.path) {
      try {
        const data = await readJson(`./data/${district.path}`);
        enriched.villageZone = data.zones.find(zone => zone.id === resolved.villageZoneId);
      } catch { enriched.warnings = [...(resolved.warnings || []), '村里長登記資料暫時無法讀取。']; }
    }
    const plan = buildBallotPlan(index, linksResult, enriched, inputIdentity);
    const results = await Promise.allSettled(plan.ballots.map(async item => {
      if (!item.zone || item.status === 'stopped') return;
      if (Array.isArray(item.zone.candidates)) item.candidates = item.zone.candidates;
      else if (item.zone.path) {
        const data = await readJson(`./data/${item.zone.path}`);
        item.candidates = data.candidates || [];
        item.electionEvent = data.electionEvent || item.electionEvent;
        if (data.registrationSourceUrl) item.registrationSourceUrl = data.registrationSourceUrl;
        if (item.electionEvent?.status === 'stopped') { item.status = 'stopped'; item.candidates = null; }
        item.incomplete = item.electionEvent?.status === 'second_registration_announced' && !((data.registrationRound || item.zone.registrationRound) >= 2);
      }
    }));
    results.forEach((result, index) => {
      if (result.status === 'rejected') plan.ballots[index].candidateError = '候選人登記資料讀取失敗，可再查詢一次。';
    });
    await Promise.all(plan.ballots.map(async item => {
      item.previousStatus = 'unavailable';
      item.previousMatches = new Map();
      if (!item.zone?.previousPath || !Array.isArray(item.candidates)) return;
      try {
        if (!window.ElectionBallotHistory?.load || !window.ElectionCandidateMatching?.match) throw new Error('comparison_unavailable');
        const previous = await window.ElectionBallotHistory.load({ballot:item, countyId:plan.countyId});
        if (!previous) return;
        item.previousStatus = 'ready';
        for (const [oldCandidate, candidate] of window.ElectionCandidateMatching.match(item.candidates, previous.candidates)) {
          item.previousMatches.set(candidate, oldCandidate);
        }
      } catch { item.previousStatus = 'error'; }
    }));
    plan.stoppedCount = plan.ballots.filter(item => item.status === 'stopped').length;
    plan.localBallotCount = plan.ballots.length - plan.stoppedCount;
    plan.matchedCount = plan.ballots.filter(item => item.status === 'matched').length;
    plan.pendingCount = plan.ballots.filter(item => item.status === 'pending').length;
    plan.complete = plan.pendingCount === 0;
    return {resolved: enriched, plan};
  }

  function profileLinks(candidate) {
    const links = new Map();
    for (const profile of candidate.profileLinks || []) {
      try {
        const url = new URL(profile.url);
        const source = url.hostname === 'zh.wikipedia.org' ? 'wikipedia' : url.hostname === 'votetw.com' ? 'votetw' : null;
        if (!source || source !== profile.sourceId || url.protocol !== 'https:' || !url.pathname.startsWith('/wiki/')) continue;
        links.set(source, url.href);
      } catch { /* Preserve plain name when the source link cannot be verified. */ }
    }
    return [...links].map(([source, url]) => `<a href="${escape(url)}" target="_blank" rel="noopener noreferrer" aria-label="${escape(candidate.name)}的${source === 'wikipedia' ? '維基百科' : 'VoteTW'}人物介紹（另開分頁）">${source === 'wikipedia' ? 'WIKI' : 'VOTETW'} ↗</a>`).join('');
  }

  function candidatesHtml(item) {
    if (item.status === 'stopped') return '';
    if (item.status === 'pending') return `<p class="bn-pending-reason">${escape(item.reason)}</p>`;
    if (item.candidateError) return `<p class="bn-pending-reason">${escape(item.candidateError)}</p>`;
    if (!item.candidates?.length) return `<p class="bn-pending-reason">${item.incomplete ? '第 2 次登記已公告，最新名單尚待補入。' : '目前沒有已收錄的登記候選人，請核對官方公告。'}</p>`;
    return `<p class="bn-candidates-label">登記 ${item.candidates.length} 人</p><ul class="bn-candidates">${item.candidates.map(candidate => {
      const party = candidate.party === '無' ? '無政黨推薦' : candidate.party || '推薦政黨未載';
      const partyClass = candidate.party === '中國國民黨' ? 'bn-party-kmt' : candidate.party === '民主進步黨' ? 'bn-party-dpp' : 'bn-party-other';
      const notes = [candidate.note, candidate.statusNote].filter(Boolean);
      const label = candidateHistoryLabel(item, candidate);
      const badge = label ? `<span class="bn-candidate-tag ${label === '爭取連任' ? 'bn-tag-incumbent' : 'bn-tag-repeat'}">${escape(label)}</span>` : '';
      return `<li><div class="bn-candidate-main"><div class="bn-person"><strong>${escape(candidate.name)}</strong>${badge}<span class="bn-profiles">${profileLinks(candidate)}</span>${notes.length ? `<small>${notes.map(escape).join(' · ')}</small>` : ''}</div><span class="bn-party ${partyClass}"><i aria-hidden="true"></i>${escape(party)}</span></div></li>`;
    }).join('')}</ul>`;
  }

  function previousCandidateStatus(item, candidate) {
    if (item.previousStatus !== 'ready') return {participated:'待確認', elected:'待確認'};
    const matched = item.previousMatches?.get(candidate);
    if (!matched) return {participated:'未比對到', elected:'—'};
    return {participated:'是', elected:matched.elected === true ? '是' : matched.elected === false ? '否' : '—'};
  }

  function candidateHistoryLabel(item, candidate) {
    const previous = previousCandidateStatus(item, candidate);
    return previous.elected === '是' ? '爭取連任' : previous.participated === '是' && previous.elected === '否' ? '再次參選' : '';
  }

  function ballotHtml(item, index) {
    const event = item.electionEvent;
    const status = item.status === 'stopped' ? '停止選舉' : item.status === 'pending' ? '選區待確認' : item.incomplete ? '名單待補' : '已對應選區';
    const zoneLabel = item.zone?.area || item.zone?.name || '尚未確定';
    const source = safeUrl(item.registrationSourceUrl || item.zone?.registrationSourceUrl || item.type?.sourceUrl);
    const geographySource = safeUrl(item.zone?.geography?.sourceUrl);
    return `<article class="bn-ballot bn-${item.status}" data-ballot-type="${escape(item.typeId)}">
      <div class="bn-ballot-heading"><div class="bn-ballot-title"><span class="bn-ballot-icon" aria-hidden="true">✓</span><div><h4>${escape(item.label)}</h4><p>${escape(zoneLabel)}</p></div></div><span class="bn-match-status">${escape(status)}</span></div>
      ${item.zone?.geography?.coverage ? `<p class="bn-zone-scope">選區範圍：${escape(item.zone.geography.coverage)}${geographySource ? ` <a href="${escape(geographySource)}" target="_blank" rel="noopener noreferrer">官方範圍${item.zone.geography.sourcePage ? ` p.${escape(item.zone.geography.sourcePage)}` : ''} ↗</a>` : ''}</p>` : ''}
      ${event ? `<p class="bn-election-event"><strong>${item.status === 'stopped' ? '本次不列入領票種類。' : '登記資料仍待更新。'}</strong> <a href="#bn-source-${index}">查看公告說明 ↓</a></p>` : ''}
      ${item.zone?.previousPath ? `<div class="bn-history-entry"><button type="button" data-bn-history="${index}" aria-haspopup="dialog">查看上次選舉結果 <span aria-hidden="true">→</span></button><small>2022 年 · 開啟結果視窗</small></div>` : item.zone ? '<div class="bn-history-entry"><small>沒有可直接對應的 2022 上屆資料</small></div>' : ''}
      ${candidatesHtml(item)}
      <div class="bn-ballot-footer">${item.zone?.seats != null ? `<span>應選 ${escape(item.zone.seats)} 席 · 這張票圈選 1 人</span>` : '<span>每種選舉各圈選 1 人</span>'}${source ? `<a href="${escape(source)}" target="_blank" rel="noopener noreferrer">中選會登記名冊 ↗</a>` : ''}<a href="#bn-source-${index}">說明 ↓</a></div>
    </article>`;
  }

  function ballotSourceHtml(item, index) {
    const source = safeUrl(item.registrationSourceUrl || item.zone?.registrationSourceUrl || item.type?.sourceUrl);
    const geographySource = safeUrl(item.zone?.geography?.sourceUrl);
    const eventSource = safeUrl(item.electionEvent?.sourceUrl);
    const zoneLabel = item.zone?.area || item.zone?.name || '尚未確定';
    return `<section id="bn-source-${index}" tabindex="-1"><h4>${escape(item.label)} · ${escape(zoneLabel)}</h4>
      <p>${escape(window.ElectionRegistrationSource?.describe(item.zone?.registrationSource || item.type?.registrationSource, source) || '名冊製表日與官方網站更新日：本次未取得。本站非即時同步，請核對官方名冊。')}</p>
      ${source ? `<p><a href="${escape(source)}" target="_blank" rel="noopener noreferrer">中選會登記名冊 ↗</a></p>` : ''}
      ${geographySource ? `<p><a href="${escape(geographySource)}" target="_blank" rel="noopener noreferrer">官方選區範圍${item.zone.geography.sourcePage ? ` p.${escape(item.zone.geography.sourcePage)}` : ''} ↗</a></p>` : ''}
      ${item.electionEvent ? `<p>${escape(item.electionEvent.summary || '')}${eventSource ? ` <a href="${escape(eventSource)}" target="_blank" rel="noopener noreferrer">官方公告 ↗</a>` : ''}</p>` : ''}
    </section>`;
  }

  function addressStatus(resolved) {
    const messages = {
      resolved: '已由官方門牌資料找到村里',
      ambiguous: '這個門牌對應不只一個村里，尚無法唯一確定',
      not_found: '官方門牌資料未找到完全相同的地址',
      unsupported: '這個縣市尚未收錄門牌與村里的對照資料',
      invalid: '請輸入縣市、行政區及含門牌號的戶籍地址',
      village_unlinked: '官方門牌里名尚待核對，暫時無法對應選區',
      data_error: '地址資料暫時無法讀取，請稍後再試',
    };
    return messages[resolved.status] || '地址仍待核對';
  }

  function resultHtml(result) {
    const {resolved, plan} = result;
    if (!plan) return `<div class="bn-address-message" role="status"><strong>${escape(addressStatus(resolved))}</strong><p>例如：新北市樹林區中山路一段1號。不用輸入里名或鄰別；請保留段、巷、弄、號與之號。</p>${(resolved.warnings || []).map(warning => `<p>${escape(warning)}</p>`).join('')}<button type="button" class="bn-recover-address" data-bn-edit-address>回到地址欄修改</button></div>`;
    const exact = resolved.status === 'resolved' && Boolean(resolved.villageZoneId);
    const villageLabel = exact ? resolved.villageName : resolved.status === 'village_unlinked' && (resolved.rawVillageName || resolved.villageName) ? `${resolved.rawVillageName || resolved.villageName}（里名待核對）` : '村里待確認';
    const region = [plan.countyName, resolved.districtName, villageLabel].filter(Boolean).join(' · ');
    const source = resolved.status === 'unsupported' ? '' : safeUrl(resolved.provenance?.url);
    const sourceTitle = resolved.provenance?.title || '官方門牌來源';
    const period = resolved.provenance?.period;
    const warnings = [...new Set(resolved.warnings || [])];
    const partial = plan.pendingCount || plan.districtOfficeUncertain;
    return `<div class="bn-notice ${partial ? 'bn-notice-partial' : ''}" id="bn-print-notice">
      <div class="bn-notice-top"><div><span class="bn-kicker">2026 · 我的選舉資料</span><h3 tabindex="-1" id="bn-result-heading">${partial ? '先看已能確認的選舉' : '你的投票資料預覽'}</h3><p>依輸入戶籍地址與選民身分整理</p></div><div class="bn-unofficial-stamp">查詢預覽<br><small>非正式通知單</small></div></div>
      <div class="bn-notice-details"><div><span>戶籍地址</span><strong>${escape(resolved.normalizedAddress || '')}</strong><small class="bn-address-match ${exact ? 'is-exact' : ''}">${escape(addressStatus(resolved))}</small></div><div><span>行政區與村里</span><strong>${escape(region)}</strong><small>${escape(plan.identityLabel)} · 依戶籍登記身分選擇</small></div><div><span>投票日</span><strong>2026 年 11 月 28 日</strong><small>星期六 · 08:00–16:00</small></div><div><span>投票所與編號</span><strong class="bn-unknown">以正式選舉通知單為準</strong><small>本站未提供個人選舉人名冊／投票所資料</small></div></div>
      <div class="bn-count-line"><div><strong>${plan.localBallotCount}</strong><span>種地方選舉票</span></div><p>${partial ? `已確認 ${plan.matchedCount} 種選區${plan.pendingCount ? `，${plan.pendingCount} 種仍待確認` : ''}` : '各種選舉各領一張，各圈選一人'}${plan.stoppedCount ? `；${plan.stoppedCount} 種已停止選舉` : ''}${plan.districtOfficeUncertain ? '；山地原住民區職務另待行政區確認' : ''}<br>同日另有 1 案全國性公投，領票資格另計。</p></div>
      ${!exact ? `<div class="bn-partial-alert"><strong>尚未完成門牌 → 村里對應</strong><p>先列出能由縣市／行政區確認的選舉。請檢查地址；村里長與跨村里分區不會用推測值填入。</p></div>` : ''}
      <div class="bn-ballots">${plan.ballots.map(ballotHtml).join('')}</div>
      <section class="bn-referendum" aria-labelledby="bn-referendum-heading"><div class="bn-referendum-heading"><div><span class="bn-kicker">同日 · 全國性公投</span><h4 id="bn-referendum-heading">第 22 案</h4></div><span class="bn-match-status">資格另計</span></div><p class="bn-referendum-question">你是否支持政府使用「核電」振興經濟，以廢除「非核家園」的能源政策？</p><div class="bn-referendum-options" aria-label="公投票有兩種選項"><span>同意</span><span>不同意</span><small>擇一圈選 · 沒有候選人</small></div><div class="bn-referendum-footer"><span>2026.11.28 · 08:00–16:00</span><a href="${REFERENDUM_URL}" target="_blank" rel="noopener noreferrer">中選會第 22 案投票公告 ↗</a></div></section>
      <div class="bn-notice-actions"><button type="button" id="bn-print">列印這份查詢</button><button type="button" id="bn-edit">修改地址／身分 ↑</button></div>
      <section class="page-notes" aria-label="查詢結果說明"><details id="bn-result-notes" class="bn-sources page-note-detail"><summary>投票資格、資料來源與注意事項</summary><div>
        <h4>投票資格</h4>
        <p class="bn-eligibility">地方選舉須符合中華民國國民、年滿 20 歲、在該選舉區繼續居住 4 個月等資格；實際領票以選舉人名冊與官方公告為準。原住民議員依戶籍登記身分對應一種議員票。 <a class="bn-legal-source" href="${ELECTION_LAW_URL}" target="_blank" rel="noopener noreferrer" aria-label="地方選舉資格法條（另開分頁）" title="公職人員選舉罷免法第4、14至16條">地方選舉資格法條 ↗</a></p>
        <p class="bn-referendum-eligibility">公投投票資格：中華民國國民年滿 18 歲、未受監護宣告，且在中華民國繼續居住 6 個月以上；資格以投票日前一日計算。18–19 歲符合條件者可領公投票，尚未具地方選舉投票年齡。 <a class="bn-legal-source" href="${REFERENDUM_LAW_URL}" target="_blank" rel="noopener noreferrer" aria-label="公投資格法條（另開分頁）" title="公民投票法第7、8條">公投資格法條 ↗</a></p>
        <p><a href="${REFERENDUM_URL}" target="_blank" rel="noopener noreferrer">中選會第 22 案投票公告 ↗</a></p>
        <h4>候選人資料與姓名小標</h4>
        <p><strong>目前為 2026 登記資料。</strong>名單須以後續中選會審定公告為準。本頁依來源順序呈現，沒有候選人號次；應選席次不代表這張票可圈選多人。</p>
        <p>${escape(CANDIDATE_TAG_HELP)}</p><p>${escape(PROFILE_LINK_HELP)}</p>
        <h4>門牌、選區與投票日期</h4>
        ${source ? `<p>門牌與村里：<a href="${escape(source)}" target="_blank" rel="noopener noreferrer">${escape(sourceTitle)} ↗</a>${period ? `（資料期別 ${escape(period)}）` : ''}</p>` : '<p>這個地址尚未取得可核對的官方門牌與村里對照。</p>'}
        <p>議員選區：各票種顯示官方範圍；村里與議員選區僅使用官方範圍明確對應。</p>
        <p>投票日期：<a href="${SCHEDULE_URL}" target="_blank" rel="noopener noreferrer">中選會 115 年地方公職人員選舉工作進行程序表 ↗</a></p>
        ${warnings.map(warning => `<p>${escape(warning)}</p>`).join('')}
        ${plan.ballots.map(ballotSourceHtml).join('')}
        <h4>地址隱私</h4><p>地址只保留在這個頁面，不寫入網址或儲存紀錄。</p>
        <a class="notes-link" href="#bn-result-heading">返回查詢結果 ↑</a>
      </div></details></section>
    </div>`;
  }

  function mount() {
    const host = document.getElementById('ballot-notice');
    if (!host) return;
    host.classList.add('ballot-notice');
    host.innerHTML = `<div class="bn-entry-heading"><div><span class="bn-kicker">從地址查我的票</span><h2 id="ballot-notice-heading">輸入戶籍地址</h2></div><span class="bn-entry-badge">2026 九合一</span></div>
      <button type="button" id="bn-result-shortcut" class="bn-result-shortcut" aria-controls="bn-output" hidden>查看剛才的查詢結果 ↓</button>
      <form class="bn-form" id="bn-form"><div class="bn-address-field"><label for="bn-address">戶籍地址 <span>不用填里名、鄰別</span></label><input id="bn-address" name="household-address" type="text" autocomplete="off" spellcheck="false" required maxlength="180" placeholder="例如：新北市樹林區中山路一段1號" aria-describedby="bn-address-help"><p id="bn-address-help">請填縣市、行政區、街路與門牌號。</p><a class="notes-link" href="#bn-entry-notes">查詢範圍與填寫說明 ↓</a></div><div class="bn-identity-field"><label for="bn-identity">選民身分</label><select id="bn-identity">${Object.entries(IDENTITY).map(([value, item]) => `<option value="${value}">${item.label}</option>`).join('')}</select><p>依戶籍登記選擇</p></div><button class="bn-submit" type="submit" id="bn-submit">查我的選票 <span aria-hidden="true">→</span></button></form>
      <div class="bn-entry-bottom"><div class="bn-examples"><span>試看範例</span><button type="button" data-bn-example="新北市樹林區中山路一段1號">樹林</button><button type="button" data-bn-example="新北市板橋區文化路一段1號">板橋</button></div></div>
      <p id="bn-progress" class="bn-progress" role="status" aria-live="polite"></p><div id="bn-output" class="bn-output" aria-live="polite"></div>
      <section class="page-notes" aria-label="地址查詢說明"><details id="bn-entry-notes" class="page-note-detail"><summary>查詢範圍、填寫方式與隱私</summary>
        <p id="bn-address-scope"><strong>新北市可由完整門牌查村里。</strong>其他縣市先查已確認的選區。</p>
        <p>保留縣市、區／鄉鎮市、路段、巷弄與門牌號。請輸入戶籍地址，不用填里名或鄰別。原住民身分以戶籍登記為準。</p>
        <p id="bn-address-privacy">地址只在瀏覽器比對，不會儲存；不用填姓名或身分證字號。</p>
        <a class="notes-link" href="#ballot-notice-heading">返回查詢表單 ↑</a>
      </details></section>`;
    const form = host.querySelector('#bn-form');
    const input = host.querySelector('#bn-address');
    const identitySelect = host.querySelector('#bn-identity');
    const button = host.querySelector('#bn-submit');
    const output = host.querySelector('#bn-output');
    const resultShortcut = host.querySelector('#bn-result-shortcut');
    const progress = host.querySelector('#bn-progress');
    let sequence = 0;
    const baseInputDescription = input.getAttribute('aria-describedby') || '';
    function clearInputFeedback() {
      input.removeAttribute('aria-invalid');
      input.setAttribute('aria-describedby', baseInputDescription);
    }
    function connectInputFeedback(resolved) {
      const title = output.querySelector('.bn-address-message strong');
      if (!title) return;
      title.id = 'bn-address-feedback';
      input.setAttribute('aria-describedby', `bn-address-feedback ${baseInputDescription}`.trim());
      if (resolved.status === 'invalid') input.setAttribute('aria-invalid', 'true');
      const recover = output.querySelector('[data-bn-edit-address]');
      if (recover) {
        recover.textContent = resolved.status === 'invalid' ? '回到地址欄補正' : '回到查詢表單';
        recover.addEventListener('click', () => {
          input.focus({preventScroll: true});
          input.scrollIntoView({block: 'center', behavior: 'auto'});
        });
      }
    }
    function invalidate() {
      clearInputFeedback();
      window.ElectionBallotHistory?.reset();
      sequence += 1;
      button.disabled = false;
      button.innerHTML = '查我的選票 <span aria-hidden="true">→</span>';
      output.replaceChildren();
      resultShortcut.hidden = true;
      output.removeAttribute('aria-busy');
      progress.textContent = '';
    }
    function focusQueryOutput() {
      if (host.closest('[role="tabpanel"]')?.hidden) return;
      const target = output.querySelector('#bn-result-heading, .bn-address-message');
      if (!target) return;
      target.tabIndex = -1;
      target.focus({preventScroll: true});
      target.scrollIntoView({block: 'start', behavior: 'auto'});
    }
    async function submit() {
      if (!input.reportValidity()) return;
      clearInputFeedback();
      window.ElectionBallotHistory?.reset();
      const current = ++sequence;
      const address = input.value.trim();
      const identity = identitySelect.value;
      button.disabled = true;
      button.innerHTML = '正在查詢…';
      output.replaceChildren();
      resultShortcut.hidden = true;
      output.setAttribute('aria-busy', 'true');
      progress.textContent = '正在比對官方門牌與選區資料…';
      try {
        const result = await query(address, identity);
        if (current !== sequence) return;
        output.innerHTML = resultHtml(result);
        resultShortcut.hidden = !output.querySelector('#bn-result-heading');
        connectInputFeedback(result.resolved);
        for (const trigger of output.querySelectorAll('[data-bn-history]')) {
          trigger.addEventListener('click', () => {
            if (current !== sequence || !window.ElectionBallotHistory) return;
            const ballot = result.plan?.ballots[Number(trigger.dataset.bnHistory)];
            if (ballot) window.ElectionBallotHistory.open({ballot, countyId: result.plan.countyId});
          });
        }
        progress.textContent = result.plan ? `${result.plan.matchedCount} 種地方選舉已對應選區${result.plan.pendingCount ? `，${result.plan.pendingCount} 種仍待確認` : ''}。` : addressStatus(result.resolved);
        host.querySelector('#bn-print')?.addEventListener('click', () => window.print());
        host.querySelector('#bn-edit')?.addEventListener('click', () => { input.focus(); input.scrollIntoView({block: 'center', behavior: 'smooth'}); });
        focusQueryOutput();
      } catch (error) {
        if (current !== sequence) return;
        output.innerHTML = `<div class="bn-address-message" role="alert"><strong>這次查詢未完成</strong><p>${escape(error.message || '請稍後再試。')}</p><p>地址沒有被儲存，可以直接按查詢重試。</p></div>`;
        progress.textContent = '查詢未完成。';
        focusQueryOutput();
      } finally {
        if (current === sequence) {
          button.disabled = false;
          button.innerHTML = '查我的選票 <span aria-hidden="true">→</span>';
          output.removeAttribute('aria-busy');
        }
      }
    }
    resultShortcut.addEventListener('click', focusQueryOutput);
    form.addEventListener('submit', event => { event.preventDefault(); submit(); });
    input.addEventListener('input', invalidate);
    for (const sample of host.querySelectorAll('[data-bn-example]')) sample.addEventListener('click', () => { input.value = sample.dataset.bnExample; submit(); });
    identitySelect.addEventListener('change', () => {
      if ((button.disabled || output.querySelector('.bn-notice')) && input.value.trim()) submit();
    });
  }

  window.ElectionBallotNotice = {buildBallotPlan, query, previousCandidateStatus, candidateHistoryLabel};
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, {once: true});
  else mount();
})();
