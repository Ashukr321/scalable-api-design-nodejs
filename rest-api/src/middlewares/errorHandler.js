import { ApiError } from '../utils/ApiError.js';

export function notFound(req, _res, next) {
  next(new ApiError(404, 'Not Found', `Route ${req.method} ${req.originalUrl} does not exist`));
}

// Every error leaves the API in one shape: RFC 9457 Problem Details.
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  let status = err.status || err.statusCode || 500;
  let title = err.title || 'Internal Server Error';
  let detail = err.detail;
  let errors;

  if (err.name === 'ValidationError') {
    status = 422;
    title = 'Validation failed';
    errors = Object.values(err.errors).map((e) => ({ field: e.path, message: e.message }));
  } else if (err.name === 'CastError') {
    status = 400;
    title = 'Invalid parameter';
    detail = `${err.path} has an invalid value: ${JSON.stringify(err.value)}`;
  } else if (err.code === 11000) {
    status = 409;
    title = 'Conflict';
    detail = `${Object.keys(err.keyValue).join(', ')} already exists`;
  } else if (err.type === 'entity.parse.failed') {
    title = 'Malformed JSON';
    detail = 'Request body is not valid JSON';
  } else if (status < 500 && !err.title) {
    title = err.message; // other http errors from body-parser etc. (e.g. 413 Payload Too Large)
  }

  if (status >= 500) {
    console.error(err);
    detail = undefined; // never leak internals to clients
  }

  res
    .status(status)
    .type('application/problem+json')
    .json({ type: 'about:blank', title, status, detail, instance: req.originalUrl, errors });
}
