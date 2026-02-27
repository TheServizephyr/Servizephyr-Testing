const express = require('express');
const { asyncHandler } = require('../middleware/asyncHandler');
const { proxyToLegacy } = require('../services/legacyProxy.service');

const router = express.Router();

// Keep request payload byte-for-byte for proxied routes (important for webhook signatures).
router.use(
  express.raw({
    type: '*/*',
    limit: '10mb',
  })
);

router.all('*', asyncHandler(proxyToLegacy));

module.exports = router;
