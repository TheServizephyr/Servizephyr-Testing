const express = require('express');
const { asyncHandler } = require('../middleware/asyncHandler');
const { postWaitlistEntry } = require('../services/waitlist.service');
const { proxyToLegacy } = require('../services/legacyProxy.service');

const router = express.Router();
router.use(express.json({ limit: '1mb' }));

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const payload = await postWaitlistEntry(req);
    res.setHeader('x-backend', 'render-v2');
    res.status(201).json(payload);
  })
);

router.all(
  '*',
  asyncHandler(async (req, res) => proxyToLegacy(req, res))
);

module.exports = router;
