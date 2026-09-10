import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { createApiRouter } from './routes/api.routes.js';
import { CircuitService } from './services/circuit.service.js';

export function createApp(circuitService?: CircuitService) {
  const app = express();
  const service = circuitService || new CircuitService();

  app.use(cors());
  app.use(express.json());

  // Mount API router
  app.use('/api', createApiRouter(service));

  // Serve static client build if present
  const clientDistPath = path.resolve(process.cwd(), '../client/dist');
  if (fs.existsSync(clientDistPath)) {
    app.use(express.static(clientDistPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(clientDistPath, 'index.html'));
    });
  }

  return { app, circuitService: service };
}