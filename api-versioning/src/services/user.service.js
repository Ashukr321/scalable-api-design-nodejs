import mongoose from 'mongoose';
import { User } from '../models/user.model.js';
import { ApiError } from '../utils/ApiError.js';

// Shared business logic. Both v1 and v2 call these functions, so a bug fix
// or a new rule lands in every version at once.

const clampLimit = (limit) => Math.min(100, Math.max(1, parseInt(limit, 10) || 20));

// Offset pagination (used by v1): ?page=2&limit=20
export async function listByPage({ status, page, limit }) {
  const filter = status ? { status: String(status) } : {};
  const size = clampLimit(limit);
  const pageNo = Math.max(1, parseInt(page, 10) || 1);

  const [users, total] = await Promise.all([
    User.find(filter).sort({ _id: -1 }).skip((pageNo - 1) * size).limit(size),
    User.countDocuments(filter),
  ]);
  return { users, total, page: pageNo, limit: size };
}

// Cursor pagination (used by v2): ?cursor=<last id>&limit=20. Fast on big collections, no skipped/duplicate rows.
export async function listByCursor({ status, cursor, limit }) {
  const filter = status ? { status: String(status) } : {};
  const size = clampLimit(limit);

  if (cursor) {
    if (!mongoose.isValidObjectId(cursor)) throw new ApiError(400, 'Invalid parameter', 'cursor is not valid');
    filter._id = { $lt: cursor };
  }

  const users = await User.find(filter).sort({ _id: -1 }).limit(size + 1); // +1 tells us if there is a next page
  const hasMore = users.length > size;
  if (hasMore) users.pop();
  return { users, limit: size, nextCursor: hasMore ? users.at(-1).id : null };
}

export async function getById(id) {
  const user = await User.findById(id);
  if (!user) throw new ApiError(404, 'Not Found', `User ${id} does not exist`);
  return user;
}

export const create = (data) => User.create(data);

export async function update(id, data) {
  const user = await getById(id);
  user.set(data);
  return user.save();
}

export async function remove(id) {
  const user = await User.findByIdAndDelete(id);
  if (!user) throw new ApiError(404, 'Not Found', `User ${id} does not exist`);
}
