// controllers/auditController.js
const AuditLog = require("../models/AuditLog");

function escapeRegex(input = "") {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

exports.getAuditLogs = async (req, res) => {
  try {
    const q = (req.query.q || "").trim();
    const action = (req.query.action || "").trim();
    const entity = (req.query.entity || "").trim();
    const user = (req.query.user || "").trim();
    const source = (req.query.source || "").trim();
    const from = (req.query.from || "").trim();
    const to = (req.query.to || "").trim();

    const sortBy = (req.query.sortBy || "timestamp").trim();
    const order = (req.query.order || "desc").trim();

    let page = parseInt(req.query.page, 10);
    if (isNaN(page) || page < 1) page = 1;

    let limit = parseInt(req.query.limit, 10);
    const allowedLimits = [10, 25, 50, 100];
    if (isNaN(limit) || !allowedLimits.includes(limit)) limit = 25;

    const filter = {};

    if (q) {
      const safe = escapeRegex(q);
      const regex = new RegExp(safe, "i");
      filter.$or = [
        { username: regex },
        { action_type: regex },
        { entity_type: regex },
        { entity_id: regex },
        { field: regex },
        { old_value: regex },
        { new_value: regex },
        { source: regex },
        { remarks: regex },
      ];
    }

    if (action) filter.action_type = action;
    if (entity) filter.entity_type = entity;
    if (source) filter.source = source;

    if (user) filter.username = new RegExp(escapeRegex(user), "i");

    if (from || to) {
      filter.timestamp = {};
      if (from) filter.timestamp.$gte = new Date(`${from}T00:00:00.000Z`);
      if (to) filter.timestamp.$lte = new Date(`${to}T23:59:59.999Z`);
    }

    const allowedSort = ["timestamp", "username", "action_type", "entity_type", "source"];
    const sortField = allowedSort.includes(sortBy) ? sortBy : "timestamp";
    const sortOrder = order === "asc" ? 1 : -1;
    const sortObj = { [sortField]: sortOrder };

    const skip = (page - 1) * limit;

    const [total, logs, actionOptions, entityOptions, sourceOptions] = await Promise.all([
      AuditLog.countDocuments(filter),
      AuditLog.find(filter).sort(sortObj).skip(skip).limit(limit).lean(),
      AuditLog.distinct("action_type"),
      AuditLog.distinct("entity_type"),
      AuditLog.distinct("source"),
    ]);

    const totalPages = Math.max(1, Math.ceil(total / limit));
    if (page > totalPages) page = totalPages;

    // ✅ IMPORTANT: pass everything the EJS uses
    return res.render("auditLog", {
      logs,
      total,
      page,
      limit,
      totalPages,
      filters: { q, action, entity, user, source, from, to, sortBy: sortField, order },
      options: {
        actions: actionOptions.sort(),
        entities: entityOptions.sort(),
        sources: sourceOptions.sort(),
        limits: allowedLimits,
        sortFields: allowedSort,
      },
    });
  } catch (err) {
    console.error("Error loading audit logs:", err);
    return res.status(500).send("Error loading audit logs");
  }
};

