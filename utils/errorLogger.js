const ErrorLog = require("../models/ErrorLog");

async function logError(err, req) {
  try {
    await ErrorLog.create({
      message: err.message,
      stack: err.stack,
      route: req?.originalUrl || "unknown",
      method: req?.method || "unknown",
      user: req?.user?.email || "guest"
    });
  } catch (e) {
    console.error("Failed to log error:", e);
  }
}

const asyncHandler = fn => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { logError, asyncHandler };