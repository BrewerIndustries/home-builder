// Imperial length formatting and parsing. Internal unit is the inch.

/** 150.5 → `12' 6-1/2"`. Rounds to the nearest 1/16". */
export function formatFtIn(inches: number, { compact = false } = {}): string {
  const sign = inches < 0 ? '-' : '';
  let sixteenths = Math.round(Math.abs(inches) * 16);
  const ft = Math.floor(sixteenths / (12 * 16));
  sixteenths -= ft * 12 * 16;
  const whole = Math.floor(sixteenths / 16);
  let frac = sixteenths - whole * 16;
  let fracStr = '';
  if (frac) {
    let den = 16;
    while (frac % 2 === 0) {
      frac /= 2;
      den /= 2;
    }
    fracStr = `-${frac}/${den}`;
  }
  const inStr = `${whole}${fracStr}"`;
  if (!ft) return sign + inStr;
  if (compact && !whole && !fracStr) return `${sign}${ft}'`;
  return `${sign}${ft}' ${inStr}`;
}

/**
 * Parse what people actually type: `12'6"`, `12' 6-1/2"`, `12 6`, `12.5'`, `150"`,
 * `150` (bare number = inches), `3/4"`. Returns inches, or null if unparseable.
 */
export function parseFtIn(text: string): number | null {
  const s = text.trim().toLowerCase().replace(/feet|foot|ft/g, "'").replace(/inches|inch|in/g, '"');
  if (!s) return null;

  const num = String.raw`(\d+(?:\.\d+)?)`;
  const frac = String.raw`(?:[\s-]+(\d+)\/(\d+))?`;
  const fracOnly = /^(\d+)\/(\d+)\s*"?$/;

  const fo = s.match(fracOnly);
  if (fo) return Number(fo[1]) / Number(fo[2]);

  // feet with optional inches: 12'  /  12' 6  /  12'6-1/2"
  let m = s.match(new RegExp(String.raw`^${num}\s*'\s*(?:${num}${frac}\s*"?)?$`));
  if (m) {
    const inches = m[2] ? Number(m[2]) + (m[3] ? Number(m[3]) / Number(m[4]) : 0) : 0;
    return Number(m[1]) * 12 + inches;
  }
  // inches only: 150"  /  6-1/2"  /  150
  m = s.match(new RegExp(String.raw`^${num}${frac}\s*"?$`));
  if (m) return Number(m[1]) + (m[2] ? Number(m[2]) / Number(m[3]) : 0);
  // "12 6" → 12 ft 6 in
  m = s.match(new RegExp(String.raw`^${num}\s+${num}${frac}$`));
  if (m) return Number(m[1]) * 12 + Number(m[2]) + (m[3] ? Number(m[3]) / Number(m[4]) : 0);
  return null;
}

export function formatSqFt(sqIn: number): string {
  return `${(sqIn / 144).toLocaleString(undefined, { maximumFractionDigits: 0 })} sq ft`;
}
