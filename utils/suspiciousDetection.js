/**
 * Returns a map of suspicious flags keyed by AuditLog _id (or hash).
 * Each entry includes reasons[] and a severity score.
 *
 * You can tune thresholds here without touching controllers/views.
 */

function ms(minutes) {
  return minutes * 60 * 1000;
}

function hours(h) {
  return h * 60 * 60 * 1000;
}

const DEFAULTS = {
  burstWindowMs: ms(10),       // "short time"
  burstThreshold: 8,           // too many edits in burstWindowMs
  flipFlopWindowMs: hours(24), // lookback window for status flip-flops
  sensitiveWindowMs: hours(24),
  sensitiveThreshold: 3,       // address edits in sensitiveWindowMs
};

function isFlipFlop(a, b, c) {
  // Example: Delivered -> Failed -> Delivered OR Failed -> Delivered -> Failed
  const pattern1 = a === "Delivered" && b === "Failed" && c === "Delivered";
  const pattern2 = a === "Failed" && b === "Delivered" && c === "Failed";
  return pattern1 || pattern2;
}

// Try to detect whether a log entry is an address/sensitive edit.
// Adjust keywords to match your actual payload fields.
function isSensitiveEdit(log) {
  const s = JSON.stringify(log?.changes || log?.details || log?.metadata || log || {}).toLowerCase();
  const keywords = ["address", "postal", "zipcode", "zip", "street", "unit", "block"];
  return keywords.some(k => s.includes(k));
}

function getStatusChange(log) {
  const field = String(log.field || "").toLowerCase();
  if (field !== "status") return null;

  const from = log.old_value || null;
  const to = log.new_value || null;

  if (!to) return null;
  return { from, to };
}

function actionType(log) {
  return String(log.action_type || "").toUpperCase();
}

function isAuthEvent(log) {
  const a = actionType(log);
  return a === "LOGIN" || a === "LOGOUT";
}

function isEditEvent(log) {
  // ✅ Burst edits should mean DATA edits, not auth events
  if (isAuthEvent(log)) return false;

  const a = actionType(log);

  // Count typical data-change actions as "edits"
  if (a.includes("UPDATE")) return true;
  if (a.includes("EDIT")) return true;
  if (a.includes("IMPORT")) return true; // optional; set false if you don't want imports counted

  // Fallback: if field/old/new exists, it's likely a change
  if (log.field && (log.old_value !== undefined || log.new_value !== undefined)) return true;

  return false;
}



function getUserKey(log) {
  // try common user fields
  return String(log.user_id || log.actor_id || log.user || log.email || "unknown");
}

function getEntityKey(log) {
  // the "thing" being edited: deliveryId, recordId, etc.
  return String(log.entity_id || log.delivery_id || log.record_id || log.target_id || "unknown_entity");
}

function getActionTime(log) {
  return new Date(log.action_timestamp || log.timestamp || log.created_at || log.createdAt || Date.now()).getTime();
}

function getAnchoredAtTime(log) {
  // sometimes anchoring is stored on the log, or on entity.
  // If your AuditLog stores anchored_at per record, use that.
  const t = log.anchored_at || log.anchoredAt;
  return t ? new Date(t).getTime() : null;
}

/**
 * Build suspicious map from a list of logs.
 * @param {Array} logs - audit logs sorted DESC by time (newest first) recommended
 * @param {Object} opts - thresholds
 */
