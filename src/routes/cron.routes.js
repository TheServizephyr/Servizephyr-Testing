const express = require('express');
const { asyncHandler } = require('../middleware/asyncHandler');
const { proxyToLegacy } = require('../services/legacyProxy.service');
const { getCronCleanupRetention } = require('../services/cronRetention.service');

const router = express.Router();

router.get(
  '/cleanup-retention',
  asyncHandler(async (req, res) => {
    const payload = await getCronCleanupRetention(req);
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(payload);
  })
);

router.all(
  '*',
  asyncHandler(async (req, res) => proxyToLegacy(req, res))
);

module.exports = router;
