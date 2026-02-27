const pino = require('pino');
const pinoHttp = require('pino-http');
const { config } = require('../config/env');

const logger = pino({
  level: config.logLevel,
  base: null,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.body.token',
      'req.body.guestToken',
      'req.body.password',
      'req.body.idToken',
    ],
    censor: '[REDACTED]',
  },
});

const httpLogger = pinoHttp({
  logger,
  genReqId: (req) => req.id,
  customLogLevel: (_req, res, err) => {
    if (err || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
  customSuccessMessage: (req, res) => `${req.method} ${req.originalUrl} -> ${res.statusCode}`,
  customErrorMessage: (req, res, err) => `${req.method} ${req.originalUrl} failed: ${err.message} (${res.statusCode})`,
});

module.exports = { logger, httpLogger };
