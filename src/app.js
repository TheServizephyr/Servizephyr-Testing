const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');

const { config } = require('./config/env');
const { logger, httpLogger } = require('./lib/logger');
const { assignRequestId } = require('./middleware/requestId');
const { requestTimeout } = require('./middleware/requestTimeout');
const { opsRequestTelemetry } = require('./middleware/opsRequestTelemetry');
const { notFoundHandler } = require('./middleware/notFound');
const { errorHandler } = require('./middleware/errorHandler');

const healthRoutes = require('./routes/health.routes');
const publicRoutes = require('./routes/public.routes');
const orderRoutes = require('./routes/order.routes');
const ownerRoutes = require('./routes/owner.routes');
const deliveryRoutes = require('./routes/delivery.routes');
const customerRoutes = require('./routes/customer.routes');
const dineInRoutes = require('./routes/dineIn.routes');
const paymentRoutes = require('./routes/payment.routes');
const aiRoutes = require('./routes/ai.routes');
const riderRoutes = require('./routes/rider.routes');
const employeeRoutes = require('./routes/employee.routes');
const adminRoutes = require('./routes/admin.routes');
const webhooksRoutes = require('./routes/webhooks.routes');
const locationRoutes = require('./routes/location.routes');
const discoverRoutes = require('./routes/discover.routes');
const waitlistRoutes = require('./routes/waitlist.routes');
const telemetryRoutes = require('./routes/telemetry.routes');
const cronRoutes = require('./routes/cron.routes');
const utilityRoutes = require('./routes/utility.routes');
const authRoutes = require('./routes/auth.routes');
const userRoutes = require('./routes/user.routes');
const whatsappRoutes = require('./routes/whatsapp.routes');
const proxyRoutes = require('./routes/proxy.routes');

const app = express();
app.disable('x-powered-by');

if (config.cache.publicBootstrapTtlSec < 300) {
  logger.warn(
    { ttlSec: config.cache.publicBootstrapTtlSec },
    'CACHE_PUBLIC_BOOTSTRAP_TTL_SEC is very low; public menu endpoint may stay slow under load.'
  );
}

app.use(assignRequestId);
app.use(httpLogger);
app.use(requestTimeout(config.requestTimeoutMs));
app.use(opsRequestTelemetry);
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  })
);
app.use(compression());
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (config.cors.origins.includes(origin)) return callback(null, true);
      const err = new Error(`CORS blocked for origin: ${origin}`);
      err.status = 403;
      return callback(err);
    },
    credentials: config.cors.allowCredentials,
  })
);

app.get('/', (_req, res) => {
  res.status(200).json({
    service: 'ServiZephyr Backend V2',
    status: 'ok',
    version: '0.1.0',
    mode: config.nodeEnv,
  });
});

app.use('/healthz', healthRoutes);
app.use('/readyz', healthRoutes);

// Migrated routes (served directly by this backend).
app.use('/api/public', publicRoutes);
app.use('/api/order', orderRoutes);
app.use('/api/owner', ownerRoutes);
app.use('/api/delivery', deliveryRoutes);
app.use('/api/customer', customerRoutes);
app.use('/api/dine-in', dineInRoutes);
app.use('/api/payment', paymentRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/rider', riderRoutes);
app.use('/api/employee', employeeRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/webhooks', webhooksRoutes);
app.use('/api/location', locationRoutes);
app.use('/api/discover', discoverRoutes);
app.use('/api/waitlist', waitlistRoutes);
app.use('/api/telemetry', telemetryRoutes);
app.use('/api/cron', cronRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/user', userRoutes);
app.use('/api/whatsapp', whatsappRoutes);
app.use('/api', utilityRoutes);

// Non-migrated routes fall back to legacy Vercel API until migrated.
if (config.legacy.enableProxy) {
  logger.info({ legacyBaseUrl: config.legacy.baseUrl || '(unset)' }, 'Legacy proxy enabled');
  app.use('/api', proxyRoutes);
}

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = { app };
