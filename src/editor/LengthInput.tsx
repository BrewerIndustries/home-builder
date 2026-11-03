import { useEffect, useState } from 'react';
import { formatFtIn, parseFtIn } from '../model/units.ts';

/** Feet-inches text field: shows `12' 6"`, accepts anything parseFtIn understands, commits on blur / Enter. */
export function LengthInput({ value, onChange, min = 0 }: { value: number; onChange(v: number): void; min?: number }) {
  const [text, setText] = useState(formatFtIn(value));
  const [bad, setBad] = useState(false);
  useEffect(() => setText(formatFtIn(value)), [value]);

  function commit() {
    const v = parseFtIn(text);
    if (v === null || v < min) {
      setBad(true);
      return;
    }
    setBad(false);
    if (Math.abs(v - value) > 1e-6) onChange(v);
    setText(formatFtIn(v));
  }

  return (
    <input
      className={bad ? 'invalid' : undefined}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') setText(formatFtIn(value));
      }}
    />
  );
}

const showAngle = (v: number) => `${Math.round(v * 10) / 10}°`;

/** Degrees text field (`45°` or `45`), commits on blur / Enter like LengthInput. */
export function AngleInput({ value, onChange }: { value: number; onChange(v: number): void }) {
  const [text, setText] = useState(showAngle(value));
  const [bad, setBad] = useState(false);
  useEffect(() => setText(showAngle(value)), [value]);

  function commit() {
    const v = Number(text.replace(/°|deg/gi, '').trim());
    if (!text.trim() || !Number.isFinite(v)) {
      setBad(true);
      return;
    }
    setBad(false);
    const a = ((v % 360) + 360) % 360;
    if (Math.abs(a - value) > 1e-6) onChange(a);
    setText(showAngle(a));
  }

  return (
    <input
      className={bad ? 'invalid' : undefined}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') setText(showAngle(value));
      }}
    />
  );
}
