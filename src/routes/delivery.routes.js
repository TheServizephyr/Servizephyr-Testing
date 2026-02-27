const express = require('express');
const { asyncHandler } = require('../middleware/asyncHandler');
const { calculateCharge } = require('../services/deliveryCharge.service');

const router = express.Router();

router.use(express.json({ limit: '1mb' }));

router.post(
  '/calculate-charge',
  asyncHandler(async (req, res) => {
    const payload = await calculateCharge(req.body || {});
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(payload);
  })
);

module.exports = router;
