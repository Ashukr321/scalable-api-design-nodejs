import { Product, WRITABLE_FIELDS } from '../models/product.model.js';
import { ApiError } from '../utils/ApiError.js';
import { buildListQuery } from '../utils/listQuery.js';

const pickWritable = (body = {}) =>
  Object.fromEntries(Object.entries(body).filter(([key]) => WRITABLE_FIELDS.includes(key)));

async function findOr404(id) {
  const product = await Product.findById(id);
  if (!product) throw new ApiError(404, 'Not Found', `Product ${id} does not exist`);
  return product;
}

// GET /api/v1/products
export async function listProducts(req, res) {
  const { filter, sort, projection, page, limit } = buildListQuery(req.query);

  const [data, total] = await Promise.all([
    Product.find(filter).sort(sort).skip((page - 1) * limit).limit(limit).select(projection),
    Product.countDocuments(filter),
  ]);

  res.json({ data, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } });
}

// GET /api/v1/products/:id
export async function getProduct(req, res) {
  res.json(await findOr404(req.params.id));
}

// POST /api/v1/products
export async function createProduct(req, res) {
  const product = await Product.create(pickWritable(req.body));
  res.status(201).location(`${req.baseUrl}/${product.id}`).json(product);
}

// PUT /api/v1/products/:id  -> full replace: fields not sent go back to their defaults
export async function replaceProduct(req, res) {
  const product = await findOr404(req.params.id);
  const fresh = new Product(pickWritable(req.body)).toObject(); // applies schema defaults
  product.overwrite({ ...fresh, _id: product._id, createdAt: product.createdAt });
  await product.save();
  res.json(product);
}

// PATCH /api/v1/products/:id -> partial update: only fields sent are changed
export async function updateProduct(req, res) {
  const product = await findOr404(req.params.id);
  product.set(pickWritable(req.body));
  await product.save();
  res.json(product);
}

// DELETE /api/v1/products/:id
export async function deleteProduct(req, res) {
  const product = await Product.findByIdAndDelete(req.params.id);
  if (!product) throw new ApiError(404, 'Not Found', `Product ${req.params.id} does not exist`);
  res.status(204).end();
}
