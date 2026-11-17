import { describe, expect, it } from 'vitest';
import { OUTCOME_ERROR, OUTCOME_OK, OUTCOME_TIMEOUT } from '../../../shared/replay.js';
import {
  checkIncidentSize,
  formatProblem,
  INCIDENT_LIMITS,
  parseIncidentText,
  parseTimestamp,
  readCsv,
  timelineToCsv,
  type ParsedIncident,
} from '../local/incidentFile.js';
import { SAMPLE_INCIDENTS } from '../local/incidentFixtures.js';

const START = Date.UTC(2024, 2, 4, 12, 0, 0);

function ok(text: string): ParsedIncident {
  const result = parseIncidentText(text, 'incident.csv');
  if (!result.ok) throw new Error(`expected a readable file: ${result.problems.map((p) => formatProblem('incident.csv', p)).join(' | ')}`);
  return result.incident;
}

function problems(text: string): string[] {
  const result = parseIncidentText(text, 'incident.csv');
  if (result.ok) throw new Error('expected the file to be refused');
  return result.problems.map((problem) => formatProblem('incident.csv', problem));
}

describe('timestamps', () => {
  it('reads ISO times with Z, an offset, no zone, a space or fractions', () => {
    expect(parseTimestamp('2024-03-04T12:00:00Z')).toBe(START);
    expect(parseTimestamp('2024-03-04T12:00:00.250Z')).toBe(START + 250);
    expect(parseTimestamp('2024-03-04T12:00:00.2504567Z')).toBe(START + 250);
    expect(parseTimestamp('2024-03-04T14:00:00+02:00')).toBe(START);
    expect(parseTimestamp('2024-03-04T07:00:00-0500')).toBe(START);
    expect(parseTimestamp('2024-03-04T12:00:00')).toBe(START);
    expect(parseTimestamp('2024-03-04 12:00:00')).toBe(START);
    expect(parseTimestamp('2024-03-04')).toBe(Date.UTC(2024, 2, 4));
    expect(parseTimestamp(' 2024-03-04T12:00Z ')).toBe(START);
  });

  it('reads epoch milliseconds and refuses epoch seconds with a clear reason', () => {
    expect(parseTimestamp('1709553600000')).toBe(1709553600000);
    expect(parseTimestamp('1709553600')).toMatch(/looks like epoch seconds; use epoch milliseconds/);
  });

  it('refuses things that are not times, and dates that do not exist', () => {
    expect(parseTimestamp('yesterday')).toMatch(/is not an ISO time/);
    expect(parseTimestamp('2024-02-31T10:00:00Z')).toMatch(/not a real date and time/);
    expect(parseTimestamp('2024-13-01T10:00:00Z')).toMatch(/not a real date and time/);
    expect(parseTimestamp('2024-03-04T25:00:00Z')).toMatch(/not a real date and time/);
    expect(parseTimestamp('')).toMatch(/is not an ISO time/);
  });
});

describe('reading CSV', () => {
  it('handles a byte order mark, CRLF, CR and LF line ends and blank lines', () => {
    const lines = readCsv('﻿a,b\r\n1,2\r\n\r\n3,4\r5,6\n');
    expect(lines.map((l) => [l.line, l.fields])).toEqual([
      [1, ['a', 'b']],
      [2, ['1', '2']],
      [4, ['3', '4']],
      [5, ['5', '6']],
    ]);
  });

  it('handles quoted values with commas, doubled quotes and line breaks, keeping real line numbers', () => {
    const lines = readCsv('a,b,c\n"x, y","say ""hi""",z\n"two\nlines",2,3\nlast,1,1');
    expect(lines.map((l) => [l.line, l.fields])).toEqual([
      [1, ['a', 'b', 'c']],
      [2, ['x, y', 'say "hi"', 'z']],
      [3, ['two\nlines', '2', '3']],
      [5, ['last', '1', '1']],
    ]);
  });

  it('flags an unclosed quote on the line it starts', () => {
    const lines = readCsv('a,b\n1,"never closed\n2,3');
    expect(lines[1].line).toBe(2);
    expect(lines[1].problem).toBe('a quoted value is never closed');
  });

  it('flags text after a closing quote and carries on with the next line', () => {
    const lines = readCsv('a,b\n"x"y,2\n3,4');
    expect(lines[1].problem).toMatch(/unexpected text after a closing quote/);
    expect(lines[2]).toMatchObject({ line: 3, fields: ['3', '4'] });
  });
});

