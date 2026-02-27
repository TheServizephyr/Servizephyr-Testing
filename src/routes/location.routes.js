const express = require('express');
const { asyncHandler } = require('../middleware/asyncHandler');
const { proxyToLegacy } = require('../services/legacyProxy.service');
const { getReverseGeocode, getSearchLocations } = require('../services/location.service');

const router = express.Router();

router.get(
  '/geocode',
  asyncHandler(async (req, res) => {
    const payload = await getReverseGeocode(req);
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(payload);
  })
);

router.get(
  '/search',
  asyncHandler(async (req, res) => {
    const payload = await getSearchLocations(req);
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(payload);
  })
);

router.all(
  '*',
  asyncHandler(async (req, res) => proxyToLegacy(req, res))
);

module.exports = router;
