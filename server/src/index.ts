import { createApp } from './app.js';

const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 4004;
const { app } = createApp();

app.listen(port, () => {
  console.log(`[CircuitShield] Resilience Gateway listening on http://localhost:${port}`);
  console.log(`[CircuitShield] REST API mounted at http://localhost:${port}/api`);
});