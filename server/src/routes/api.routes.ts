import { Router } from 'express';
import { CircuitController } from '../controllers/circuit.controller.js';
import { CircuitService } from '../../../shared/circuit.service.js';

export function createApiRouter(circuitService: CircuitService): Router {
  const router = Router();
  const controller = new CircuitController(circuitService);

  // Health
  router.get('/health', (_req, res) => {
    const stats = circuitService.getGlobalStats();
    res.json({
      status: 'ok',
      service: 'CircuitShield',
      circuitsCount: stats.circuitsCount,
      openCircuits: stats.openCircuitsCount,
    });
  });

  // Telemetry
  router.get('/stats', controller.getStats);

  // Circuits
  router.get('/circuits', controller.getAllCircuits);
  router.get('/circuits/:id', controller.getCircuit);
  router.post('/circuits/:id/execute', controller.executeCall);
  router.post('/circuits/:id/reset', controller.resetCircuit);
  router.post('/circuits/:id/trip', controller.tripCircuit);
  router.post('/circuits/:id/config', controller.updateConfig);
  router.post('/circuits/:id/burst-test', controller.runBurst);

  // Chaos settings
  router.post('/services/:id/chaos', controller.updateChaos);

  return router;
}