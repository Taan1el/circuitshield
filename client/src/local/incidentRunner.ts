import type { BreakerSettings } from '../../../shared/breaker-core.js';
import { replayTimeline, type ReplayResult, type Timeline } from '../../../shared/replay.js';
import { checkIncidentSize, parseIncidentText, type IncidentParseResult } from './incidentFile.js';
import type { WorkerRequest, WorkerResponse } from './incident.worker.js';

/** Work larger than this runs in a worker, so the page stays responsive. Smaller work runs inline. */
export const WORKER_TEXT_CHARS = 200_000;
export const WORKER_REPLAY_CALLS = 20_000;

type Pending = { resolve: (value: WorkerResponse) => void; reject: (error: Error) => void };

let worker: Worker | null = null;
let workerFailed = false;
let nextId = 1;
const pending = new Map<number, Pending>();

function getWorker(): Worker | null {
  if (workerFailed || typeof Worker === 'undefined') return null;
  if (worker) return worker;
  try {
    const created = new Worker(new URL('./incident.worker.ts', import.meta.url), { type: 'module' });
    created.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const waiting = pending.get(event.data.id);
      pending.delete(event.data.id);
      waiting?.resolve(event.data);
    };
    created.onerror = () => {
      // Fall back to running inline from now on, and fail what was waiting so it can retry inline.
      workerFailed = true;
      worker = null;
      created.terminate();
      for (const [id, waiting] of pending) {
        pending.delete(id);
        waiting.reject(new Error('The background worker stopped.'));
      }
    };
    worker = created;
    return created;
  } catch {
    workerFailed = true;
    return null;
  }
}

function ask(request: WorkerRequest): Promise<WorkerResponse> {
  const target = getWorker();
  if (!target) return Promise.reject(new Error('No worker'));
  return new Promise<WorkerResponse>((resolve, reject) => {
    pending.set(request.id, { resolve, reject });
    target.postMessage(request);
  });
}

/** Reads a chosen file. Checks its size first, and reads large files off the main thread. */
export async function parseIncidentFile(file: File): Promise<IncidentParseResult> {
  const tooBig = checkIncidentSize(file.name, file.size);
  if (tooBig) return { ok: false, problems: [tooBig], truncated: false };
  const text = await file.text();
  if (text.length >= WORKER_TEXT_CHARS) {
    try {
      const response = await ask({ id: nextId++, kind: 'parse', text, fileName: file.name });
      if (response.kind === 'parse') return response.result;
      if (response.kind === 'error') throw new Error(response.message);
    } catch {
      // Fall through and read it inline.
    }
  }
  return parseIncidentText(text, file.name);
}

/** Replays a timeline, in a worker when it is large. */
export async function replayAsync(timeline: Timeline, settings: BreakerSettings): Promise<ReplayResult> {
  if (timeline.t.length >= WORKER_REPLAY_CALLS) {
    try {
      const response = await ask({ id: nextId++, kind: 'replay', timeline, settings });
      if (response.kind === 'replay') return response.result;
      if (response.kind === 'error') throw new Error(response.message);
    } catch {
      // Fall through and replay inline.
    }
  }
  return replayTimeline(timeline, settings);
}
