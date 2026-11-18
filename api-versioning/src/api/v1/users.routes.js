import { Router } from 'express';
import * as userService from '../../services/user.service.js';
import { toV1, fromV1 } from './users.serializer.js';

// v1 is FROZEN: no new features here, only security/bug fixes (which usually land in the shared service).
const router = Router();

// v1 list: offset pagination, response { users, total, page, limit }
router.get('/', async (req, res) => {
  const status = req.query.isActive === undefined ? undefined : req.query.isActive === 'true' ? 'active' : 'inactive';
  const { users, total, page, limit } = await userService.listByPage({ status, page: req.query.page, limit: req.query.limit });
  res.json({ users: users.map(toV1), total, page, limit });
});

router.get('/:id', async (req, res) => {
  res.json(toV1(await userService.getById(req.params.id)));
});

router.post('/', async (req, res) => {
  const user = await userService.create(fromV1(req.body));
  res.status(201).location(`${req.baseUrl}/${user.id}`).json(toV1(user));
});

router.patch('/:id', async (req, res) => {
  res.json(toV1(await userService.update(req.params.id, fromV1(req.body))));
});

router.delete('/:id', async (req, res) => {
  await userService.remove(req.params.id);
  res.status(204).end();
});

export default router;
