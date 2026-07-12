import {
  describeBadge,
  failRow,
  initialTestRows,
  passRow,
  runningRow,
  summarizeTestRows,
  TestVideoFixture,
} from '../src/log/testSuite';

const FIXTURES: TestVideoFixture[] = [
  { id: 'FaDDitH2WtU', label: 'The debate' },
  { id: 'dQw4w9WgXcQ', label: 'Rick Astley' },
  { id: '7-ex2qeAkdc', label: 'Dr K' },
];

describe('describeBadge', () => {
  it('maps each status to a badge text + color', () => {
    expect(describeBadge('pending').text).toBe('PENDING');
    expect(describeBadge('running').text).toBe('RUNNING...');
    expect(describeBadge('pass').text).toBe('PASS');
    expect(describeBadge('fail').text).toBe('FAIL');
    // Colors are distinct pass/fail so the eye reads the row instantly.
    expect(describeBadge('pass').color).not.toEqual(describeBadge('fail').color);
    expect(describeBadge('pending').color).toEqual(describeBadge('running').color);
  });
});

describe('row builders', () => {
  it('initialTestRows starts every fixture pending with empty detail', () => {
    const rows = initialTestRows(FIXTURES);
    expect(rows).toHaveLength(FIXTURES.length);
    for (const row of rows) {
      expect(row.status).toBe('pending');
      expect(row.detail).toBe('');
    }
  });

  it('passRow encodes segment count in detail', () => {
    expect(passRow(124)).toEqual({ status: 'pass', detail: 'segments=124' });
  });

  it('failRow truncates long error messages to 80 chars', () => {
    const long = 'x'.repeat(200);
    const row = failRow(long);
    expect(row.status).toBe('fail');
    expect(row.detail).toHaveLength(80);
  });

  it('runningRow clears detail on retry', () => {
    expect(runningRow()).toEqual({ status: 'running', detail: '' });
  });
});

describe('summarizeTestRows', () => {
  it('renders one line per fixture with badge + id + label + detail', () => {
    const rows = [passRow(124), failRow('boom'), runningRow()];
    const lines = summarizeTestRows(FIXTURES, rows);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('PASS');
    expect(lines[0]).toContain('FaDDitH2WtU');
    expect(lines[0]).toContain('The debate');
    expect(lines[0]).toContain('segments=124');
    expect(lines[1]).toContain('FAIL');
    expect(lines[1]).toContain('boom');
    expect(lines[2]).toContain('RUNNING');
  });

  it('falls back to pending when the row array is shorter than fixtures', () => {
    const lines = summarizeTestRows(FIXTURES, []);
    expect(lines).toHaveLength(3);
    for (const line of lines) {
      expect(line).toContain('PENDING');
    }
  });
});
