// Password hashing (PBKDF2 via Web Crypto — no native deps) and session-token
// helpers. The stored session id is HMAC-SHA256(rawToken, SESSION_SECRET) so a
// leaked DB row cannot be replayed as a cookie.

const ITER = 100_000;
const enc = new TextEncoder();

function b64(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}
function fromB64(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}
function hex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function pbkdf2(password: string, salt: Uint8Array, iter: number): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, key, 256);
}

// Format: pbkdf2$<iterations>$<saltB64>$<hashB64>  (matches scripts/create-user.mjs)
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const bits = await pbkdf2(password, salt, ITER);
  return `pbkdf2$${ITER}$${b64(salt.buffer)}$${b64(bits)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, iterS, saltS, hashS] = stored.split('$');
  if (scheme !== 'pbkdf2') return false;
  const bits = new Uint8Array(await pbkdf2(password, fromB64(saltS), Number(iterS)));
  const want = fromB64(hashS);
  if (bits.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < bits.length; i++) diff |= bits[i] ^ want[i];
  return diff === 0;
}

export function newToken(): string {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...raw)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function sessionId(token: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(token));
  return hex(sig);
}