describe('one row per call', () => {
  it('reads calls with a header, whatever the column order, and ignores extra columns', () => {
    const incident = ok('latency_ms,note,outcome,timestamp\n40,first,ok,2024-03-04T12:00:00Z\n900,,TIMEOUT,2024-03-04T12:00:01Z\n12, x ,Error,1709553602000\n');
    expect(incident.format).toBe('calls');
    expect(incident.rows).toBe(3);
    expect(Array.from(incident.timeline.t)).toEqual([START, START + 1000, START + 2000]);
    expect(Array.from(incident.timeline.outcome)).toEqual([OUTCOME_OK, OUTCOME_TIMEOUT, OUTCOME_ERROR]);
    expect(Array.from(incident.timeline.latencyMs)).toEqual([40, 900, 12]);
    expect(incident.hasLatency).toBe(true);
    expect(incident.skippedCount).toBe(0);
    expect(incident.sorted).toBe(false);
  });

  it('accepts a file with a byte order mark, CRLF line ends and quoted values', () => {
    const incident = ok('﻿"timestamp","outcome","latency_ms"\r\n"2024-03-04T12:00:00Z","ok","40"\r\n"2024-03-04T12:00:01Z","error",""\r\n');
    expect(incident.rows).toBe(2);
    expect(Array.from(incident.timeline.latencyMs)).toEqual([40, 0]);
  });

  it('puts rows in time order and says it did', () => {
    const incident = ok('timestamp,outcome,latency_ms\n2024-03-04T12:00:05Z,error,5\n2024-03-04T12:00:01Z,ok,1\n2024-03-04T12:00:05Z,ok,6\n');
    expect(incident.sorted).toBe(true);
    expect(Array.from(incident.timeline.t)).toEqual([START + 1000, START + 5000, START + 5000]);
    expect(Array.from(incident.timeline.latencyMs)).toEqual([1, 5, 6]);
  });

  it('skips a minority of bad rows and reports each with its real line number and reason', () => {
    const rows = ['timestamp,outcome,latency_ms'];
    for (let i = 0; i < 12; i++) rows.push(`2024-03-04T12:00:${String(i).padStart(2, '0')}Z,ok,10`);
    rows.splice(4, 0, '2024-03-04T12:00:99Z,ok,10');
    rows.splice(9, 0, '2024-03-04T12:00:07Z,maybe,10');
    rows.splice(11, 0, '2024-03-04T12:00:08Z,ok,fast');
    const incident = ok(rows.join('\n'));
    expect(incident.rows).toBe(12);
    expect(incident.skippedCount).toBe(3);
    expect(incident.skipped.map((p) => formatProblem('incident.csv', p))).toEqual([
      'incident.csv, line 5: timestamp "2024-03-04T12:00:99Z" is not a real date and time',
      'incident.csv, line 10: outcome "maybe" must be ok, error or timeout',
      'incident.csv, line 12: latency_ms "fast" must be a number of 0 or more',
    ]);
  });

  it('counts line numbers physically, so a quoted multi-line value does not shift later lines', () => {
    const incident = ok('timestamp,outcome,latency_ms\n2024-03-04T12:00:00Z,ok,1\n"2024-03-04T12:00:01Z\nbroken",ok,1\n2024-03-04T12:00:02Z,ok,1\n2024-03-04T12:00:03Z,ok,1\n2024-03-04T12:00:04Z,ok,1\n2024-03-04T12:00:05Z,nope,1\n');
    expect(incident.skipped.map((p) => p.line)).toEqual([3, 8]);
  });

  it('refuses a missing latency on an ok call but allows one on a failed call', () => {
    const many = ['timestamp,outcome,latency_ms', ...Array.from({ length: 9 }, (_, i) => `2024-03-04T12:00:0${i}Z,ok,5`), '2024-03-04T12:00:10Z,ok,', '2024-03-04T12:00:11Z,error,'];
    const incident = ok(many.join('\n'));
    expect(incident.skipped.map((p) => [p.line, p.message])).toEqual([[11, 'latency_ms is empty for an ok call; give its duration in milliseconds']]);
    expect(incident.rows).toBe(10);
  });

  it('refuses the whole file when half or more of the rows are bad, listing the first problems', () => {
    const lines = problems('timestamp,outcome,latency_ms\n2024-03-04T12:00:00Z,ok,1\nnot a time,ok,1\n2024-03-04T12:00:02Z,wrong,1\n');
    expect(lines[0]).toBe('incident.csv: 2 of 3 rows could not be read, so the file is probably in a different format or damaged. Nothing was loaded. The first problems are listed below.');
    expect(lines).toContain('incident.csv, line 3: timestamp "not a time" is not an ISO time (for example 2024-03-04T12:00:00Z) or epoch milliseconds');
    expect(lines).toContain('incident.csv, line 4: outcome "wrong" must be ok, error or timeout');
  });

  it('lists at most twenty problems and says more follow', () => {
    const rows = ['timestamp,outcome,latency_ms', ...Array.from({ length: 30 }, () => 'x,ok,1')];
    const result = parseIncidentText(rows.join('\n'), 'incident.csv');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.problems.length).toBe(INCIDENT_LIMITS.listed + 1);
      expect(result.truncated).toBe(true);
    }
  });

  it('reports a row with too few columns', () => {
    const rows = ['timestamp,outcome,latency_ms', '2024-03-04T12:00:00Z,ok', '2024-03-04T12:00:01Z,ok,5', '2024-03-04T12:00:02Z,ok,5', '2024-03-04T12:00:03Z,ok,5'];
    expect(ok(rows.join('\n')).skipped[0]).toEqual({ line: 2, message: 'expected at least 3 columns to match the header, found 2' });
  });
});