function buildSuspiciousMap(logs, opts = {}) {
  const cfg = { ...DEFAULTS, ...opts };

  // Prepare: sort oldest->newest for sequence rules (flip-flop etc.)
  const ordered = [...logs].sort((a, b) => getActionTime(a) - getActionTime(b));

  const suspicious = {}; // key: log._id (string) => { reasons:[], severity:number }

  // --- Rule 1: burst edits by same user within burstWindow
  // We'll use a sliding window per user.
  const byUser = new Map();
  for (const log of ordered) {
  if (!isEditEvent(log)) continue; // ✅ ignore LOGIN/LOGOUT and non-edits

  const user = getUserKey(log);
  const t = getActionTime(log);
  if (!byUser.has(user)) byUser.set(user, []);
  byUser.get(user).push({ t, id: String(log._id) });
}

    

  for (const [user, arr] of byUser.entries()) {
    let left = 0;
    for (let right = 0; right < arr.length; right++) {
      while (arr[right].t - arr[left].t > cfg.burstWindowMs) left++;
      const count = right - left + 1;
      if (count >= cfg.burstThreshold) {
        // Flag all logs in the window (or just the latest). We'll flag the latest for minimal noise.
        const latestId = arr[right].id;
        suspicious[latestId] = suspicious[latestId] || { reasons: [], severity: 0 };
        suspicious[latestId].reasons.push(`Burst edits: ${count} actions within ${Math.round(cfg.burstWindowMs/60000)} min by user ${user}`);
        suspicious[latestId].severity += 2;
      }
    }
  }
// --- Rule 1B: login/logout burst (auth events only)
const authByUser = new Map();
for (const log of ordered) {
  if (!isAuthEvent(log)) continue;

  const user = getUserKey(log);
  const t = getActionTime(log);
  if (!authByUser.has(user)) authByUser.set(user, []);
  authByUser.get(user).push({ t, id: String(log._id) });
}

// Tune these independently from edits
const authWindowMs = ms(10);
const authThreshold = 6;

for (const [user, arr] of authByUser.entries()) {
  let left = 0;
  for (let right = 0; right < arr.length; right++) {
    while (arr[right].t - arr[left].t > authWindowMs) left++;
    const count = right - left + 1;

    if (count >= authThreshold) {
      const latestId = arr[right].id;
      suspicious[latestId] = suspicious[latestId] || { reasons: [], severity: 0 };
      suspicious[latestId].reasons.push(
        `Login/Logout burst: ${count} auth events within ${Math.round(authWindowMs / 60000)} min by user ${user}`
      );
      suspicious[latestId].severity += 2;
    }
  }
}

  // --- Rule 2: flip-flopping status for same entity
  const byEntity = new Map();
  for (const log of ordered) {
    const entity = getEntityKey(log);
    if (!byEntity.has(entity)) byEntity.set(entity, []);
    byEntity.get(entity).push(log);
  }

  for (const [entity, arr] of byEntity.entries()) {
    // Only consider status change logs
    const statusLogs = arr
      .map(l => ({ log: l, st: getStatusChange(l), t: getActionTime(l) }))
      .filter(x => x.st && x.st.to);

    for (let i = 2; i < statusLogs.length; i++) {
      const a = statusLogs[i - 2];
      const b = statusLogs[i - 1];
      const c = statusLogs[i];
      if (c.t - a.t > cfg.flipFlopWindowMs) continue;

      // pattern: to-values sequence flip-flop (Delivered->Failed->Delivered etc.)
      const s1 = a.st.to;
      const s2 = b.st.to;
      const s3 = c.st.to;

      if (isFlipFlop(s1, s2, s3)) {
        const id = String(c.log._id);
        suspicious[id] = suspicious[id] || { reasons: [], severity: 0 };
        suspicious[id].reasons.push(`Status flip-flop for entity ${entity}: ${s1} → ${s2} → ${s3}`);
        suspicious[id].severity += 3;
      }
    }
  }

  // --- Rule 3: changes after anchored_at
  // Interpretation: if a log has anchored_at and the action time is AFTER anchored_at, flag it.
  // If anchoring is stored elsewhere (e.g., on CardDelivery), you’ll adapt this rule later.
  for (const log of ordered) {
    const anchoredAt = getAnchoredAtTime(log);
    if (!anchoredAt) continue;
    const t = getActionTime(log);
    if (t > anchoredAt) {
      const id = String(log._id);
      suspicious[id] = suspicious[id] || { reasons: [], severity: 0 };
      suspicious[id].reasons.push(`Change after anchoring: action at ${new Date(t).toISOString()} > anchored_at ${new Date(anchoredAt).toISOString()}`);
      suspicious[id].severity += 5;
    }
  }

  // --- Rule 4: sensitive field edits too often (address edits)
  const sensitiveByUserEntity = new Map();
  for (const log of ordered) {
    if (!isSensitiveEdit(log)) continue;
    const user = getUserKey(log);
    const entity = getEntityKey(log);
    const key = `${user}::${entity}`;
    const t = getActionTime(log);
    if (!sensitiveByUserEntity.has(key)) sensitiveByUserEntity.set(key, []);
    sensitiveByUserEntity.get(key).push({ t, id: String(log._id) });
  }

  for (const [key, arr] of sensitiveByUserEntity.entries()) {
    let left = 0;
    for (let right = 0; right < arr.length; right++) {
      while (arr[right].t - arr[left].t > cfg.sensitiveWindowMs) left++;
      const count = right - left + 1;
      if (count >= cfg.sensitiveThreshold) {
        const latestId = arr[right].id;
        suspicious[latestId] = suspicious[latestId] || { reasons: [], severity: 0 };
        suspicious[latestId].reasons.push(`Sensitive edits: ${count} address-related edits within 24h (${key})`);
        suspicious[latestId].severity += 2;
      }
    }
  }

  return suspicious;
}

module.exports = { buildSuspiciousMap };
