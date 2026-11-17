import { OUTCOME_ERROR, OUTCOME_OK, OUTCOME_TIMEOUT, type Timeline } from '../../../shared/replay.js';

/** Limits for an incident file. Each one has its own message so the person knows what to trim. */
export const INCIDENT_LIMITS = {
  fileBytes: 5 * 1024 * 1024,
  rows: 200_000,
  calls: 500_000,
  /** How many problems are listed by line before the rest are summarised. */
  listed: 20,
} as const;

export type IncidentFormat = 'calls' | 'intervals';

export interface IncidentProblem {
  /** The line in the file the problem is on, or null for a problem with the whole file. */
  line: number | null;
  message: string;
}

export interface ParsedIncident {
  fileName: string;
  format: IncidentFormat;
  timeline: Timeline;
  /** Data rows that were read and used. */
  rows: number;
  /** Rows that could not be read and were left out, up to INCIDENT_LIMITS.listed of them. */
  skipped: IncidentProblem[];
  skippedCount: number;
  /** True when rows were not in time order and were sorted. */
  sorted: boolean;
  /** False for per-interval files, which carry no latency. */
  hasLatency: boolean;
  /** For per-interval files, the length of the last interval, which is assumed from the one before it. */
  assumedLastIntervalMs: number | null;
}

export type IncidentParseResult =
  | { ok: true; incident: ParsedIncident }
  | { ok: false; problems: IncidentProblem[]; truncated: boolean };

const CALLS_COLUMNS = ['timestamp', 'outcome', 'latency_ms'];
const INTERVAL_COLUMNS = ['timestamp', 'requests', 'errors'];

function megabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** The message for a file over the size limit, or null when the size is fine. */
export function checkIncidentSize(fileName: string, bytes: number): IncidentProblem | null {
  if (bytes <= INCIDENT_LIMITS.fileBytes) return null;
  return {
    line: null,
    message: `${fileName} is ${megabytes(bytes)} and the limit is ${megabytes(INCIDENT_LIMITS.fileBytes)}. Trim it to the hours around the incident, or use the per-interval form (timestamp,requests,errors), which is much smaller.`,
  };
}

export function formatProblem(fileName: string, problem: IncidentProblem): string {
  return problem.line === null ? `${fileName}: ${problem.message}` : `${fileName}, line ${problem.line}: ${problem.message}`;
}

interface CsvRecord {
  line: number;
  fields: string[];
  /** Set when the record is malformed at the CSV level, for example an unclosed quote. */
  problem?: string;
}

/** Reads CSV text into records with their real line numbers. Handles a BOM, CRLF, LF or CR line ends, quotes and doubled quotes. */
export function readCsv(input: string): CsvRecord[] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const records: CsvRecord[] = [];

  if (!text.includes('"')) {
    // Without quotes a line is a record: the fast path for large files.
    const lines = text.split(/\r\n|\n|\r/);
    for (let index = 0; index < lines.length; index++) {
      const raw = lines[index];
      if (raw.trim() === '') continue;
      records.push({ line: index + 1, fields: raw.split(',') });
    }
    return records;
  }

  let line = 1;
  let position = 0;
  const length = text.length;
  while (position < length) {
    const startLine = line;
    const fields: string[] = [];
    let problem: string | undefined;
    let field = '';
    let sawContent = false;
    let atEnd = false;
    for (;;) {
      if (position >= length) { fields.push(field); atEnd = true; break; }
      const char = text[position];
      if (char === '"' && field === '' && !sawContent) {
        // Quoted field.
        sawContent = true;
        position++;
        let closed = false;
        while (position < length) {
          const inner = text[position];
          if (inner === '"') {
            if (text[position + 1] === '"') { field += '"'; position += 2; continue; }
            position++;
            closed = true;
            break;
          }
          if (inner === '\r') {
            if (text[position + 1] === '\n') position++;
            line++;
            field += '\n';
            position++;
            continue;
          }
          if (inner === '\n') line++;
          field += inner;
          position++;
        }
        if (!closed) {
          problem = 'a quoted value is never closed';
          fields.push(field);
          atEnd = true;
          break;
        }
        const next = text[position];
        if (next !== undefined && next !== ',' && next !== '\n' && next !== '\r') {
          problem = `unexpected text after a closing quote ("${next}")`;
          // Skip to the end of the line so the next record starts cleanly.
          while (position < length && text[position] !== '\n' && text[position] !== '\r') position++;
        }
        continue;
      }
      if (char === ',') { fields.push(field); field = ''; sawContent = false; position++; continue; }
      if (char === '\r' || char === '\n') {
        fields.push(field);
        if (char === '\r' && text[position + 1] === '\n') position++;
        position++;
        line++;
        break;
      }
      field += char;
      sawContent = true;
      position++;
    }
    if (!(fields.length === 1 && fields[0].trim() === '' && !problem)) records.push({ line: startLine, fields, problem });
    if (atEnd) break;
  }
  return records;
}

