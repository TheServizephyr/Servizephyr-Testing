const { logger } = require('../lib/logger');

function errorHandler(err, req, res, next) {
  if (res.headersSent) {
    return next(err);
  }

  const status = Number(err?.status || err?.statusCode || 500);
  const safeStatus = Number.isFinite(status) ? Math.max(400, Math.min(599, status)) : 500;
  const message = safeStatus >= 500 ? 'Internal Server Error' : (err?.message || 'Request failed');
  if (!res.locals) res.locals = {};
  res.locals.errorMessage = err?.message || message;

  logger.error(
    {
      err,
      requestId: req.id,
      method: req.method,
      path: req.originalUrl,
      status: safeStatus,
    },
    'Request error'
  );

  const payload = {
    message,
    requestId: req.id,
  };
  if (err?.details) payload.details = err.details;

  res.status(safeStatus).json(payload);
}

module.exports = { errorHandler };
