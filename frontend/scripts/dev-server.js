const http = require('http');
const { parse } = require('url');
const next = require('next');

const host = process.env.HOST || '0.0.0.0';
const port = Number(process.env.PORT || 3000);

if (!Number.isInteger(port) || port <= 0) {
  throw new Error(`Invalid PORT value: ${process.env.PORT}`);
}

const app = next({
  dev: true,
  hostname: host,
  port,
});
const handle = app.getRequestHandler();

let server;

const shutdown = (signal) => {
  if (!server) process.exit(0);
  console.log(`[dev-server] ${signal} received. Closing frontend server...`);
  server.close((error) => {
    if (error) {
      console.error('[dev-server] Frontend shutdown failed:', error);
      process.exit(1);
      return;
    }
    process.exit(0);
  });
};

app
  .prepare()
  .then(() => {
    server = http.createServer((req, res) => {
      const parsedUrl = parse(req.url, true);
      handle(req, res, parsedUrl);
    });

    server.listen(port, host, () => {
      console.log(`[dev-server] Next frontend ready on http://${host}:${port}`);
    });
  })
  .catch((error) => {
    console.error('[dev-server] Next frontend failed to start:', error);
    process.exit(1);
  });

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
