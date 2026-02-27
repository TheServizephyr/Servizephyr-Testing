const express = require('express');
const { asyncHandler } = require('../middleware/asyncHandler');
const { normalizeMenuSource, buildBootstrapPayload } = require('../services/publicBootstrap.service');
const { getDiscoverLocations } = require('../services/discoverLocations.service');
const { getReverseGeocode, getSearchLocations, getIpLocation } = require('../services/location.service');
const { getPublicRestaurantOverview } = require('../services/publicRestaurantOverview.service');

const router = express.Router();

async function handleBootstrap(req, res) {
  const restaurantId = req.params.restaurantId;
  const source = normalizeMenuSource(req.query.src);
  const skipCache = ['1', 'true', 'yes'].includes(String(req.query.skip_cache || '').toLowerCase());

  const { payload, cacheStatus } = await buildBootstrapPayload({
    restaurantId,
    source,
    skipCache,
  });

  res.setHeader('x-cache', cacheStatus);
  res.setHeader('x-backend', 'render-v2');
  res.setHeader('x-menu-version', String(payload.menuVersion || 1));
  res.setHeader('cache-control', 'public, s-maxage=60, stale-while-revalidate=600');
  return res.status(200).json(payload);
}

// New consolidated endpoint for frontend migration.
router.get('/bootstrap/:restaurantId', asyncHandler(handleBootstrap));

// Backward-compatible endpoint path currently used by Next frontend.
router.get('/menu/:restaurantId', asyncHandler(handleBootstrap));

router.get(
  '/locations',
  asyncHandler(async (_req, res) => {
    const payload = await getDiscoverLocations();
    res.setHeader('x-backend', 'render-v2');
    return res.status(200).json(payload);
  })
);

router.get(
  '/location/geocode',
  asyncHandler(async (req, res) => {
    const payload = await getReverseGeocode(req);
    res.setHeader('x-backend', 'render-v2');
    return res.status(200).json(payload);
  })
);

router.get(
  '/location/search',
  asyncHandler(async (req, res) => {
    const payload = await getSearchLocations(req);
    res.setHeader('x-backend', 'render-v2');
    return res.status(200).json(payload);
  })
);

router.get(
  '/location/ip',
  asyncHandler(async (req, res) => {
    const payload = await getIpLocation(req);
    res.setHeader('x-backend', 'render-v2');
    return res.status(200).json(payload);
  })
);

router.get(
  '/restaurant-overview/:restaurantId',
  asyncHandler(async (req, res) => {
    const payload = await getPublicRestaurantOverview(req.params.restaurantId);
    res.setHeader('x-backend', 'render-v2');
    return res.status(200).json(payload);
  })
);

module.exports = router;
