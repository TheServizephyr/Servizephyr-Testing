const { randomUUID } = require('crypto');

function assignRequestId(req, res, next) {
  const incoming = req.headers['x-request-id'];
  req.id = (incoming && String(incoming).trim()) || randomUUID();
  res.setHeader('x-request-id', req.id);
  next();
}

module.exports = { assignRequestId };
