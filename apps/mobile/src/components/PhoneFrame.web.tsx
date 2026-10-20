import { useEffect, useState, type ReactNode } from 'react';

const KEY = 'ht_phone_view';
const PHONE_W = 390;
const PHONE_H = 844;

/**
 * Browser only. On a computer-sized window the app is shown inside a phone-sized frame, so you can see exactly how it
 * looks on a phone without opening the developer tools. A small button switches to the full-width desktop layout and
 * back. The frame is the same app running in an iframe at phone size, so every size, breakpoint and gesture is real.
 * On a real phone, in a small window, or inside the frame itself, nothing is added.
 */
export function PhoneFrame({ children }: { children: ReactNode }) {
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  const [phone, setPhone] = useState(() => {
    try {
      return localStorage.getItem(KEY) !== 'off';
    } catch {
      return true;
    }
  });
  useEffect(() => {
    const on = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);

  const embedded = window.self !== window.top;
  if (embedded || size.w < 900) return <>{children}</>;

  const toggle = () => {
    const next = !phone;
    setPhone(next);
    try {
      localStorage.setItem(KEY, next ? 'on' : 'off');
    } catch {
      /* the choice just is not remembered */
    }
  };
  const button = (
    <button
      onClick={toggle}
      aria-label={phone ? 'Switch to the desktop layout' : 'Switch to the phone view'}
      // top-right beside the phone; bottom-right in the desktop layout so it never covers the app's own HERE | THERE switch
      style={{ position: 'fixed', ...(phone ? { top: 12 } : { bottom: 14 }), right: 14, zIndex: 99999, border: '1px solid rgba(0,0,0,0.12)', background: 'rgba(255,255,255,0.92)', color: '#102F29', borderRadius: 999, padding: '7px 14px', fontSize: 12, fontWeight: 700, letterSpacing: 0.3, cursor: 'pointer', boxShadow: '0 2px 8px rgba(0,0,0,0.12)', fontFamily: 'system-ui, sans-serif' }}
    >
      {phone ? 'Desktop view' : 'Phone view'}
    </button>
  );
  if (!phone)
    return (
      <>
        {children}
        {button}
      </>
    );

  const h = Math.min(PHONE_H, size.h - 56);
  const url = new URL(window.location.href);
  url.searchParams.set('embedded', '1');
  return (
    <div style={{ position: 'fixed', inset: 0, background: '#E6EBE8', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, fontFamily: 'system-ui, sans-serif' }}>
      {button}
      <div style={{ width: PHONE_W + 20, height: h + 20, padding: 10, boxSizing: 'border-box', background: '#0B1B17', borderRadius: 44, boxShadow: '0 24px 60px rgba(0,0,0,0.28)' }}>
        <iframe title="HERE & THERE in a phone" src={url.toString()} style={{ width: '100%', height: '100%', border: 0, borderRadius: 34, background: '#fff', display: 'block' }} allow="geolocation" />
      </div>
      <div style={{ fontSize: 12, color: '#5B6B66' }}>Phone view · {PHONE_W} × {Math.round(h)}</div>
    </div>
  );
}
