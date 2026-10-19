import type { IncomingMessage, ServerResponse } from 'node:http';

/** Internal clients omit Origin. Browser requests must come from this Vite origin. */
export function allowDevRequest(request: IncomingMessage, response: ServerResponse, json = false) {
  // These middleware run before Vite's host check, so reject DNS rebinding here too.
  let hostname: string;
  try {
    hostname = new URL(`http://${request.headers.host}`).hostname;
  } catch {
    hostname = '';
  }
  if (!['localhost', '127.0.0.1', '[::1]'].includes(hostname)) {
    response.statusCode = 403;
    response.end('Development data routes require a loopback host.');
    return false;
  }
  const origin = request.headers.origin;
  if (
    (origin &&
      origin !== `http://${request.headers.host}` &&
      origin !== `https://${request.headers.host}`) ||
    request.headers['sec-fetch-site'] === 'cross-site'
  ) {
    response.statusCode = 403;
    response.end('Cross-origin development requests are not allowed.');
    return false;
  }
  if (
    json &&
    request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json'
  ) {
    response.statusCode = 415;
    response.end('Use application/json.');
    return false;
  }
  return true;
}
