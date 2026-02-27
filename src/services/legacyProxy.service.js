const { config } = require('../config/env');
const { HttpError } = require('../utils/httpError');
const { Readable } = require('stream');

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

function buildProxyTarget(req) {
  if (!config.legacy.enableProxy) {
    throw new HttpError(404, 'Legacy proxy is disabled on this backend.');
  }

  if (!config.legacy.baseUrl) {
    throw new HttpError(
      503,
      'Legacy proxy base URL is not configured (LEGACY_API_BASE_URL missing).'
    );
  }

  // Prevent accidental proxy loop when someone points base URL to this backend.
  const host = String(req.headers.host || '').toLowerCase();
  const baseHost = (() => {
    try {
      return new URL(config.legacy.baseUrl).host.toLowerCase();
    } catch {
      return '';
    }
  })();
  if (host && baseHost && host === baseHost) {
    throw new HttpError(500, 'Legacy proxy loop detected. LEGACY_API_BASE_URL points to current host.');
  }

  return `${config.legacy.baseUrl}${req.originalUrl}`;
}

function buildForwardHeaders(req) {
  const headers = {};
  for (const [key, value] of Object.entries(req.headers || {})) {
    const lower = key.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(lower)) continue;
    if (lower === 'host') continue;
    if (lower === 'content-length') continue;
    headers[key] = value;
  }
  headers['x-servizephyr-proxy'] = 'backend-v2';
  headers['x-servizephyr-request-id'] = req.id;
  return headers;
}

function extractForwardBody(req) {
  const method = String(req.method || 'GET').toUpperCase();
  if (method === 'GET' || method === 'HEAD') return undefined;

  if (Buffer.isBuffer(req.body)) {
    return req.body.length > 0 ? req.body : undefined;
  }
  if (typeof req.body === 'string') {
    return req.body.length > 0 ? req.body : undefined;
  }
  if (req.body && typeof req.body === 'object' && Object.keys(req.body).length > 0) {
    return JSON.stringify(req.body);
  }

  const contentType = String(req.headers['content-type'] || '').toLowerCase();

  // For content-types not parsed by Express (multipart/form-data, etc.),
  // forward the original request stream to preserve payload bytes.
  if (
    req.body === undefined
    && req instanceof Readable
    && (
      contentType.includes('multipart/form-data')
      || contentType.includes('application/octet-stream')
      || contentType.includes('application/x-www-form-urlencoded')
    )
  ) {
    return req;
  }

  return undefined;
}

async function proxyToLegacy(req, res) {
  const targetUrl = buildProxyTarget(req);
  const headers = buildForwardHeaders(req);
  const body = extractForwardBody(req);

  const fetchOptions = {
    method: req.method,
    headers,
    body,
    redirect: 'manual',
  };

  if (body instanceof Readable) {
    fetchOptions.duplex = 'half';
  }

  const upstreamResponse = await fetch(targetUrl, fetchOptions);

  upstreamResponse.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(lower)) return;
    // Keep backend identity explicit.
    if (lower === 'server') return;
    res.setHeader(key, value);
  });
  res.setHeader('x-proxy-mode', 'legacy');

  const responseBuffer = Buffer.from(await upstreamResponse.arrayBuffer());
  res.status(upstreamResponse.status).send(responseBuffer);
}

module.exports = { proxyToLegacy };
