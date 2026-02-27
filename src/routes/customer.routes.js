const express = require('express');
const { config } = require('../config/env');
const { asyncHandler } = require('../middleware/asyncHandler');
const { lookupCustomer } = require('../services/customerLookup.service');
const { getCustomerProfile, updateCustomerProfile } = require('../services/customerProfile.service');
const { getCustomerHubData } = require('../services/customerHubData.service');
const { createOrderFromCustomerRegister } = require('../services/customerRegister.service');
const { getCustomerAnalytics } = require('../services/customerAnalytics.service');
const { proxyToLegacy } = require('../services/legacyProxy.service');

const router = express.Router();

router.use(express.json({ limit: '1mb' }));

router.post(
  '/lookup',
  asyncHandler(async (req, res) => {
    const payload = await lookupCustomer(req);
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(payload);
  })
);

router.post(
  '/register',
  asyncHandler(async (req, res) => {
    const result = await createOrderFromCustomerRegister({
      req,
      body: req.body || {},
    });

    if (result.mode === 'legacy') {
      if (!config.legacy.enableProxy) {
        res.setHeader('x-backend', 'render-v2');
        res.setHeader('x-customer-register-mode', `native:unsupported:${result.reason || 'unsupported'}`);
        return res.status(422).json({
          error: 'Unsupported customer register flow in native backend.',
          reason: result.reason || 'unsupported',
        });
      }

      res.setHeader('x-customer-register-mode', `legacy:${result.reason || 'unsupported'}`);
      return proxyToLegacy(req, res);
    }

    res.setHeader('x-backend', 'render-v2');
    res.setHeader('x-customer-register-mode', result.duplicate ? 'native:duplicate' : 'native:new');
    return res.status(200).json(result.payload);
  })
);

router.get(
  '/profile',
  asyncHandler(async (req, res) => {
    const result = await getCustomerProfile(req);
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(result.payload);
  })
);

router.patch(
  '/profile',
  asyncHandler(async (req, res) => {
    const result = await updateCustomerProfile(req, req.body || {});
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(result.payload);
  })
);

router.get(
  '/hub-data',
  asyncHandler(async (req, res) => {
    const result = await getCustomerHubData(req);
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(result.payload);
  })
);

router.get(
  '/analytics',
  asyncHandler(async (req, res) => {
    const result = await getCustomerAnalytics(req);
    res.setHeader('x-backend', 'render-v2');
    res.setHeader('Cache-Control', 'private, max-age=60');
    res.status(200).json(result.payload);
  })
);

router.all(
  '*',
  asyncHandler(async (req, res) => proxyToLegacy(req, res))
);

module.exports = router;
