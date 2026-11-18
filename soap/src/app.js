import { readFileSync } from 'node:fs';
import express from 'express';
import helmet from 'helmet';
import mongoose from 'mongoose';
import soap from 'soap';
import { bankService } from './bank.service.js';

const wsdl = readFileSync(new URL('./bank.wsdl', import.meta.url), 'utf8');

const app = express();
app.use(helmet());

app.get('/health', (_req, res) => {
  const dbUp = mongoose.connection.readyState === 1;
  res.status(dbUp ? 200 : 503).json({ status: dbUp ? 'ok' : 'degraded', db: dbUp ? 'up' : 'down' });
});

// SOAP lives on one URL. GET ?wsdl returns the contract, POST takes an Envelope.
// node-soap registers its route asynchronously, so it gets its own router mounted
// here, before the 404 handler.
const soapRouter = express.Router();
soapRouter.use(express.raw({ type: () => true, limit: '100kb' })); // body-size limit; node-soap reads req.body
soap.listen(soapRouter, { path: '/bank', services: bankService, xml: wsdl, suppressStack: true });
app.use('/soap', soapRouter);

app.use((req, res) => res.status(404).type('text/plain').send(`Route ${req.method} ${req.originalUrl} does not exist`));

// Body too large etc. Faults from operations never reach here; node-soap answers those.
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).type('text/plain').send(status >= 500 ? 'Internal Server Error' : err.message);
});

export default app;
