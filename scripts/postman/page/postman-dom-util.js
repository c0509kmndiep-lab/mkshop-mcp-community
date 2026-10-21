function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function isVisible(el) {
  if (!el) return false;
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function buttonLabel(btn) {
  return (btn.getAttribute('aria-label') || btn.innerText || btn.textContent || '').trim().toLowerCase();
}

function reactOnClick(node) {
  if (!node) return false;
  const key = Object.keys(node).find((k) => k.startsWith('__reactProps$'));
  const fn = key && node[key] && node[key].onClick;
  if (typeof fn !== 'function') return false;
  fn.call(node, {
    preventDefault() {},
    stopPropagation() {},
    persist() {},
    target: node,
    currentTarget: node,
    type: 'click',
    bubbles: true,
    button: 0,
    nativeEvent: { isTrusted: true, target: node }
  });
  return true;
}

function press(el) {
  if (reactOnClick(el)) return;
  for (const child of el.children) {
    if (reactOnClick(child)) return;
  }
  el.click();
}

// "More models" is an szh hover-submenu (onPointerEnter) that does NOT open on click, so press() can't reveal its items.
function hoverEl(el) {
  if (!el) return;
  const P = window.PointerEvent || MouseEvent;
  for (const type of ['pointerover', 'pointerenter', 'pointermove']) {
    try { el.dispatchEvent(new P(type, { bubbles: true, cancelable: true, view: window, pointerId: 1 })); } catch (e) {}
  }
  for (const type of ['mouseover', 'mouseenter', 'mousemove']) {
    try { el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window })); } catch (e) {}
  }
}
