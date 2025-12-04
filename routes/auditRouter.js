// routes/auditRouter.js
const express = require("express");
const router = express.Router();
const { getAuditLogs } = require("../controllers/auditController");

// /audit/logs
router.get("/logs", getAuditLogs);

// /audit -> redirect to /audit/logs
router.get("/", (req, res) => res.redirect("/audit/logs"));

module.exports = router;
