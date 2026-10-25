/* Display colors only: labels, source categories and totals remain independent. */
window.ElectionPartyStyle = (() => {
  'use strict';
  const colors = Object.freeze({
    '中國國民黨':'#245baa', '國民黨':'#245baa',
    '民主進步黨':'#217846', '民進黨':'#217846',
    '台灣民眾黨':'#087e8a', '臺灣民眾黨':'#087e8a', '民眾黨':'#087e8a',
    '時代力量':'#987000', '親民黨':'#b85b16', '台灣基進':'#a93345',
    '台灣團結聯盟':'#9b4f1d', '無黨團結聯盟':'#7353a0',
    '新黨':'#8a7620', '綠黨':'#547f25', '台灣綠黨':'#547f25', '臺灣綠黨':'#547f25',
    '社會民主黨':'#a33f80', '小民參政歐巴桑聯盟':'#b03c76',
    '勞動黨':'#a32929', '人民民主黨':'#875038', '台灣維新':'#3d6689',
    '台灣動物保護黨':'#78633f', '中華統一促進黨':'#8c3434',
    '無':'#64748b', '無黨籍':'#64748b', '無政黨推薦':'#64748b',
    '無黨籍及未經政黨推薦':'#64748b', '連署':'#76645c',
    '':'#727780', '來源未列':'#727780', '來源未列黨籍':'#727780'
  });
  const fallback=['#7958a0','#496c83','#8b5d36','#a64370','#526b32','#4c638f','#80602d','#386f6c','#84566e','#665e94','#926046','#537344'];
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function color(name) {
    const key=String(name??'').trim();
    if(Object.prototype.hasOwnProperty.call(colors,key))return colors[key];
    let hash=2166136261;for(const ch of key)hash=Math.imul(hash^ch.codePointAt(0),16777619)>>>0;
    return fallback[hash%fallback.length];
  }
  function badge(name,label=name||'來源未列黨籍') {
    return `<span class="party-identity" style="--party-accent:${color(name)}"><span class="party-identity-dot" aria-hidden="true"></span><span>${escape(label)}</span></span>`;
  }
  return Object.freeze({color,badge});
})();
