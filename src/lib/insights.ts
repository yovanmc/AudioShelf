import type { DayCell } from "./api";

/** Quantize a count into a 0..4 heat level given the max count in the grid. */
export function heatLevel(count: number, max: number): 0 | 1 | 2 | 3 | 4 {
  if (count <= 0 || max <= 0) return 0;
  const r = count / max;
  if (r > 0.75) return 4;
  if (r > 0.5) return 3;
  if (r > 0.25) return 2;
  return 1;
}

/** Weekday for a local-day index, Sunday=0..Saturday=6 (matches the Rust weekday_of). */
export function weekdayOfDay(day: number): number {
  return ((day - 3) % 7 + 7) % 7;
}

export function maxCount(cells: DayCell[]): number {
  return cells.reduce((m, c) => (c.count > m ? c.count : m), 0);
}

/**
 * Arrange a flat oldest→newest cell list into GitHub-style columns of 7 (one column per week,
 * row = weekday Sun..Sat). The first column is top-padded with nulls so the first real cell sits
 * in its correct weekday row.
 */
export function heatColumns(cells: DayCell[]): (DayCell | null)[][] {
  if (cells.length === 0) return [];
  const cols: (DayCell | null)[][] = [];
  let col: (DayCell | null)[] = [];
  const firstWd = weekdayOfDay(cells[0].day);
  for (let i = 0; i < firstWd; i++) col.push(null);
  for (const c of cells) {
    col.push(c);
    if (col.length === 7) {
      cols.push(col);
      col = [];
    }
  }
  if (col.length > 0) {
    while (col.length < 7) col.push(null);
    cols.push(col);
  }
  return cols;
}
