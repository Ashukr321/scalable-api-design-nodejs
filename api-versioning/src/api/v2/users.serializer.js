// v2 contract (current): split names, a `status` enum, a `phone` field and timestamps.

export const toV2 = (user) => ({
  id: user.id,
  firstName: user.firstName,
  lastName: user.lastName,
  email: user.email,
  phone: user.phone,
  status: user.status,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
});

const WRITABLE = ['firstName', 'lastName', 'email', 'phone', 'status'];

export const fromV2 = (body = {}) =>
  Object.fromEntries(Object.entries(body).filter(([key]) => WRITABLE.includes(key)));
