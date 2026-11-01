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
