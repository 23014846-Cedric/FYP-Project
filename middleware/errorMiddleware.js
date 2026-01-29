const { logError } = require("../utils/errorLogger");

function notFound(req, res, next) {
  const error = new Error(`Not Found - ${req.originalUrl}`);
  res.status(404);
  next(error);
}

async function errorHandler(err, req, res, next) {
  await logError(err, req);

  res.status(res.statusCode === 200 ? 500 : res.statusCode);

  if (req.originalUrl.startsWith("/api")) {
    res.json({ message: err.message });
  } else {
    res.send("Something went wrong. Please try again.");
  }
}

module.exports = { notFound, errorHandler };