const ISO = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d+))?)?)?\s*(Z|[+-]\d{2}(?::?\d{2})?)?$/i;

/** Parses an ISO 8601 time or epoch milliseconds. A time with no zone is read as UTC. Returns a number or a reason. */
export function parseTimestamp(raw: string): number | string {
  const value = raw.trim();
  if (/^\d+(\.\d+)?$/.test(value)) {
    const number = Number(value);
    if (number < 1e11) {
      return `timestamp "${value}" looks like epoch seconds; use epoch milliseconds (for example 1709553600000) or an ISO time (for example 2024-03-04T12:00:00Z)`;
    }
    return number;
  }
  const match = ISO.exec(value);
  if (!match) return `timestamp "${value}" is not an ISO time (for example 2024-03-04T12:00:00Z) or epoch milliseconds`;
  const [, year, month, day, hour = '00', minute = '00', second = '00', fraction = '', zone = 'Z'] = match;
  const y = Number(year);
  const mo = Number(month);
  const d = Number(day);
  const h = Number(hour);
  const mi = Number(minute);
  const s = Number(second);
  const calendar = new Date(Date.UTC(y, mo - 1, d));
  if (mo < 1 || mo > 12 || calendar.getUTCMonth() !== mo - 1 || calendar.getUTCDate() !== d || h > 23 || mi > 59 || s > 59) {
    return `timestamp "${value}" is not a real date and time`;
  }
  const ms = Number(fraction.padEnd(3, '0').slice(0, 3));
  let offsetMinutes = 0;
  if (zone.toUpperCase() !== 'Z') {
    const digits = zone.slice(1).replace(':', '');
    const zh = Number(digits.slice(0, 2));
    const zm = Number(digits.slice(2) || '0');
    if (zh > 23 || zm > 59) return `timestamp "${value}" has an invalid time zone offset`;
    offsetMinutes = (zone[0] === '-' ? -1 : 1) * (zh * 60 + zm);
  }
  return Date.UTC(y, mo - 1, d, h, mi, s, ms) - offsetMinutes * 60_000;
}

function headerIndexes(names: string[], wanted: string[]): number[] | null {
  const indexes = wanted.map((name) => names.indexOf(name));
  return indexes.every((index) => index >= 0) ? indexes : null;
}

interface SortableRows {
  t: number[];
  a: number[];
  b: number[];
  line: number[];
}

