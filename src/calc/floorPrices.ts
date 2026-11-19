// Sample prices for the Floor v2 lines (calc/floor.ts): ballpark figures so the
// estimate isn't empty, not quotes. Per the line's unit.
export const FLOOR_SAMPLE: [RegExp, number][] = [
  [/^I-joist, /, 3.5], // per LF
  [/^Rim board/, 3], // per LF
  [/^LVL girder/, 14], // per LF
  [/^Double I-joist hanger/, 12],
  [/^I-joist hanger/, 5],
  [/^Double joist hanger/, 7],
  [/^Joist hanger/, 2.5],
  [/^R-19 /, 0.95], // per sq ft
  [/^R-38 /, 1.75],
  [/^Insulation supports/, 0.15],
];
