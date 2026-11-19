import { money } from './pricing.ts';
import type { ChangeOrder, PlanChange } from './planDiff.ts';

// The change order as a stand-alone printable page (opened in a new window).

export const signed = (n: number) => (n > 0 ? '+' : n < 0 ? '−' : '') + money(Math.abs(n));
export const KIND_LABEL = { added: 'Added', removed: 'Removed', changed: 'Changed' } as const;

const esc = (s: string | number) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export function changeOrderHtml(project: string, from: string, to: string, changes: PlanChange[], co: ChangeOrder, date = new Date()): string {
  const list = (k: PlanChange['kind']) => {
    const xs = changes.filter((c) => c.kind === k);
    return xs.length ? `<h3>${KIND_LABEL[k]}</h3><ul>${xs.map((c) => `<li>${esc(c.text)}</li>`).join('')}</ul>` : '';
  };
  const rows = co.lines
    .map((l) => `<tr><td>${esc(l.item)}</td><td>${esc(l.category)}</td><td class="n">${l.before} ${esc(l.unit)}</td><td class="n">${l.after} ${esc(l.unit)}</td><td class="n">${esc(money(l.unitPrice))}</td><td class="n">${esc(signed(l.delta))}</td></tr>`)
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Change order — ${esc(project)}</title><style>
body{font:13px/1.4 system-ui,sans-serif;margin:32px;color:#111}h1{font-size:20px;margin:0 0 4px}h2{font-size:15px;margin:24px 0 6px}h3{font-size:13px;margin:12px 0 4px}
table{border-collapse:collapse;width:100%}th,td{border-bottom:1px solid #ccc;padding:4px 6px;text-align:left}.n{text-align:right;white-space:nowrap}tr.t td{font-weight:700;border-top:2px solid #111}
.muted{color:#666}.sig{margin-top:40px;display:flex;gap:48px}.sig div{flex:1;border-top:1px solid #111;padding-top:4px}
</style></head><body>
<h1>Change order — ${esc(project)}</h1>
<div class="muted">${esc(from)} → ${esc(to)} · ${esc(date.toLocaleDateString(undefined, { dateStyle: 'long' }))}</div>
<h2>Plan changes</h2>${changes.length ? list('added') + list('removed') + list('changed') : '<p>No changes to the plan.</p>'}
<h2>Estimate changes</h2>
<table><thead><tr><th>Item</th><th>Category</th><th class="n">Was</th><th class="n">Now</th><th class="n">Unit price</th><th class="n">Change</th></tr></thead><tbody>${rows}
<tr><td colspan="5">Materials</td><td class="n">${esc(signed(co.subtotal))}</td></tr>
<tr><td colspan="5">Sales tax</td><td class="n">${esc(signed(co.tax))}</td></tr>
<tr><td colspan="5">Markup</td><td class="n">${esc(signed(co.markup))}</td></tr>
<tr class="t"><td colspan="5">Change order total (estimate ${esc(money(co.before.total))} → ${esc(money(co.after.total))})</td><td class="n">${esc(signed(co.total))}</td></tr>
</tbody></table>
<p class="muted">Material quantities from the plan, priced with the project's price list (sample prices where none is set). An estimate, not a quote.</p>
<div class="sig"><div>Owner / date</div><div>Contractor / date</div></div>
</body></html>`;
}

