const express = require('express');
const { config } = require('../config/env');

const router = express.Router();

router.get('/', (_req, res) => {
  res.status(200).json({
    ok: true,
    service: 'servizephyr-backend-v2',
    nodeEnv: config.nodeEnv,
    uptimeSec: Math.round(process.uptime()),
    now: new Date().toISOString(),
  });
});

module.exports = router;
