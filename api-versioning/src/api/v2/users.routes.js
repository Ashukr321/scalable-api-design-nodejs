import { Router } from 'express';
import * as userService from '../../services/user.service.js';
import { toV2, fromV2 } from './users.serializer.js';

// v2 is the CURRENT version: new features go here.
const router = Router();

// v2 list: cursor pagination, response { data, page: { limit, nextCursor } }
router.get('/', async (req, res) => {
  const { users, limit, nextCursor } = await userService.listByCursor({
    status: req.query.status,
    cursor: req.query.cursor,
    limit: req.query.limit,
  });
  res.json({ data: users.map(toV2), page: { limit, nextCursor } });
});

router.get('/:id', async (req, res) => {
  res.json(toV2(await userService.getById(req.params.id)));
});

router.post('/', async (req, res) => {
  const user = await userService.create(fromV2(req.body));
  res.status(201).location(`${req.baseUrl}/${user.id}`).json(toV2(user));
});

router.patch('/:id', async (req, res) => {
  res.json(toV2(await userService.update(req.params.id, fromV2(req.body))));
});

router.delete('/:id', async (req, res) => {
  await userService.remove(req.params.id);
  res.status(204).end();
});

export default router;
