import type { Request, Response } from 'express';
import { CircuitService } from '../services/circuit.service.js';

export class CircuitController {
  constructor(private circuitService: CircuitService) {}

  public getStats = async (_req: Request, res: Response) => {
    try {
      const stats = this.circuitService.getGlobalStats();
      res.json({ success: true, data: stats });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  };

  public getAllCircuits = async (_req: Request, res: Response) => {
    try {
      const circuits = this.circuitService.getAllCircuits();
      res.json({ success: true, data: circuits });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  };

  public getCircuit = async (req: Request, res: Response) => {
    try {
      const rawId = req.params.id;
      const circuitId = Array.isArray(rawId) ? rawId[0] : String(rawId);
      const circuit = this.circuitService.getCircuit(circuitId);
      if (!circuit) {
        res.status(404).json({ success: false, error: `Circuit '${circuitId}' not found` });
        return;
      }
      res.json({ success: true, data: circuit });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  };

  public executeCall = async (req: Request, res: Response) => {
    try {
      const rawId = req.params.id;
      const circuitId = Array.isArray(rawId) ? rawId[0] : String(rawId);
      const result = await this.circuitService.executeCall(circuitId, req.body.payload);
      res.json({ success: true, data: result });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  };

  public resetCircuit = async (req: Request, res: Response) => {
    try {
      const rawId = req.params.id;
      const circuitId = Array.isArray(rawId) ? rawId[0] : String(rawId);
      this.circuitService.forceReset(circuitId);
      const circuit = this.circuitService.getCircuit(circuitId);
      res.json({ success: true, data: circuit, message: `Circuit '${circuitId}' reset to CLOSED` });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  };

  public tripCircuit = async (req: Request, res: Response) => {
    try {
      const rawId = req.params.id;
      const circuitId = Array.isArray(rawId) ? rawId[0] : String(rawId);
      this.circuitService.forceTrip(circuitId);
      const circuit = this.circuitService.getCircuit(circuitId);
      res.json({ success: true, data: circuit, message: `Circuit '${circuitId}' tripped to OPEN` });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  };

  public updateConfig = async (req: Request, res: Response) => {
    try {
      const rawId = req.params.id;
      const circuitId = Array.isArray(rawId) ? rawId[0] : String(rawId);
      this.circuitService.updateCircuitConfig(circuitId, req.body);
      const circuit = this.circuitService.getCircuit(circuitId);
      res.json({ success: true, data: circuit });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  };

  public updateChaos = async (req: Request, res: Response) => {
    try {
      const rawId = req.params.id;
      const serviceId = Array.isArray(rawId) ? rawId[0] : String(rawId);
      const { latencyMs, errorRatePercent } = req.body;
      const updated = this.circuitService.updateDownstreamChaos(
        serviceId,
        latencyMs ?? 50,
        errorRatePercent ?? 0
      );
      res.json({ success: true, data: updated });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  };

  public runBurst = async (req: Request, res: Response) => {
    try {
      const rawId = req.params.id;
      const circuitId = Array.isArray(rawId) ? rawId[0] : String(rawId);
      const concurrency = req.body.concurrency ? parseInt(req.body.concurrency, 10) : 20;

      const result = await this.circuitService.runBurstTest({
        circuitId,
        concurrency,
        simulatedLatencyMs: req.body.latencyMs,
        simulatedErrorRatePercent: req.body.errorRatePercent,
      });

      res.json({ success: true, data: result });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  };
}