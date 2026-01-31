// routes/adminRouter.js

const express = require("express");
const router = express.Router();

const User = require("../models/User");
const AuditLog = require("../models/AuditLog");
const ReviewNote = require("../models/ReviewNote");
const requireRole = require("../middleware/requireRole");
const { buildSuspiciousMap } = require("../utils/suspiciousDetection");

// GET /admin/profile  (list users)
router.get("/profile", requireRole("admin"), async (req, res) => {
  try {
    const users = await User.find().lean();
    res.render("adminProfile", { users, user: req.user });
  } catch (err) {
    console.error(err);
    res.status(500).send("Error loading admin profile");
  }
});

// POST /admin/users/:id/delete  (delete user)
router.post("/users/:id/delete", requireRole("admin"), async (req, res) => {
  try {
    const targetUserId = req.params.id;

    // Block deleting yourself
    if (req.user && String(req.user.id) === String(targetUserId)) {
      return res.status(400).send("You cannot delete your own account.");
    }

    const targetUser = await User.findById(targetUserId);
    if (!targetUser) {
      return res.status(404).send("User not found.");
    }

    // Prevent deleting last admin
    if (targetUser.role === "admin") {
      const adminCount = await User.countDocuments({ role: "admin" });
      if (adminCount <= 1) {
        return res.status(400).send("Cannot delete the last admin.");
      }
    }

    await User.findByIdAndDelete(targetUserId);

    // Optional: add audit logging here
    // await AuditLog.create({...})

    return res.redirect("/admin/profile");
  } catch (err) {
    console.error(err);
    return res.status(500).send("Failed to delete user.");
  }
});

