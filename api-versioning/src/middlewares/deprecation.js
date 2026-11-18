import { ApiError } from '../utils/ApiError.js';

/**
 * Marks a whole API version as deprecated.
 *  - Before `sunset`: request works, response carries Deprecation (RFC 9745),
 *    Sunset (RFC 8594) and Link rel="successor-version" headers.
 *  - After `sunset`:  request is refused with 410 Gone.
 *
 * app.use('/api/v1', deprecate({ since: '2026-11-01', sunset: '2027-06-30', successor: '/api/v2' }), v1Router)
 */
export function deprecate({ since, sunset, successor, docs }) {
  const sinceDate = new Date(since);
  const sunsetDate = new Date(sunset);

  return (req, res, next) => {
    if (Date.now() >= sunsetDate.getTime()) {
      return next(new ApiError(410, 'Gone', `This API version was retired on ${sunsetDate.toUTCString()}. Use ${successor}.`));
    }

    res.set('Deprecation', `@${Math.floor(sinceDate.getTime() / 1000)}`);
    res.set('Sunset', sunsetDate.toUTCString());
    const links = [`<${successor}${req.path === '/' ? '' : req.path}>; rel="successor-version"`];
    if (docs) links.push(`<${docs}>; rel="deprecation"`);
    res.set('Link', links.join(', '));
    next();
  };
}
