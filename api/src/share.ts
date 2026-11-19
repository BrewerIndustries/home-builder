// Read-only share links: the link carries a random 256-bit token; D1 keeps only
// its SHA-256, so a database read can't be turned back into working links.

const enc = new TextEncoder();

/** 43 base64url characters (32 random bytes). */
export function newShareToken(): string {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...raw)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function validShareToken(s: unknown): s is string {
  return typeof s === 'string' && /^[A-Za-z0-9_-]{43}$/.test(s);
}

export async function hashShareToken(token: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', enc.encode(token));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const MAX_THUMB = 6000;

/** A plan thumbnail as the app makes it (src/model/thumbnail.ts); anything else is dropped. */
export function cleanThumb(s: unknown): string | null {
  if (typeof s !== 'string' || s.length > MAX_THUMB) return null;
  if (!/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="[\d .-]+">/.test(s) || !s.endsWith('</svg>')) return null;
  // Only the elements and attributes the generator writes.
  const tags = s.match(/<\/?[a-zA-Z]+/g) ?? [];
  if (tags.some((t) => !/^<\/?(svg|path)$/.test(t))) return null;
  const attrs = s.match(/\s([a-zA-Z-]+)=/g) ?? [];
  const ok = new Set(['xmlns', 'viewBox', 'd', 'fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-linecap']);
  if (attrs.some((a) => !ok.has(a.trim().slice(0, -1)))) return null;
  if (/url\(|javascript:|&/i.test(s)) return null;
  return s;
}
