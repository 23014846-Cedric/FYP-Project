// routes/auditRouter.js
const express = require("express");
const router = express.Router();
const { getAuditLogs } = require("../controllers/auditController");

router.get("/auditLog", getAuditLogs);

module.exports = router;
