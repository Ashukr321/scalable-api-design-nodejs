// v1 contract (old): a single `name` string and an `isActive` boolean.
// The database now stores firstName/lastName/status, so v1 translates both ways.

export const toV1 = (user) => ({
  id: user.id,
  name: `${user.firstName} ${user.lastName}`.trim(),
  email: user.email,
  isActive: user.status === 'active',
  createdAt: user.createdAt,
});

// Only map keys the client actually sent, so PATCH stays partial.
export function fromV1(body = {}) {
  const data = {};
  if (body.name !== undefined) {
    const [firstName, ...rest] = String(body.name).trim().split(/\s+/);
    data.firstName = firstName;
    data.lastName = rest.join(' ');
  }
  if (body.email !== undefined) data.email = body.email;
  if (body.isActive !== undefined) data.status = body.isActive ? 'active' : 'inactive';
  return data;
}