// GET /admin/review  (recent compliance review)
router.get("/review", requireRole("admin"), async (req, res) => {
  try {

    // ----- Filters (Option 1: no time window) -----
    const type = String(req.query.type || "all").toLowerCase();     // all | burst | auth | anchoring | flipflop | sensitive | other
    const userQ = String(req.query.user || "").trim();              // username search
    const minSeverity = Math.max(parseInt(req.query.minSeverity || "1", 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || "200", 10) || 200, 50), 1000); // 50–1000


    // ----- Load recent logs -----
    const findQuery = {
      action_type: { $ne: "DEMO_ACTION" },
    };

    if (userQ) {
      const safe = userQ.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      findQuery.username = new RegExp(safe, "i");
    }

    const logs = await AuditLog.find(findQuery)
      .sort({ timestamp: -1 })
      .limit(3000) // safety cap
      .lean();


    // ✅ compute flags from the recent logs
    const suspiciousMap = buildSuspiciousMap(logs);

    function toMs(x) {
  const t = new Date(x || 0).getTime();
  return Number.isFinite(t) ? t : 0;
}




// ===============================
// OPTION A: GROUP INTO INCIDENTS
// ===============================

const burstGroups = new Map(); // key -> incident
const authGroups = new Map(); // key -> auth incident
const otherIncidents = [];

for (const log of logs) {
  const flag = suspiciousMap[String(log._id)];
  if (!flag) continue;

  const reasons = flag.reasons || [];
  const burstReason = reasons.find(r => r.startsWith("Burst edits:"));
  const authBurstReason = reasons.find(r => r.startsWith("Login/Logout burst:"));
  const timeMs = toMs(log.action_timestamp || log.timestamp);

  // ✅ GROUP auth bursts by user + 10-min window
if (authBurstReason) {
  const user = log.username || "System";
  const bucket = Math.floor(timeMs / (10 * 60 * 1000));
  const key = `${user}::${bucket}`;

  if (!authGroups.has(key)) {
    authGroups.set(key, {
      type: "AUTH_BURST",
      user,
      startTime: timeMs,
      endTime: timeMs,
      maxCount: 0,
      severity: 0,
    });
  }

  const g = authGroups.get(key);
  g.startTime = Math.min(g.startTime, timeMs);
  g.endTime = Math.max(g.endTime, timeMs);
  g.severity = Math.max(g.severity, flag.severity || 0);

  // Extract count from: "Login/Logout burst: 6 auth events ..."
  const m = authBurstReason.match(/Login\/Logout burst:\s*(\d+)/i);
  if (m) g.maxCount = Math.max(g.maxCount, Number(m[1]));

  continue; // ✅ don't treat auth bursts as burst edits
}


  // If NOT a burst-edit rule → keep as its own incident
  if (!burstReason && !authBurstReason) {
    function inferSuspiciousType(reasons = []) {
    if (reasons.some(r => r.startsWith("Change after anchoring"))) return "Change after anchoring";
    if (reasons.some(r => r.startsWith("Status flip-flop"))) return "Status flip-flop";
    if (reasons.some(r => r.startsWith("Sensitive edits"))) return "Sensitive field edits";
    if (reasons.some(r => r.startsWith("Burst edits"))) return "Burst edits";
    return "Suspicious activity";
  }

   otherIncidents.push({
    incidentId: `LOG::${String(log._id)}`,
    suspiciousType: inferSuspiciousType(reasons),
    type: "OTHER",
    user: log.username || "System",
    time: timeMs,
    entitySummary: String(log.entity_id || ""),
    severity: flag.severity || 1,
    reasons,
  });
  continue;
}

  // GROUP burst edits by user + 10-min window
  const user = log.username || "System";
  const bucket = Math.floor(timeMs / (10 * 60 * 1000)); // 10-min window
  const key = `${user}::${bucket}`;
 

  if (!burstGroups.has(key)) {
    burstGroups.set(key, {
      type: "BURST_EDITS",
      user,
      startTime: timeMs,
      endTime: timeMs,
      maxCount: 0,
      entities: new Set(),
      severity: 0,
    });
  }

  const group = burstGroups.get(key);
  group.startTime = Math.min(group.startTime, timeMs);
  group.endTime = Math.max(group.endTime, timeMs);
  group.entities.add(String(log.entity_id || ""));
  group.severity = Math.max(group.severity, flag.severity || 0);

  // Extract count from: "Burst edits: 10 actions within 10 min ..."
  if (burstReason) {
  const match = burstReason.match(/Burst edits:\s*(\d+)/i);
  if (match) group.maxCount = Math.max(group.maxCount, Number(match[1]));
}}



 
    // Build final incident list
    const incidents = [
  ...Array.from(burstGroups.values()).map(g => ({
    incidentId: `BURST_EDITS::${g.user}::${g.endTime}`,
    suspiciousType: "Burst edits",
    type: "BURST_EDITS",
    user: g.user,
    time: g.endTime,
    entitySummary: `${g.entities.size} delivery(s)`,
    severity: g.maxCount >= 15 ? 4 : g.maxCount >= 10 ? 3 : 2,
    reasons: [
      `Burst edits: ${g.maxCount} actions within 10 min by user ${g.user}`,
    ],
  })),

  ...Array.from(authGroups.values()).map(g => ({
    incidentId: `AUTH_BURST::${g.user}::${g.endTime}`,
    suspiciousType: "Login/Logout burst",
    type: "AUTH_BURST",
    user: g.user,
    time: g.endTime,
    entitySummary: `Authentication activity`,
    severity: 1,
    reasons: [
      `Login/Logout burst: ${g.maxCount} auth events within 10 min by user ${g.user}`,
    ],
  })),

  ...otherIncidents,
].sort((a, b) => b.time - a.time);

let filteredIncidents = incidents;

// Filter by type
if (type !== "all") {
  filteredIncidents = filteredIncidents.filter((it) => {
    const code = String(it.type || "").toUpperCase();
    const label = String(it.suspiciousType || "").toLowerCase();

    if (type === "burst") return code === "BURST_EDITS" || label.includes("burst");
    if (type === "auth") return code === "AUTH_BURST" || label.includes("login/logout");
    if (type === "anchoring") return label.includes("anchoring");
    if (type === "flipflop") return label.includes("flip");
    if (type === "sensitive") return label.includes("sensitive");
    if (type === "other") return code === "OTHER";
    return true;
  });
}

// Filter by minimum severity
filteredIncidents = filteredIncidents.filter(
  (it) => (it.severity || 1) >= minSeverity
);

// Limit results (keeps UI clean)
filteredIncidents = filteredIncidents.slice(0, limit);

// Load review notes for the incidents shown on this page
const incidentIds = filteredIncidents
  .map(i => i.incidentId)
  .filter(Boolean);

const notes = await ReviewNote.find({
  incident_id: { $in: incidentIds },
})
  .sort({ reviewed_at: -1 })
  .lean();

const notesByIncident = {};
for (const n of notes) {
  if (!notesByIncident[n.incident_id]) {
    notesByIncident[n.incident_id] = [];
  }
  notesByIncident[n.incident_id].push(n);
}



    return res.render("adminReview", {
      incidents: filteredIncidents,
      notesByIncident,
      user: req.user,
      filters: { type, user: userQ, minSeverity, limit },
    });

  } catch (err) {
    console.error("Error loading compliance review:", err);
    return res.status(500).send("Failed to load review page.");
  }
});

// POST /admin/review/note  (add a case note)
router.post("/review/note", requireRole("admin"), async (req, res) => {
  try {
    const { incidentId, review_status, review_comment } = req.body;

    await ReviewNote.create({
      incident_id: incidentId,
      review_status,
      review_comment,
      reviewed_by: {
        user_id: req.user.id,
        username: req.user.name || req.user.email || "admin",
      },
    });

    res.redirect("/admin/review");
  } catch (err) {
    console.error(err);
    res.status(500).send("Failed to save note");
  }
});

//delete route for review note
router.post("/review/note/:id/delete", requireRole("admin"), async (req, res) => {
  try {
    await ReviewNote.findByIdAndDelete(req.params.id);
    res.redirect("/admin/review");
  } catch (err) {
    console.error(err);
    res.status(500).send("Failed to delete note");
  }
});



module.exports = router;
