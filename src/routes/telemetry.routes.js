const express = require('express');
const { asyncHandler } = require('../middleware/asyncHandler');
const { proxyToLegacy } = require('../services/legacyProxy.service');
const { postClientTelemetryEvent } = require('../services/telemetryClientEvent.service');

const router = express.Router();
router.use(express.json({ limit: '256kb' }));

router.post(
  '/client-event',
  asyncHandler(async (req, res) => {
    const result = await postClientTelemetryEvent(req);
    res.setHeader('x-backend', 'render-v2');
    res.status(result.status || 202).json(result.payload);
  })
);

router.all(
  '*',
  asyncHandler(async (req, res) => proxyToLegacy(req, res))
);

module.exports = router;
