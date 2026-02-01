// utils/notificationService.js
const Notification = require("../models/Notification");

async function createNotification(payload, { dedupeMinutes = 30 } = {}) {
  const now = new Date();

  // prevent duplicates for a short window
  if (payload.dedupe_key) {
    const since = new Date(now.getTime() - dedupeMinutes * 60 * 1000);

    const existing = await Notification.findOne({
      dedupe_key: payload.dedupe_key,
      createdAt: { $gte: since },
    }).lean();

    if (existing) return existing; // skip creating duplicate
  }

  return Notification.create(payload);
}

// Convenience: send to roles
async function notifyRoles(roles, payload, opts) {
  return createNotification(
    {
      ...payload,
      target_roles: roles,
    },
    opts
  );
}

module.exports = { createNotification, notifyRoles };
