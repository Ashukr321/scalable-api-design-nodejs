import { Router } from 'express';
import usersRoutes from './users.routes.js';

// Every resource of v2 is mounted here. A resource with no breaking change
// can reuse the v1 router: v2.use('/orders', v1OrdersRoutes)
const v2 = Router();
v2.use('/users', usersRoutes);

export default v2;
