/* Exact official doorplate lookup. User addresses never become a request URL. */
(() => {
  'use strict';
  const CN = '零〇○一二三四五六七八九十百千兩';
  const NUM = `0-9${CN}`;
  const digits = { '零': 0, '〇': 0, '○': 0, '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '兩': 2 };
  const floorPattern = new RegExp(`^(?:(?:地下底|地下室|地下|地上|底|第)?[${NUM}]+(?:樓|層|F)(?:之[${NUM}]+)?(?:室)?|地下室|地下層|地下樓|底層|地下|B[0-9]+(?:F)?)(?:之[${NUM}]+)?$`, 'i');
  const doorPattern = new RegExp(`^(.*?)([${NUM}]+(?:[之-][${NUM}]+)*)號(?:之([0-9]+))?(.*)$`);
  const scriptUrl = typeof document !== 'undefined' && document.currentScript?.src;
  const base = scriptUrl ? new URL('address-data/', scriptUrl).href : './address-data/';
  let manifestPromise;
  const shardPromises = new Map();

  function basic(value) {
    return String(value).normalize('NFKC').replace(/\s+/g, '').replace(/台/g, '臺').replace(/[－–—]/g, '-').toUpperCase();
  }

  function integer(value) {
    if (/^[0-9]+$/.test(value)) return String(Number(value));
    if (!/[十百千]/.test(value)) return String(Number([...value].map(c => digits[c] ?? c).join('')));
    let total = 0;
    let digit = 0;
    for (const c of value) {
      if (Object.prototype.hasOwnProperty.call(digits, c)) digit = digits[c];
      else if (/\d/.test(c)) digit = Number(c);
      else {
        total += (digit || 1) * { 十: 10, 百: 100, 千: 1000 }[c];
        digit = 0;
      }
    }
    return String(total + digit);
  }

  function normalizeAddress(value) {
    value = basic(value);
    value = value.replace(new RegExp(`([${NUM}]+)(?=[段巷弄])`, 'g'), (_, n) => integer(n));
    value = value.replace(new RegExp(`號之([${CN}]+)$`), (_, n) => `號之${integer(n)}`);
    // A Chinese sub-number followed by an Arabic floor has an explicit boundary.
    value = value.replace(new RegExp(`號之([${CN}]+)([0-9]+(?:樓|層|F).*)$`), (_, n, floor) => `之${integer(n)}號${floor}`);
    const match = value.match(doorPattern);
    if (!match) return { key: null, reason: 'missing_door_number' };
    const [, prefix, number, sub, suffix] = match;
    const parts = number.split(/[之-]/).map(integer);
    if (sub) parts.push(integer(sub));
    if (suffix && !floorPattern.test(suffix)) return { key: null, reason: 'unrecognized_door_suffix' };
    return { key: `${prefix}${parts.join('之')}號`, floorSuffix: suffix || null };
  }

  async function readJson(path) {
    const response = await fetch(`${base}${path}`, { credentials: 'omit', cache: 'no-cache' });
    if (!response.ok) throw new Error('address_data_unavailable');
    const data = await response.json();
    if (data.schemaVersion !== 1) throw new Error('address_schema_unsupported');
    return data;
  }

  function manifest() {
    if (!manifestPromise) manifestPromise = readJson('index.json').catch(error => {
      manifestPromise = null;
      throw error;
    });
    return manifestPromise;
  }

  function shard(path) {
    if (!shardPromises.has(path)) shardPromises.set(path, readJson(path).catch(error => {
      shardPromises.delete(path);
      throw error;
    }));
    return shardPromises.get(path);
  }

  function parseLocation(input, data) {
    // Only the leading postal code is optional. Never remove digits from a road.
    const text = basic(input).replace(/^(?:[0-9]{6}|[0-9]{3})(?=[^0-9])/, '');
    const county = data.countyCatalog.find(c => text.startsWith(basic(c.name)));
    if (county) {
      const remainder = text.slice(basic(county.name).length);
      const district = county.districts.find(d => remainder.startsWith(basic(d.name)));
      return { county, district, body: district ? remainder.slice(basic(district.name).length) : remainder };
    }
    const districts = [];
    for (const c of data.countyCatalog) for (const d of c.districts) {
      if (text.startsWith(basic(d.name))) districts.push({ county: c, district: d });
    }
    if (districts.length === 1) return { ...districts[0], body: text.slice(basic(districts[0].district.name).length), inferredCounty: true };
    return { ambiguousCounty: districts.length > 1 };
  }

  function baseResult(status, data, location = {}) {
    return {
      status, countyId: location.county?.id || null, countyName: location.county?.name || null,
      districtId: location.district?.id || null, districtName: location.district?.name || null,
      villageZoneId: null, villageName: null, mappingReady: false, warnings: [],
      coverage: { supportedCountyIds: [data.countyId], supportedCountyNames: [data.countyName],
        districtCount: data.districts.length, method: 'official_doorplate_exact', period: data.provenance.period },
      provenance: data.provenance,
    };
  }

  function choiceResult(choice, record) {
    return {
      countyId: record.countyId, countyName: '新北市', districtId: record.districtId,
      districtCode: record.districtCode, districtName: record.districtName,
      villageZoneId: choice.zoneId, villageName: choice.name,
      mappingReady: Boolean(choice.zoneId), generalCouncilZoneIds: choice.generalCouncilZoneIds,
      plainIndigenousCouncilZoneIds: choice.plainIndigenousCouncilZoneIds,
      mountainIndigenousCouncilZoneIds: choice.mountainIndigenousCouncilZoneIds,
    };
  }

  async function resolve(address) {
    if (typeof address !== 'string' || !address.trim() || address.length > 180 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(address)) {
      return { status: 'invalid', reason: 'invalid_input', warnings: ['請輸入戶籍地址的縣市、區與完整門牌號碼。'] };
    }
    try {
      const data = await manifest();
      const location = parseLocation(address, data);
      const result = baseResult('invalid', data, location);
      if (!location.county || !location.district) {
        result.reason = location.ambiguousCounty ? 'county_required' : 'district_required';
        result.warnings.push(location.ambiguousCounty ? '此區名出現在多個縣市，請補上縣市。' : '請補齊縣市、鄉鎮市區及完整門牌；不需要輸入里或鄰。');
        return result;
      }
      if (location.county.id !== data.countyId) {
        result.status = 'unsupported';
        result.reason = 'county_not_indexed';
        result.warnings.push('目前已接上新北市 29 區官方門牌資料。此縣市的門牌對里資料尚未驗證，請改用地圖或手動選里。');
        return result;
      }
      const info = data.districts.find(d => d.districtId === location.district.id);
      if (!info) throw new Error('district_missing');
      const record = await shard(info.path);
      let body = location.body;
      let suppliedVillage = null;
      const villagePrefix = record.villages.find(v => body.startsWith(basic(v.name)));
      if (villagePrefix) {
        suppliedVillage = villagePrefix;
        body = body.slice(basic(villagePrefix.name).length);
      }
      body = body.replace(/^[0-9]+鄰/, '');
      const normalized = normalizeAddress(body);
      if (!normalized.key) {
        result.reason = normalized.reason;
        result.warnings.push(normalized.reason === 'missing_door_number' ? '請補上完整門牌號碼，包含巷、弄及子號。' : '門牌後的文字無法安全判讀，請將子號改用數字，或先移除樓層。');
        return result;
      }
      result.normalizedAddress = `${location.county.name}${record.districtName}${normalized.key}`;
      result.districtCode = record.districtCode;
      result.matchMethod = 'official_doorplate_exact';
      result.coverage.addressCount = info.addressCount;
      if (location.inferredCounty) result.warnings.push('已由全臺唯一的區名辨識縣市，請核對戶籍地址。');
      if (normalized.floorSuffix) result.warnings.push('已用門牌號碼查里；樓層未用於選區判定。');
      const indices = record.addresses[normalized.key];
      if (!indices) {
        result.status = 'not_found';
        result.reason = 'doorplate_not_in_source';
        result.warnings.push('官方資料未找到完全相同門牌，請核對路段、巷弄、子號與戶籍地址；不會以附近門牌猜測里。');
        return result;
      }
      const choices = indices.map(i => choiceResult(record.villages[i], record));
      if (choices.length !== 1) {
        result.status = 'ambiguous';
        result.reason = 'multiple_source_villages';
        result.choices = choices;
        result.warnings.push('官方資料中此門牌對應多個里，請以戶籍資料或選舉通知單確認。');
        return result;
      }
      const choice = choices[0];
      if (suppliedVillage && suppliedVillage.zoneId !== choice.villageZoneId) {
        result.status = 'invalid';
        result.reason = 'supplied_village_conflicts';
        result.choices = choices;
        result.warnings.push('您輸入的里與官方門牌資料不同，請核對戶籍地址後再查詢。');
        return result;
      }
      Object.assign(result, choice);
      result.status = choice.mappingReady ? 'resolved' : 'village_unlinked';
      if (!choice.mappingReady) result.warnings.push('已找到門牌，但官方來源里名缺字或尚無現行選區對應；里長選區仍待確認。');
      return result;
    } catch (_) {
      return { status: 'data_error', reason: 'address_data_unavailable', warnings: ['門牌資料暫時無法讀取，請稍後重試或使用地圖選里。'] };
    }
  }

  window.ElectionAddressResolver = Object.freeze({ resolve, getCoverage: manifest, normalizeAddress });
})();
