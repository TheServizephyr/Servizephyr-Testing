const { trackOpsRequestTelemetry } = require('../services/opsRequestTelemetry.service');

function normalizeRoutePath(pathValue = '') {
  return String(pathValue || '')
    .trim()
    .replace(/\/+/g, '/')
    .replace(/\/$/, '');
}

function resolveEndpointName(req) {
  const routePath = req.route?.path ? String(req.route.path) : String(req.path || req.originalUrl || '');
  const basePath = String(req.baseUrl || '');

  let fullPath = '';
  if (basePath && routePath && routePath !== '/') {
    fullPath = `${normalizeRoutePath(basePath)}/${normalizeRoutePath(routePath).replace(/^\//, '')}`;
  } else if (basePath) {
    fullPath = normalizeRoutePath(basePath);
  } else {
    fullPath = normalizeRoutePath(routePath);
  }

  if (!fullPath.startsWith('/')) {
    fullPath = `/${fullPath}`;
  }
  if (fullPath.startsWith('/api/')) {
    return fullPath.slice(1).replace(/\//g, '.');
  }
  if (fullPath === '/api') {
    return 'api';
  }
  return fullPath.slice(1).replace(/\//g, '.');
}

function opsRequestTelemetry(req, res, next) {
  const startedAt = Date.now();
  const method = String(req.method || 'GET').toUpperCase();

  const flush = () => {
    const statusCode = Number(res.statusCode || 200);
    const durationMs = Date.now() - startedAt;
    const endpoint = resolveEndpointName(req);
    const errorMessage = statusCode >= 500 ? res.locals?.errorMessage || 'Internal Server Error' : null;

    void trackOpsRequestTelemetry({
      endpoint,
      method,
      durationMs,
      statusCode,
      errorMessage,
    });
  };

  res.on('finish', flush);
  next();
}

module.exports = {
  opsRequestTelemetry,
};
