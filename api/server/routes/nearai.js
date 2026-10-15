const express = require('express');
const { nearAIAttestationHandler } = require('@librechat/api');
const requireJwtAuth = require('~/server/middleware/requireJwtAuth');
const configMiddleware = require('~/server/middleware/config/app');

const router = express.Router();

router.get('/attestation', requireJwtAuth, configMiddleware, nearAIAttestationHandler);

module.exports = router;
