import type { BreakerSettings } from '../../../shared/breaker-core.js';
import { replayTimeline, type ReplayResult, type Timeline } from '../../../shared/replay.js';
import { parseIncidentText, type IncidentParseResult } from './incidentFile.js';

export type WorkerRequest =
  | { id: number; kind: 'parse'; text: string; fileName: string }
  | { id: number; kind: 'replay'; timeline: Timeline; settings: BreakerSettings };

export type WorkerResponse =
  | { id: number; kind: 'parse'; result: IncidentParseResult }
  | { id: number; kind: 'replay'; result: ReplayResult }
  | { id: number; kind: 'error'; message: string };

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage: (response: WorkerResponse) => void;
};

// Reading a large file and replaying it can take long enough to freeze the page, so both run here.
scope.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  try {
    if (request.kind === 'parse') {
      scope.postMessage({ id: request.id, kind: 'parse', result: parseIncidentText(request.text, request.fileName) });
    } else {
      scope.postMessage({ id: request.id, kind: 'replay', result: replayTimeline(request.timeline, request.settings) });
    }
  } catch (error) {
    scope.postMessage({ id: request.id, kind: 'error', message: error instanceof Error ? error.message : 'The timeline could not be processed.' });
  }
};