describe('file-level problems', () => {
  it('requires a header and says what to add, with the line number', () => {
    expect(problems('2024-03-04T12:00:00Z,ok,5\n')).toEqual([
      'incident.csv, line 1: the first row is data, but a header row is required. expected a header row with the columns timestamp,outcome,latency_ms (one call per row) or timestamp,requests,errors (one interval per row), found "2024-03-04T12:00:00Z,ok,5"',
    ]);
    expect(problems('time,result,ms\n1,2,3\n')[0]).toMatch(/^incident\.csv, line 1: expected a header row with the columns/);
  });

  it('puts the header line number after leading blank lines', () => {
    expect(problems('\n\nwhen,what\n')[0]).toMatch(/^incident\.csv, line 3:/);
  });

  it('refuses an empty file, a header with no rows and a repeated column', () => {
    expect(problems('')).toEqual(['incident.csv: the file is empty. Add a header row and one row per call, for example: timestamp,outcome,latency_ms']);
    expect(problems('timestamp,outcome,latency_ms\n')).toEqual(['incident.csv, line 1: the file has a header but no rows']);
    expect(problems('timestamp,outcome,latency_ms,outcome\n1,2,3,4')[0]).toMatch(/line 1: the header repeats a column name/);
  });

  it('gives a specific message for a file over the size limit', () => {
    expect(checkIncidentSize('big.csv', 1024)).toBeNull();
    expect(checkIncidentSize('big.csv', INCIDENT_LIMITS.fileBytes)).toBeNull();
    const problem = checkIncidentSize('big.csv', 7.25 * 1024 * 1024);
    expect(problem && formatProblem('big.csv', problem)).toBe(
      'big.csv: big.csv is 7.3 MB and the limit is 5.0 MB. Trim it to the hours around the incident, or use the per-interval form (timestamp,requests,errors), which is much smaller.'
    );
  });

  it('gives a specific message for too many rows', () => {
    const rows = ['timestamp,requests,errors', ...Array.from({ length: INCIDENT_LIMITS.rows + 1 }, (_, i) => `${START + i * 1000},1,0`)];
    expect(problems(rows.join('\n'))[0]).toContain('has 200,001 data rows and the limit is 200,000');
  });
});

