const express = require('express');
const { config } = require('../config/env');
const { asyncHandler } = require('../middleware/asyncHandler');
const { proxyToLegacy } = require('../services/legacyProxy.service');
const { processRazorpayWebhook } = require('../services/razorpayWebhook.service');

const router = express.Router();

// Keep webhook payload byte-for-byte for signature verification.
router.use(
  express.raw({
    type: '*/*',
    limit: '5mb',
  })
);

router.post(
  '/razorpay',
  asyncHandler(async (req, res) => {
    if (!config.payments.nativeRazorpayWebhook) {
      if (!config.legacy.enableProxy) {
        return res.status(501).json({
          error: 'Razorpay webhook native handler is disabled and legacy proxy is unavailable.',
        });
      }
      return proxyToLegacy(req, res);
    }

    const payload = await processRazorpayWebhook(req);
    res.setHeader('x-backend', 'render-v2');
    return res.status(200).json(payload);
  })
);

// Preserve legacy behavior for other webhook providers until migrated.
router.all(
  '*',
  asyncHandler(async (req, res) => proxyToLegacy(req, res))
);

module.exports = router;
