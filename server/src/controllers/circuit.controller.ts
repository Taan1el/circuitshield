import type { Request, Response } from 'express';
import { CircuitService } from '../../../shared/circuit.service.js';
import { validateBurstRequest, validateChaosPatch, validateCircuitConfigPatch } from '../../../shared/validation.js';

// Generic message returned for anything unexpected, so a stack trace or
// internal detail never reaches the client. The real error is still logged
// server-side for debugging.
const INTERNAL_ERROR_MESSAGE = 'Internal server error';

function paramId(req: Request): string {
  const raw = req.params.id;
  return Array.isArray(raw) ? raw[0] : String(raw);
}

function logUnexpectedError(context: string, err: unknown): void {
  console.error(`[CircuitShield] Unexpected error in ${context}:`, err);
}

export class CircuitController {
  constructor(private circuitService: CircuitService) {}

  public getStats = async (_req: Request, res: Response) => {
    try {
      const stats = this.circuitService.getGlobalStats();
      res.json({ success: true, data: stats });
    } catch (err) {
      logUnexpectedError('getStats', err);
      res.status(500).json({ success: false, error: INTERNAL_ERROR_MESSAGE });
    }
  };

  public getAllCircuits = async (_req: Request, res: Response) => {
    try {
      const circuits = this.circuitService.getAllCircuits();
      res.json({ success: true, data: circuits });
    } catch (err) {
      logUnexpectedError('getAllCircuits', err);
      res.status(500).json({ success: false, error: INTERNAL_ERROR_MESSAGE });
    }
  };

  public getCircuit = async (req: Request, res: Response) => {
    try {
      const circuitId = paramId(req);
      const circuit = this.circuitService.getCircuit(circuitId);
      if (!circuit) {
        res.status(404).json({ success: false, error: `Circuit '${circuitId}' not found` });
        return;
      }
      res.json({ success: true, data: circuit });
    } catch (err) {
      logUnexpectedError('getCircuit', err);
      res.status(500).json({ success: false, error: INTERNAL_ERROR_MESSAGE });
    }
  };

  public executeCall = async (req: Request, res: Response) => {
    try {
      const circuitId = paramId(req);
      if (!this.circuitService.getCircuit(circuitId)) {
        res.status(404).json({ success: false, error: `Circuit '${circuitId}' not found` });
        return;
      }
      const result = await this.circuitService.executeCall(circuitId, req.body?.payload);
      res.json({ success: true, data: result });
    } catch (err) {
      logUnexpectedError('executeCall', err);
      res.status(500).json({ success: false, error: INTERNAL_ERROR_MESSAGE });
    }
  };

  public resetCircuit = async (req: Request, res: Response) => {
    try {
      const circuitId = paramId(req);
      if (!this.circuitService.getCircuit(circuitId)) {
        res.status(404).json({ success: false, error: `Circuit '${circuitId}' not found` });
        return;
      }
      this.circuitService.forceReset(circuitId);
      const circuit = this.circuitService.getCircuit(circuitId);
      res.json({ success: true, data: circuit, message: `Circuit '${circuitId}' reset to CLOSED` });
    } catch (err) {
      logUnexpectedError('resetCircuit', err);
      res.status(500).json({ success: false, error: INTERNAL_ERROR_MESSAGE });
    }
  };

  public tripCircuit = async (req: Request, res: Response) => {
    try {
      const circuitId = paramId(req);
      if (!this.circuitService.getCircuit(circuitId)) {
        res.status(404).json({ success: false, error: `Circuit '${circuitId}' not found` });
        return;
      }
      this.circuitService.forceTrip(circuitId);
      const circuit = this.circuitService.getCircuit(circuitId);
      res.json({ success: true, data: circuit, message: `Circuit '${circuitId}' tripped to OPEN` });
    } catch (err) {
      logUnexpectedError('tripCircuit', err);
      res.status(500).json({ success: false, error: INTERNAL_ERROR_MESSAGE });
    }
  };

  public updateConfig = async (req: Request, res: Response) => {
    try {
      const circuitId = paramId(req);
      const circuit = this.circuitService.getCircuit(circuitId);
      if (!circuit) {
        res.status(404).json({ success: false, error: `Circuit '${circuitId}' not found` });
        return;
      }
      const validated = validateCircuitConfigPatch(req.body, circuit.config);
      if ('error' in validated) {
        res.status(400).json({ success: false, error: validated.error });
        return;
      }
      this.circuitService.updateCircuitConfig(circuitId, validated.value);
      const updated = this.circuitService.getCircuit(circuitId);
      res.json({ success: true, data: updated });
    } catch (err) {
      logUnexpectedError('updateConfig', err);
      res.status(500).json({ success: false, error: INTERNAL_ERROR_MESSAGE });
    }
  };

  public updateChaos = async (req: Request, res: Response) => {
    try {
      const serviceId = paramId(req);
      const validated = validateChaosPatch(req.body);
      if ('error' in validated) {
        res.status(400).json({ success: false, error: validated.error });
        return;
      }
      const updated = this.circuitService.updateDownstreamChaos(
        serviceId,
        validated.value.latencyMs,
        validated.value.errorRatePercent
      );
      res.json({ success: true, data: updated });
    } catch (err) {
      logUnexpectedError('updateChaos', err);
      res.status(500).json({ success: false, error: INTERNAL_ERROR_MESSAGE });
    }
  };

  public runBurst = async (req: Request, res: Response) => {
    try {
      const circuitId = paramId(req);
      if (!this.circuitService.getCircuit(circuitId)) {
        res.status(404).json({ success: false, error: `Circuit '${circuitId}' not found` });
        return;
      }
      const validated = validateBurstRequest(req.body);
      if ('error' in validated) {
        res.status(400).json({ success: false, error: validated.error });
        return;
      }

      const result = await this.circuitService.runBurstTest({
        circuitId,
        concurrency: validated.value.concurrency,
        simulatedLatencyMs: validated.value.latencyMs,
        simulatedErrorRatePercent: validated.value.errorRatePercent,
      });

      res.json({ success: true, data: result });
    } catch (err) {
      logUnexpectedError('runBurst', err);
      res.status(500).json({ success: false, error: INTERNAL_ERROR_MESSAGE });
    }
  };
}
