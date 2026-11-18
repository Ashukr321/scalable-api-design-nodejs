import { Router } from 'express';
import usersRoutes from './users.routes.js';

// Every resource of v1 is mounted here.
const v1 = Router();
v1.use('/users', usersRoutes);

export default v1;