describe('one row per interval', () => {
  it('spreads requests evenly across the interval and errors evenly among them', () => {
    const incident = ok('timestamp,requests,errors\n2024-03-04T12:00:00Z,10,3\n2024-03-04T12:00:10Z,5,0\n2024-03-04T12:00:20Z,0,0\n');
    expect(incident.format).toBe('intervals');
    expect(incident.hasLatency).toBe(false);
    expect(incident.rows).toBe(3);
    const t = Array.from(incident.timeline.t).map((value) => value - START);
    expect(t).toEqual([0, 1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10_000, 12_000, 14_000, 16_000, 18_000]);
    const outcomes = Array.from(incident.timeline.outcome);
    expect(outcomes.slice(0, 10)).toEqual([0, 0, 0, 1, 0, 0, 1, 0, 0, 1]);
    expect(outcomes.slice(10)).toEqual([0, 0, 0, 0, 0]);
    expect(Array.from(incident.timeline.latencyMs).every((value) => value === 0)).toBe(true);
  });

  it('gives the same calls every time', () => {
    const text = 'timestamp,requests,errors\n1709553600000,7,2\n1709553660000,13,13\n';
    expect(Array.from(ok(text).timeline.t)).toEqual(Array.from(ok(text).timeline.t));
    expect(Array.from(ok(text).timeline.outcome)).toEqual(Array.from(ok(text).timeline.outcome));
  });

  it('assumes the last interval is as long as the one before it, or a minute when there is one row', () => {
    const two = ok('timestamp,requests,errors\n1709553600000,1,0\n1709553630000,2,0\n');
    expect(two.assumedLastIntervalMs).toBe(30_000);
    expect(Array.from(two.timeline.t).map((value) => value - 1709553600000)).toEqual([0, 30_000, 45_000]);
    const one = ok('timestamp,requests,errors\n1709553600000,2,1\n');
    expect(one.assumedLastIntervalMs).toBe(60_000);
    expect(Array.from(one.timeline.t).map((value) => value - 1709553600000)).toEqual([0, 30_000]);
  });

  it('skips rows with more errors than requests or a repeated start time, with line numbers', () => {
    const text = [
      'timestamp,requests,errors',
      '2024-03-04T12:00:00Z,10,1',
      '2024-03-04T12:00:10Z,5,9',
      '2024-03-04T12:00:20Z,5,1',
      '2024-03-04T12:00:20Z,6,1',
      '2024-03-04T12:00:30Z,5,1',
      '2024-03-04T12:00:40Z,five,1',
      '2024-03-04T12:00:50Z,5,1',
      '2024-03-04T12:01:00Z,5,1',
      '2024-03-04T12:01:10Z,5,1',
      '2024-03-04T12:01:20Z,5,1',
    ].join('\n');
    const incident = ok(text);
    expect(incident.skipped.map((p) => formatProblem('f.csv', p))).toEqual([
      'f.csv, line 3: errors (9) cannot be more than requests (5)',
      'f.csv, line 7: requests "five" must be a whole number of 0 or more',
      'f.csv, line 5: timestamp repeats the one on line 4; each interval needs its own start time',
    ]);
  });

  it('refuses intervals that add up to more than the call limit, naming the biggest line', () => {
    const lines = problems(`timestamp,requests,errors\n${START},300000,0\n${START + 60_000},300000,0\n`);
    expect(lines).toEqual([
      'incident.csv, line 2: the intervals add up to 600,000 requests and the limit is 500,000. This line has the most (300,000). Use a shorter period, or lower the counts.',
    ]);
  });

  it('refuses intervals that hold no requests', () => {
    expect(problems(`timestamp,requests,errors\n${START},0,0\n`)).toEqual(['incident.csv: every interval has 0 requests, so there are no calls to replay']);
  });
});

describe('writing and reading the format back', () => {
  it('round-trips each synthetic incident through CSV', () => {
    for (const sample of SAMPLE_INCIDENTS) {
      const original = sample.build();
      const incident = ok(timelineToCsv(original));
      expect(Array.from(incident.timeline.t)).toEqual(Array.from(original.t));
      expect(Array.from(incident.timeline.outcome)).toEqual(Array.from(original.outcome));
      expect(Array.from(incident.timeline.latencyMs)).toEqual(Array.from(original.latencyMs));
    }
  });
});
