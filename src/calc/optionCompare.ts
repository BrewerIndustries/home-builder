import { optionProjects } from '../model/options.ts';
import type { Project } from '../model/types.ts';
import { phasedEstimate } from './phasing.ts';
import type { Estimate } from './pricing.ts';

// Side-by-side cost of the design options: each option's estimate (new work +
// demolition, with the project's one price list), by category and in total.

export interface OptionCost {
  id: string;
  name: string;
  active: boolean;
  est: Estimate;
  /** Category → total; missing categories are 0. */
  byCategory: Record<string, number>;
}

export interface OptionCompare {
  options: OptionCost[];
  /** Every category any option has, in first-seen order. */
  categories: string[];
}

export function compareOptions(p: Project): OptionCompare {
  const options = optionProjects(p).map(({ option, active, project }) => {
    const est = phasedEstimate(project);
    return { id: option.id, name: option.name, active, est, byCategory: Object.fromEntries(est.byCategory.map((c) => [c.category, c.total])) };
  });
  const categories = [...new Set(options.flatMap((o) => o.est.byCategory.map((c) => c.category)))];
  return { options, categories };
}
