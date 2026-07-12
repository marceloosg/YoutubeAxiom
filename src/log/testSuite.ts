/**
 * Pure helpers for the on-device test harness (s157 UI revision).
 *
 * Kept separate from `App.tsx` so the badge / detail derivation has a clean
 * seam for unit testing. The React component owns the row state array; this
 * module only maps `{status, segments?, errorMessage?}` -> `{badge, detail}`.
 */

export type TestRowStatus = 'pending' | 'running' | 'pass' | 'fail';

export interface TestVideoFixture {
  id: string;
  /** Human-readable name Marcelo uses in TG (e.g. "The debate"). */
  label: string;
}

export interface TestRowState {
  status: TestRowStatus;
  /** Result summary shown next to the badge (e.g. "segments=124" / err msg). */
  detail: string;
}

export interface BadgeDescriptor {
  text: string;
  /** Hex color; consumed inline by `<Text style={{color}}>` in App.tsx. */
  color: string;
}

const BADGE_MAP: Record<TestRowStatus, BadgeDescriptor> = {
  pending: { text: 'PENDING', color: '#888' },
  running: { text: 'RUNNING...', color: '#888' },
  pass: { text: 'PASS', color: '#0a7f2e' },
  fail: { text: 'FAIL', color: '#c00' },
};

export function describeBadge(status: TestRowStatus): BadgeDescriptor {
  return BADGE_MAP[status];
}

export function initialTestRows(fixtures: readonly TestVideoFixture[]): TestRowState[] {
  return fixtures.map(() => ({ status: 'pending', detail: '' }));
}

export function passRow(segments: number): TestRowState {
  return { status: 'pass', detail: `segments=${segments}` };
}

export function failRow(errorMessage: string): TestRowState {
  const truncated = errorMessage.slice(0, 80);
  return { status: 'fail', detail: truncated };
}

export function runningRow(): TestRowState {
  return { status: 'running', detail: '' };
}

/**
 * Text summary of a completed test-suite run, appended to the shared log
 * header so a single share-out captures the pass/fail matrix without needing
 * the UI screenshot.
 */
export function summarizeTestRows(
  fixtures: readonly TestVideoFixture[],
  rows: readonly TestRowState[]
): string[] {
  return fixtures.map((f, i) => {
    const row = rows[i] ?? { status: 'pending' as const, detail: '' };
    const badge = BADGE_MAP[row.status].text;
    return `  ${badge}  ${f.id}  ${f.label}  ${row.detail}`.trimEnd();
  });
}
