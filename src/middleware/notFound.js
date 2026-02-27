function notFoundHandler(req, res) {
  res.status(404).json({
    message: 'Route not found',
    path: req.originalUrl,
    requestId: req.id,
  });
}

module.exports = { notFoundHandler };
