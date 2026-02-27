const { HttpError } = require('../utils/httpError');

function requestTimeout(timeoutMs) {
  return (req, res, next) => {
    res.setTimeout(timeoutMs, () => {
      if (res.headersSent) return;
      next(new HttpError(504, `Request timeout after ${timeoutMs}ms`));
    });
    next();
  };
}

module.exports = { requestTimeout };
