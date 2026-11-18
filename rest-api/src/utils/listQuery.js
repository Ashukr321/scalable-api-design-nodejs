import { ApiError } from './ApiError.js';

const SORTABLE = ['name', 'price', 'stock', 'createdAt', 'updatedAt'];
const SELECTABLE = ['name', 'sku', 'description', 'price', 'category', 'stock', 'tags', 'isActive', 'createdAt', 'updatedAt'];
const MAX_LIMIT = 100;

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function toNumber(value, name) {
  const n = Number(value);
  if (value === '' || Number.isNaN(n)) throw new ApiError(400, 'Invalid query parameter', `${name} must be a number`);
  return n;
}

/**
 * Turns ?category=books&minPrice=10&maxPrice=50&q=node&inStock=true
 *       &sort=-price,name&fields=name,price&page=2&limit=20
 * into a safe Mongo filter / sort / projection. Only whitelisted keys are used,
 * so clients can never inject operators like {"$ne": null}.
 */
export function buildListQuery(query) {
  const filter = {};

  if (query.category) filter.category = String(query.category);
  if (query.isActive !== undefined) filter.isActive = query.isActive === 'true';
  if (query.inStock === 'true') filter.stock = { $gt: 0 };
  if (query.q) filter.name = { $regex: escapeRegex(String(query.q)), $options: 'i' };

  if (query.minPrice !== undefined || query.maxPrice !== undefined) {
    filter.price = {};
    if (query.minPrice !== undefined) filter.price.$gte = toNumber(query.minPrice, 'minPrice');
    if (query.maxPrice !== undefined) filter.price.$lte = toNumber(query.maxPrice, 'maxPrice');
  }

  const sortFields = String(query.sort || '-createdAt')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => SORTABLE.includes(s.replace(/^-/, '')));
  // _id as tie-breaker keeps page boundaries stable when sort values are equal.
  const sort = [...(sortFields.length ? sortFields : ['-createdAt']), '_id'].join(' ');

  const fields = query.fields
    ? String(query.fields).split(',').map((s) => s.trim()).filter((s) => SELECTABLE.includes(s))
    : [];
  const projection = fields.join(' ');

  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(query.limit, 10) || 20));

  return { filter, sort, projection, page, limit };
}
