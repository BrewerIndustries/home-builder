// Read-only share links (`?share=<token>`). The Worker makes the token
// (api/src/share.ts): 32 random bytes, base64url, 43 characters.

const TOKEN = /^[A-Za-z0-9_-]{43}$/;

/** The share token in a page address, if it's a well-formed one. */
export function shareTokenFrom(search: string): string | null {
  const t = new URLSearchParams(search).get('share');
  return t && TOKEN.test(t) ? t : null;
}

const KEY = (projectId: string) => `home-builder:share:${projectId}`;

/** The owner's copy of a live link's token, so this device can copy the link again. */
export function rememberedShare(projectId: string): string | null {
  try {
    const t = localStorage.getItem(KEY(projectId));
    return t && TOKEN.test(t) ? t : null;
  } catch {
    return null;
  }
}

export function rememberShare(projectId: string, token: string | null) {
  try {
    if (token) localStorage.setItem(KEY(projectId), token);
    else localStorage.removeItem(KEY(projectId));
  } catch {
    // storage blocked — the link can still be replaced with a new one
  }
}
