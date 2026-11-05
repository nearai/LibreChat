const express = require('express');
const { nearAIAttestationHandler } = require('@librechat/api');
const { getUserKeyValues } = require('~/models');
const requireJwtAuth = require('~/server/middleware/requireJwtAuth');
const configMiddleware = require('~/server/middleware/config/app');

const router = express.Router();

router.get('/attestation', requireJwtAuth, configMiddleware, (req, res) =>
  nearAIAttestationHandler(req, res, getUserKeyValues),
);

module.exports = router;