/** Reads an incident file: one row per call, or one row per interval with request and error counts. */
export function parseIncidentText(text: string, fileName: string): IncidentParseResult {
  const records = readCsv(text);
  if (records.length === 0) {
    return { ok: false, problems: [{ line: null, message: 'the file is empty. Add a header row and one row per call, for example: timestamp,outcome,latency_ms' }], truncated: false };
  }

  const headerRecord = records[0];
  const names = headerRecord.fields.map((name) => name.trim().toLowerCase());
  const callColumns = headerIndexes(names, CALLS_COLUMNS);
  const intervalColumns = callColumns ? null : headerIndexes(names, INTERVAL_COLUMNS);
  if (!callColumns && !intervalColumns) {
    const shown = headerRecord.fields.join(',').slice(0, 80);
    const looksLikeData = /^\s*\d/.test(headerRecord.fields[0] ?? '');
    return {
      ok: false,
      truncated: false,
      problems: [{
        line: headerRecord.line,
        message: `${looksLikeData ? 'the first row is data, but a header row is required. ' : ''}expected a header row with the columns timestamp,outcome,latency_ms (one call per row) or timestamp,requests,errors (one interval per row), found "${shown}"`,
      }],
    };
  }
  if (new Set(names).size !== names.length) {
    return { ok: false, truncated: false, problems: [{ line: headerRecord.line, message: `the header repeats a column name: ${names.join(',')}` }] };
  }

  const format: IncidentFormat = callColumns ? 'calls' : 'intervals';
  const columns = (callColumns ?? intervalColumns) as number[];
  const data = records.slice(1);
  if (data.length === 0) {
    return { ok: false, truncated: false, problems: [{ line: headerRecord.line, message: 'the file has a header but no rows' }] };
  }
  if (data.length > INCIDENT_LIMITS.rows) {
    return {
      ok: false,
      truncated: false,
      problems: [{ line: null, message: `the file has ${data.length.toLocaleString('en-US')} data rows and the limit is ${INCIDENT_LIMITS.rows.toLocaleString('en-US')}. Trim it to the period around the incident, or use the per-interval form (timestamp,requests,errors).` }],
    };
  }

  const needed = Math.max(...columns) + 1;
  const bad: IncidentProblem[] = [];
  const rows: SortableRows = { t: [], a: [], b: [], line: [] };
  const fail = (line: number, message: string): void => { bad.push({ line, message }); };

  for (const record of data) {
    if (record.problem) { fail(record.line, record.problem); continue; }
    if (record.fields.length < needed) {
      fail(record.line, `expected at least ${needed} columns to match the header, found ${record.fields.length}`);
      continue;
    }
    const time = parseTimestamp(record.fields[columns[0]]);
    if (typeof time === 'string') { fail(record.line, time); continue; }

    if (format === 'calls') {
      const outcomeText = record.fields[columns[1]].trim().toLowerCase();
      const outcome = outcomeText === 'ok' ? OUTCOME_OK : outcomeText === 'error' ? OUTCOME_ERROR : outcomeText === 'timeout' ? OUTCOME_TIMEOUT : -1;
      if (outcome < 0) { fail(record.line, `outcome "${record.fields[columns[1]].trim()}" must be ok, error or timeout`); continue; }
      const latencyText = record.fields[columns[2]].trim();
      let latency = 0;
      if (latencyText === '') {
        if (outcome === OUTCOME_OK) { fail(record.line, 'latency_ms is empty for an ok call; give its duration in milliseconds'); continue; }
      } else {
        latency = Number(latencyText);
        if (!Number.isFinite(latency) || latency < 0) { fail(record.line, `latency_ms "${latencyText}" must be a number of 0 or more`); continue; }
      }
      rows.t.push(time);
      rows.a.push(outcome);
      rows.b.push(latency);
      rows.line.push(record.line);
    } else {
      const requestsText = record.fields[columns[1]].trim();
      const errorsText = record.fields[columns[2]].trim();
      if (!/^\d+$/.test(requestsText)) { fail(record.line, `requests "${requestsText}" must be a whole number of 0 or more`); continue; }
      if (!/^\d+$/.test(errorsText)) { fail(record.line, `errors "${errorsText}" must be a whole number of 0 or more`); continue; }
      const requests = Number(requestsText);
      const errors = Number(errorsText);
      if (errors > requests) { fail(record.line, `errors (${errors}) cannot be more than requests (${requests})`); continue; }
      rows.t.push(time);
      rows.a.push(requests);
      rows.b.push(errors);
      rows.line.push(record.line);
    }
  }

  const unreadable = (): IncidentParseResult => ({
    ok: false,
    truncated: bad.length > INCIDENT_LIMITS.listed,
    problems: bad.slice(0, INCIDENT_LIMITS.listed),
  });

  // A few bad rows are skipped and reported. When half or more are bad the file is probably the wrong shape or damaged.
  if (bad.length > 0 && bad.length * 2 >= data.length) {
    const summary: IncidentProblem = {
      line: null,
      message: `${bad.length.toLocaleString('en-US')} of ${data.length.toLocaleString('en-US')} rows could not be read, so the file is probably in a different format or damaged. Nothing was loaded. The first problems are listed below.`,
    };
    const result = unreadable();
    if (!result.ok) result.problems.unshift(summary);
    return result;
  }
  if (rows.t.length === 0) return unreadable();

  // Put rows in time order. Rows with the same time keep file order.
  const count = rows.t.length;
  let sorted = false;
  for (let index = 1; index < count; index++) {
    if (rows.t[index] < rows.t[index - 1]) { sorted = true; break; }
  }
  const order = Array.from({ length: count }, (_, index) => index);
  if (sorted) order.sort((x, y) => rows.t[x] - rows.t[y] || x - y);

  if (format === 'calls') {
    const timeline: Timeline = { t: new Float64Array(count), outcome: new Uint8Array(count), latencyMs: new Float64Array(count) };
    order.forEach((source, target) => {
      timeline.t[target] = rows.t[source];
      timeline.outcome[target] = rows.a[source];
      timeline.latencyMs[target] = rows.b[source];
    });
    return {
      ok: true,
      incident: {
        fileName, format, timeline, rows: count, skipped: bad.slice(0, INCIDENT_LIMITS.listed), skippedCount: bad.length,
        sorted, hasLatency: true, assumedLastIntervalMs: null,
      },
    };
  }

  // Per-interval form: spread each interval's requests evenly across it, and spread its errors evenly among them.
  const times = order.map((source) => rows.t[source]);
  const requests = order.map((source) => rows.a[source]);
  const errors = order.map((source) => rows.b[source]);
  const lines = order.map((source) => rows.line[source]);

  // The same timestamp twice would make an interval of no length.
  const keep: number[] = [];
  for (let index = 0; index < count; index++) {
    if (index > 0 && times[index] === times[index - 1]) {
      bad.push({ line: lines[index], message: `timestamp repeats the one on line ${lines[index - 1]}; each interval needs its own start time` });
      continue;
    }
    keep.push(index);
  }
  if (bad.length > 0 && bad.length * 2 >= data.length) return unreadable();
  if (keep.length === 0) return unreadable();

  let total = 0;
  let biggest = keep[0];
  for (const index of keep) {
    total += requests[index];
    if (requests[index] > requests[biggest]) biggest = index;
  }
  if (total > INCIDENT_LIMITS.calls) {
    return {
      ok: false,
      truncated: false,
      problems: [{
        line: lines[biggest],
        message: `the intervals add up to ${total.toLocaleString('en-US')} requests and the limit is ${INCIDENT_LIMITS.calls.toLocaleString('en-US')}. This line has the most (${requests[biggest].toLocaleString('en-US')}). Use a shorter period, or lower the counts.`,
      }],
    };
  }
  if (total === 0) {
    return { ok: false, truncated: false, problems: [{ line: null, message: 'every interval has 0 requests, so there are no calls to replay' }] };
  }

  const gaps = keep.slice(0, -1).map((index, position) => times[keep[position + 1]] - times[index]);
  // The last interval has no end time: assume it is as long as the one before it, or a minute when there is only one row.
  const lastLength = gaps.length > 0 ? gaps[gaps.length - 1] : 60_000;
  const timeline: Timeline = { t: new Float64Array(total), outcome: new Uint8Array(total), latencyMs: new Float64Array(total) };
  let cursor = 0;
  keep.forEach((index, position) => {
    const length = position < gaps.length ? gaps[position] : lastLength;
    const count = requests[index];
    const failed = errors[index];
    for (let call = 0; call < count; call++) {
      timeline.t[cursor] = times[index] + Math.floor((call * length) / count);
      // Call `call` is an error when the running error quota crosses a whole number there.
      timeline.outcome[cursor] = Math.floor(((call + 1) * failed) / count) > Math.floor((call * failed) / count) ? OUTCOME_ERROR : OUTCOME_OK;
      cursor++;
    }
  });

  return {
    ok: true,
    incident: {
      fileName, format, timeline, rows: keep.length, skipped: bad.slice(0, INCIDENT_LIMITS.listed), skippedCount: bad.length,
      sorted, hasLatency: false, assumedLastIntervalMs: lastLength,
    },
  };
}

/** Writes a timeline as a per-call CSV with ISO times, the format this tool reads. */
export function timelineToCsv(timeline: Timeline): string {
  const names = ['ok', 'error', 'timeout'];
  const lines = ['timestamp,outcome,latency_ms'];
  for (let index = 0; index < timeline.t.length; index++) {
    lines.push(`${new Date(timeline.t[index]).toISOString()},${names[timeline.outcome[index]]},${timeline.latencyMs[index]}`);
  }
  return `${lines.join('\n')}\n`;
}
