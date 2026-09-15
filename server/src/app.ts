import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { createApiRouter } from './routes/api.routes.js';
import { CircuitService } from '../../shared/circuit.service.js';

// client/dist is a sibling of the server/ directory. This is resolved
// against the process working directory rather than this module's own
// location, so it depends on the process being started from server/ (which
// is what `npm start --workspace=server` and the Docker image's WORKDIR
// both do). Exported so the convention it depends on can be tested directly.
export function resolveClientDistPath(cwd: string): string {
  return path.resolve(cwd, '../client/dist');
}

export function createApp(circuitService?: CircuitService) {
  const app = express();
  const service = circuitService || new CircuitService();

  app.use(cors());
  app.use(express.json());

  // Mount API router
  app.use('/api', createApiRouter(service));

  // Serve static client build if present
  const clientDistPath = resolveClientDistPath(process.cwd());
  if (fs.existsSync(clientDistPath)) {
    app.use(express.static(clientDistPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(clientDistPath, 'index.html'));
    });
  }

  return { app, circuitService: service };
}