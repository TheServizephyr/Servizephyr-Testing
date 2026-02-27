const express = require('express');
const { asyncHandler } = require('../middleware/asyncHandler');
const { getTestPing, getTestAdmin } = require('../services/testUtility.service');

const router = express.Router();

router.get(
  '/test',
  asyncHandler(async (_req, res) => {
    const payload = await getTestPing();
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(payload);
  })
);

router.get(
  '/test-admin',
  asyncHandler(async (req, res) => {
    const payload = await getTestAdmin(req);
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(payload);
  })
);

module.exports = router;
