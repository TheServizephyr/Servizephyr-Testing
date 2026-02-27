const express = require('express');
const { asyncHandler } = require('../middleware/asyncHandler');
const { proxyToLegacy } = require('../services/legacyProxy.service');
const { getDiscoverLocations } = require('../services/discoverLocations.service');

const router = express.Router();

router.get(
  '/locations',
  asyncHandler(async (_req, res) => {
    const payload = await getDiscoverLocations();
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(payload);
  })
);

router.all(
  '*',
  asyncHandler(async (req, res) => proxyToLegacy(req, res))
);

module.exports = router;
