import { Platform } from 'react-native';

/**
 * Browser only. (1) No scrollbars anywhere: a phone app has none. (2) Sideways rows can be dragged with the mouse, as a
 * finger would, since a mouse has no horizontal swipe (a trackpad or Shift + wheel already worked).
 */
export function installWebScrolling() {
  if (Platform.OS !== 'web' || typeof document === 'undefined' || (window as any).__htScroll) return;
  (window as any).__htScroll = true;

  const style = document.createElement('style');
  style.textContent = '*{scrollbar-width:none;-ms-overflow-style:none}*::-webkit-scrollbar{display:none;width:0;height:0}';
  document.head.appendChild(style);

  const scroller = (start: EventTarget | null): HTMLElement | null => {
    let el = start as HTMLElement | null;
    while (el && el !== document.body) {
      if (el.scrollWidth > el.clientWidth + 2) {
        const ox = getComputedStyle(el).overflowX;
        if (ox === 'auto' || ox === 'scroll') return el;
      }
      el = el.parentElement;
    }
    return null;
  };

  let el: HTMLElement | null = null;
  let startX = 0;
  let startLeft = 0;
  let moved = false;

  document.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    // never hijack text fields or the map
    if ((e.target as HTMLElement).closest?.('input,textarea,select,.leaflet-container')) return;
    el = scroller(e.target);
    if (!el) return;
    startX = e.clientX;
    startLeft = el.scrollLeft;
    moved = false;
  });
  document.addEventListener('mousemove', (e) => {
    if (!el) return;
    const dx = e.clientX - startX;
    if (!moved && Math.abs(dx) < 5) return;
    if (!moved) {
      moved = true;
      el.style.scrollSnapType = 'none'; // free dragging, then snap to a card on release
      el.style.cursor = 'grabbing';
      el.style.userSelect = 'none';
    }
    el.scrollLeft = startLeft - dx;
    e.preventDefault();
  });
  const end = () => {
    if (el && moved) {
      el.style.scrollSnapType = '';
      el.style.cursor = '';
      el.style.userSelect = '';
      // the click that follows a drag is swallowed; forget the drag soon after in case no click comes
      setTimeout(() => (moved = false), 60);
    }
    el = null;
  };
  document.addEventListener('mouseup', end);
  document.addEventListener('mouseleave', end);
  // a drag must not count as a tap on the card underneath
  document.addEventListener(
    'click',
    (e) => {
      if (moved) {
        e.stopPropagation();
        e.preventDefault();
      }
    },
    true,
  );
}
