// Hash routing: deep link & refresh tidak menghasilkan 404 di hosting statis mana pun.
import { useSyncExternalStore } from 'react';

export type Query = Record<string, string>;

function parse(): { path: string; query: URLSearchParams } {
  const raw = window.location.hash.replace(/^#/, '') || '/';
  const [p, q = ''] = raw.split('?');
  return { path: p || '/', query: new URLSearchParams(q) };
}

let snapshot = parse();
let key = window.location.hash;
const subscribe = (cb: () => void) => {
  const h = () => {
    if (window.location.hash !== key) {
      key = window.location.hash;
      snapshot = parse();
    }
    cb();
  };
  window.addEventListener('hashchange', h);
  return () => window.removeEventListener('hashchange', h);
};

export function useRoute() {
  return useSyncExternalStore(subscribe, () => snapshot);
}

export function href(path: string, query: Query = {}): string {
  const q = new URLSearchParams(Object.entries(query).filter(([, v]) => v !== '' && v != null)).toString();
  return `#${path}${q ? `?${q}` : ''}`;
}

export function navigate(path: string, query: Query = {}, opts: { replace?: boolean } = {}) {
  const target = href(path, query);
  if (opts.replace) {
    history.replaceState(null, '', target);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else {
    window.location.hash = target.slice(1);
  }
}
