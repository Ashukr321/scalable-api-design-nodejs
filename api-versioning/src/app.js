import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import v1 from './api/v1/index.js';
import v2 from './api/v2/index.js';
import { VERSIONS, LATEST } from './versions.js';
import { deprecate } from './middlewares/deprecation.js';
import { notFound, errorHandler } from './middlewares/errorHandler.js';

const app = express();

app.use(helmet());
app.use(cors({ exposedHeaders: ['Deprecation', 'Sunset', 'Link', 'Location'] })); // let browsers read version headers
app.use(express.json({ limit: '100kb' }));

// Discovery endpoint: clients and dashboards can see which versions are live.
app.get('/api', (_req, res) => res.json({ latest: LATEST, versions: VERSIONS }));

// URI versioning: each version is its own router.
app.use('/api/v1', deprecate(VERSIONS.v1.deprecation), v1);
app.use('/api/v2', v2);

app.use(notFound);
app.use(errorHandler);

export default app;
