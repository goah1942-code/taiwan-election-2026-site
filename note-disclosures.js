/* Keep long explanations at each tab's end, with reachable deep links. */
(() => {
  'use strict';
  let frame, pendingTarget, pendingFocus;
  const returnTargets = new WeakMap();
  function targetFor(hash) {
    try { return document.getElementById(decodeURIComponent(hash.slice(1))); }
    catch { return null; }
  }
  function reveal(target, focus = true) {
    if (!target?.closest('.page-notes')) return;
    for (let node = target; node; node = node.parentElement) {
      if (node.tagName === 'DETAILS') node.open = true;
    }
    if (!focus) return;
    if (target.closest('[hidden]')) { pendingTarget=target; pendingFocus=document.activeElement; return; }
    pendingTarget=null;
    const focusTarget = target.tagName === 'DETAILS' ? target.querySelector('summary') : target;
    if (!focusTarget.hasAttribute('tabindex') && !focusTarget.matches('a,button,summary,input,select')) focusTarget.tabIndex = -1;
    focusTarget.focus({preventScroll:true});
    focusTarget.scrollIntoView({block:'start',behavior:'auto'});
  }
  function queueHash() {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => reveal(targetFor(location.hash)));
  }
  document.addEventListener('click', event => {
    const link = event.target.closest('a[href]');
    if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || link.target === '_blank') return;
    const url = new URL(link.href, location.href);
    if (url.origin !== location.origin || url.pathname !== location.pathname || url.search !== location.search) return;
    const target = targetFor(url.hash), notes = target?.closest('.page-notes');
    if (!notes) return;
    if (!notes.contains(link)) {
      returnTargets.set(notes, link);
      let back = notes.querySelector('.notes-back');
      if (!back) {
        back = document.createElement('button');back.type='button';back.className='notes-back';back.textContent='返回剛才的位置 ↑';
        back.addEventListener('click', () => {
          const origin = returnTargets.get(notes);
          if (!origin?.isConnected || origin.closest('[hidden]')) return;
          origin.focus({preventScroll:true});origin.scrollIntoView({block:'center',behavior:'auto'});
        });
        notes.append(back);
      }
    }
    reveal(target, false);
    // Also runs for repeated clicks on an unchanged fragment.
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => reveal(target));
  });
  function readyToPosition(target) {
    if (!target?.closest('.page-notes') || target !== targetFor(location.hash)) return false;
    if (pendingTarget === target) return true;
    for (let node=target; node; node=node.parentElement) {
      if (node.tagName === 'DETAILS' && !node.open) return false;
    }
    return document.activeElement === target || document.activeElement === target.querySelector(':scope > summary');
  }
  document.addEventListener('focusin', event => {
    if (pendingTarget && event.target !== pendingFocus && event.target !== pendingTarget && event.target !== pendingTarget.querySelector(':scope > summary')) pendingTarget=null;
  });
  addEventListener('page-notes-ready', () => {
    const target=targetFor(location.hash);
    if (!readyToPosition(target)) return;
    cancelAnimationFrame(frame);
    frame=requestAnimationFrame(() => { if (readyToPosition(target)) reveal(target); });
  });
  addEventListener('hashchange', queueHash);
  addEventListener('page-tab-change', queueHash);
  addEventListener('DOMContentLoaded', queueHash);
  let printState = [];
  addEventListener('beforeprint', () => {
    printState = [...document.querySelectorAll('.page-notes details')].map(node => [node,node.open]);
    for (const [node] of printState) node.open = true;
  });
  addEventListener('afterprint', () => {
    for (const [node,open] of printState) if (node.isConnected) node.open = open;
    printState = [];
  });
})();
