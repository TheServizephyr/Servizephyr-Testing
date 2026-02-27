const http = require('http');

const { app } = require('./app');
const { config } = require('./config/env');
const { logger } = require('./lib/logger');
const { attachWebSocket } = require('./lib/websocket');

const server = http.createServer(app);
attachWebSocket(server);

server.listen(config.port, () => {
  logger.info(
    {
      port: config.port,
      nodeEnv: config.nodeEnv,
      legacyProxy: config.legacy.enableProxy,
    },
    'ServiZephyr Backend V2 started'
  );
});

function shutdown(signal) {
  logger.info({ signal }, 'Shutdown requested');
  server.close((error) => {
    if (error) {
      logger.error({ err: error }, 'Server close failed');
      process.exit(1);
      return;
    }
    logger.info('HTTP server closed');
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
