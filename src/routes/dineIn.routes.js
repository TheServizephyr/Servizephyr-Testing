const express = require('express');
const { asyncHandler } = require('../middleware/asyncHandler');
const { proxyToLegacy } = require('../services/legacyProxy.service');
const {
  getDineInTableStatus,
  createDineInTab,
  joinDineInTable,
  getDineInTabStatus,
  initiateDineInPayment,
  unlockDineInPayment,
} = require('../services/dineIn.service');
const { cleanDineInTable } = require('../services/dineInCleanTable.service');

const router = express.Router();
router.use(express.json({ limit: '1mb' }));

router.get(
  '/table-status',
  asyncHandler(async (req, res) => {
    const payload = await getDineInTableStatus(req);
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(payload);
  })
);

router.post(
  '/create-tab',
  asyncHandler(async (req, res) => {
    const payload = await createDineInTab(req.body || {});
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(payload);
  })
);

router.post(
  '/join-table',
  asyncHandler(async (req, res) => {
    const payload = await joinDineInTable(req.body || {});
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(payload);
  })
);

router.get(
  '/tab-status/:tabId',
  asyncHandler(async (req, res) => {
    const payload = await getDineInTabStatus(req);
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(payload);
  })
);

router.post(
  '/initiate-payment',
  asyncHandler(async (req, res) => {
    const payload = await initiateDineInPayment(req.body || {});
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(payload);
  })
);

router.post(
  '/unlock-payment',
  asyncHandler(async (req, res) => {
    const payload = await unlockDineInPayment(req.body || {});
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(payload);
  })
);

router.post(
  '/clean-table',
  asyncHandler(async (req, res) => {
    const payload = await cleanDineInTable(req.body || {});
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(payload);
  })
);

router.patch(
  '/clean-table',
  asyncHandler(async (req, res) => {
    const payload = await cleanDineInTable(req.body || {});
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(payload);
  })
);

router.all(
  '*',
  asyncHandler(async (req, res) => proxyToLegacy(req, res))
);

module.exports = router;
