// app.js
require("dotenv").config({ override: true });

const express       = require('express');
const mongoose      = require('mongoose');
const cookieParser  = require('cookie-parser');
const path          = require('path');
const jwt           = require('jsonwebtoken');
const session = require("express-session");
const MongoStore = require("connect-mongo").default;

// Utils
const { maskCard, maskAddress } = require('./utils/mask');

// Models
const CardDelivery  = require('./models/CardDelivery');
const ErrorLog = require("./models/ErrorLog");
const User = require("./models/User");

// Routers
const contactRouter   = require('./routes/contactRouter');
const auditRouter     = require('./routes/auditRouter');
const authRouter      = require('./routes/authRouter');
const deliveryRouter  = require('./routes/deliveryRouter');
const exceptionRouter = require('./routes/exceptionRouter');
const operationsRouter = require("./routes/operationsRouter");
const adminRouter = require("./routes/adminRouter");
const printerRouter = require("./routes/printerRouter");
const revealRouter = require("./routes/revealRouter");
const auditApiRouter = require("./routes/auditApiRouter");
const importBatchApiRouter = require("./routes/importBatchApiRouter");
const courierRouter = require("./routes/courierRouter");

// Middleware
const authMiddleware = require('./middleware/authMiddleware');
const requireRole = require('./middleware/requireRole');
const revealMiddleware = require("./middleware/revealMiddleware");
const { notFound, errorHandler } = require("./middleware/errorMiddleware");

const app  = express();
const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGODB_URI;

// -------------------- BACKGROUND JOBS --------------------
const startAnchorJob = require("./jobs/anchorAuditJob");
startAnchorJob();

// -------------------- CORE MIDDLEWARE --------------------

// Parse form data & JSON
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Cookies
app.use(cookieParser());

// Sessions
app.use(session({
  secret: process.env.SESSION_SECRET || process.env.JWT_SECRET,
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({ mongoUrl: MONGO_URI, collectionName: "sessions" }),
  cookie: { httpOnly: true, maxAge: 1000 * 60 * 60 * 8 }
}));

// Static assets
app.use(express.static(path.join(__dirname, 'public')));

// View engine (EJS)
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Reveal middleware to check for card number and address dashboard
app.use(revealMiddleware);

// Make mask helpers available globally
app.use((req, res, next) => {
  res.locals.maskCard = maskCard;
  res.locals.maskAddress = maskAddress;
  next();
});

// -------------------- ROUTER MOUNTING --------------------

// Mount audit API router
app.use(auditApiRouter);

// Mount reveal router
app.use(revealRouter);

// Deliveries and Exceptions – Admin + Operations
app.use("/deliveries", authMiddleware, requireRole(["admin","operations"]), deliveryRouter);
app.use("/exceptions", authMiddleware, requireRole(["admin","operations"]), exceptionRouter);

// Attach decoded user (if any) to res.locals for all views
function attachUserFromToken(req, res, next) {
  res.locals.user = null;

  const token = req.cookies.token;
  if (!token) return next();

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    res.locals.user = decoded;
    // also attach to req so middlewares can use it
    req.user = decoded;
  } catch (err) {
    res.locals.user = null;
  }

  next();
}

app.use(attachUserFromToken);

app.use(importBatchApiRouter);

// Simple admin-only middleware
function adminMiddleware(req, res, next) {
  if (req.user && (req.user.role === "admin" || req.user.role === "operations")) {
    return next();
  }
  return res.status(403).send("Access denied. Admin/Operations only.");
}


// -------------------- PAGE ROUTES --------------------

// Public pages
app.get('/',        (req, res) => res.redirect('/login'));
app.get('/login',   (req, res) => res.render('login',   { errors: [] }));
app.get('/signup',  (req, res) => res.render('signup',  { errors: [], formData: {} }));
app.get('/about',   (req, res) => res.render('about',   { errors: [], formData: {} }));
app.get('/profile', authMiddleware, (req, res) => res.render('profile'));
app.get("/auditDemo", authMiddleware, (req, res) => {
  res.render("auditDemo");
});

// Error diagnostics page – Operations only
app.get("/errorDiagnostics", authMiddleware, async (req, res) => {
  if (!req.user || req.user.role !== "operations") {
    return res.status(403).render("403", {
      message: "You do not have permission to access this page.",
    });
  }

  try {
    const logs = await ErrorLog.find().sort({ createdAt: -1 }).lean();
    return res.render("errorDiagnostics", { logs });
  } catch (err) {
    console.error("Error loading error diagnostics:", err);
    return res.render("errorDiagnostics", { logs: [] });
  }
});


// Protected dashboard (any logged-in user)
// Protected dashboard
// Protected dashboard (any logged-in user)
app.get("/dashboard", authMiddleware, async (req, res) => {
  try {
    if (!req.user || !["admin", "operations", "printer"].includes(req.user.role)) {
      return res.status(403).send("Access denied");
    }

    // Pagination
    const page = Math.max(parseInt(req.query.page || "1", 10), 1);
    const limit = 10;
    const skip = (page - 1) * limit;

    // Role-based filter (keep consistent with what user can see)
    const filter =
  (req.user.role === "admin" || req.user.role === "operations")
    ? {}
    : { assigned_printer: req.user._id };

    const total = await CardDelivery.countDocuments(filter);
    const totalPages = Math.max(Math.ceil(total / limit), 1);

    const deliveries = await CardDelivery.find(filter)
      .sort({ updated_at: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    // Status list from schema enum (auto-updates if you change CardDelivery.STATUS later)
    const statusList = CardDelivery.schema.path("status").enumValues || [
      "Pending",
      "Shipped",
      "Delivered",
      "Failed",
    ];

    // Count each status in ONE query
    const grouped = await CardDelivery.aggregate([
      { $match: filter },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]);

    const statsByStatus = Object.fromEntries(statusList.map((s) => [s, 0]));
    for (const row of grouped) {
      if (row && row._id) statsByStatus[row._id] = row.count;
    }

    // Keep your existing chart stats too
    const stats = {
      total,
      delivered: statsByStatus["Delivered"] || 0,
      inTransit: statsByStatus["Shipped"] || 0,
      exceptions: Math.max(total - (statsByStatus["Delivered"] || 0), 0),
    };

    return res.render("dashboard", {
      user: req.user,
      deliveries,
      stats,
      statusList,
      statsByStatus,
      page,
      totalPages,
    });
  } catch (err) {
    console.error("Error loading dashboard:", err);

    const fallbackStatuses = ["Pending", "Shipped", "Delivered", "Failed"];
    return res.render("dashboard", {
      user: req.user,
      deliveries: [],
      stats: { total: 0, delivered: 0, inTransit: 0, exceptions: 0 },
      statusList: fallbackStatuses,
      statsByStatus: Object.fromEntries(fallbackStatuses.map((s) => [s, 0])),
      page: 1,
      totalPages: 1,
    });
  }
});

// ===== AUDIT LOG (with filters) =====
const AuditLog = require("./models/AuditLog");

app.get("/auditLog", authMiddleware, async (req, res) => {
  try {
    // admin-only (adjust if needed)
    if (!req.user || req.user.role !== "admin") return res.status(403).send("Access denied");

    const page = Math.max(parseInt(req.query.page || "1", 10), 1);
    const perPage = Math.min(Math.max(parseInt(req.query.perPage || "20", 10), 5), 100);
    const skip = (page - 1) * perPage;

    const q = (req.query.q || "").trim();
    const action = (req.query.action || "").trim();
    const entity = (req.query.entity || "").trim();
    const batchId = (req.query.batchId || "").trim();
    const anchored = (req.query.anchored || "").trim(); // "anchored" | "pending" | ""

    const from = (req.query.from || "").trim(); // YYYY-MM-DD
    const to = (req.query.to || "").trim();     // YYYY-MM-DD

    const filter = {};

    if (action) filter.action_type = action;
    if (entity) filter.entity_type = entity;

    if (anchored === "anchored") filter.anchored = true;
    if (anchored === "pending") filter.anchored = false;

    if (batchId) {
      filter.$or = [
        { import_batch_id: batchId },
        { anchor_batch: batchId },
      ];
    }

    if (from || to) {
      filter.timestamp = {};
      if (from) filter.timestamp.$gte = new Date(from + "T00:00:00.000Z");
      if (to) filter.timestamp.$lte = new Date(to + "T23:59:59.999Z");
    }

    if (q) {
      const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      const qOr = [
        { username: re },
        { action_type: re },
        { entity_type: re },
        { entity_id: re },
        { field: re },
        { old_value: re },
        { new_value: re },
        { source: re },
        { remarks: re },
        { hash: re },
        { prev_hash: re },
        { anchor_tx: re },
        { import_batch_id: re },
        { anchor_batch: re },
      ];
      if (filter.$or) filter.$and = [{ $or: filter.$or }, { $or: qOr }];
      else filter.$or = qOr;
      delete filter.$or; // handled by $and when batchId exists
      if (!filter.$and) filter.$or = qOr;
    }

    const total = await AuditLog.countDocuments(filter);
    const totalPages = Math.max(Math.ceil(total / perPage), 1);

    const logs = await AuditLog.find(filter)
      .sort({ timestamp: -1, _id: -1 })
      .skip(skip)
      .limit(perPage)
      .lean();

    // =======================
    // AUDIT PAGE CHART DATA
    // =======================

    // last 14 days window
    // 1️⃣ Actions Over Time
    const days = 14;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - (days - 1));
    startDate.setHours(0, 0, 0, 0);

    const trendAgg = await AuditLog.aggregate([
      { $match: { ...filter, timestamp: { $gte: startDate } } },
      {
        $addFields: {
          day: { $dateToString: { format: "%Y-%m-%d", date: "$timestamp" } }
        }
      },
      {
        $group: {
          _id: { day: "$day", action: "$action_type" },
          count: { $sum: 1 }
        }
      },
      { $sort: { "_id.day": 1 } }
    ]);

    const labels = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(startDate);
      d.setDate(startDate.getDate() + i);
      labels.push(d.toISOString().slice(0, 10));
    }

    const init = Object.fromEntries(labels.map(d => [d, 0]));
    const totalMap = { ...init };
    const importMap = { ...init };
    const updateMap = { ...init };

    trendAgg.forEach(r => {
      totalMap[r._id.day] += r.count || 0;
      if (r._id.action === "IMPORT_DELIVERIES") importMap[r._id.day] += r.count;
      if (r._id.action === "UPDATE_STATUS") updateMap[r._id.day] += r.count;
    });

    const actionsOverTime = {
      labels,
      total: labels.map(d => totalMap[d]),
      importDeliveries: labels.map(d => importMap[d]),
      updateStatus: labels.map(d => updateMap[d]),
    };


    // 2️⃣ Actions by Type (stable)
    // =====================
    const actionsByTypeAgg = await AuditLog.aggregate([
      { $match: filter },
      { $group: { _id: "$action_type", count: { $sum: 1 } } }
    ]);

    actionsByTypeAgg.sort((a, b) =>
      String(a._id).localeCompare(String(b._id))
    );

    const actionsByType = {
      labels: actionsByTypeAgg.map(x => x._id || "UNKNOWN"),
      counts: actionsByTypeAgg.map(x => x.count || 0),
    };


  // 3️⃣ Actions by Role (FIXED ORDER — does not jump)
  const rolesFixed = ["admin", "operations", "printer", "courier", "unknown"];
  const roleCountMap = Object.fromEntries(rolesFixed.map(r => [r, 0]));

  const roleAgg = await AuditLog.aggregate([
    { $match: filter },
    {
      $addFields: {
        userObjId: {
          $convert: { input: "$user_id", to: "objectId", onError: null, onNull: null }
        }
      }
    },
    { $lookup: { from: "users", localField: "userObjId", foreignField: "_id", as: "u" } },
    { $unwind: { path: "$u", preserveNullAndEmptyArrays: true } },
    {
      $group: {
        _id: { $ifNull: ["$u.role", "unknown"] },   // ✅ puts missing users into "unknown"
        count: { $sum: 1 }
      }
    }
  ]);

  // Fill stable map
  roleAgg.forEach(r => {
    const role = r._id || "unknown";
    if (roleCountMap[role] !== undefined) roleCountMap[role] = r.count || 0;
  });

// ✅ Now build stable labels + counts for chartData
const actionsByRole = {
  labels: rolesFixed,                      // ✅ stable order
  counts: rolesFixed.map(r => roleCountMap[r]),
};


    // 4️⃣ Top Users
    // =====================
    const topUsersAgg = await AuditLog.aggregate([
      { $match: filter },
      { $group: { _id: "$username", count: { $sum: 1 } } },
      { $sort: { count: -1, _id: 1 } }, // stable
      { $limit: 10 }
    ]);

const topUsers = {
  labels: topUsersAgg.map(x => x._id || "Unknown"),
  counts: topUsersAgg.map(x => x.count || 0),
};


    // 5️⃣ Login vs Failed
    // =====================
    const loginAgg = await AuditLog.aggregate([
      { $match: { ...filter, action_type: { $in: ["LOGIN", "FAILED_LOGIN"] } } },
      { $group: { _id: "$action_type", count: { $sum: 1 } } }
    ]);

    const loginMap = { LOGIN: 0, FAILED_LOGIN: 0 };
    loginAgg.forEach(r => {
      if (loginMap[r._id] !== undefined) loginMap[r._id] = r.count;
    });

    const loginVsFailed = {
      labels: ["LOGIN", "FAILED_LOGIN"],
      counts: [loginMap.LOGIN, loginMap.FAILED_LOGIN],
    };


    // 6️⃣ Status vs Exceptions
    const statusUpdateCount = await AuditLog.countDocuments({
    ...filter,
    action_type: "UPDATE_STATUS"
  });

  const failedDeliveriesCount = await CardDelivery.countDocuments({
    status: "Failed"
  });

  const statusVsExceptions = {
  labels: ["UPDATE_STATUS", "FAILED_DELIVERIES"],
  counts: [statusUpdateCount, failedDeliveriesCount],
  };

    const chartData = {
      actionsOverTime,
      actionsByType,
      actionsByRole,
      topUsers,
      loginVsFailed,
      statusVsExceptions,
};


    // =======================
    // AUDIT PAGE STAT CARDS
    // =======================
    const [totalUsers, facets] = await Promise.all([
      User.countDocuments({}),
      AuditLog.aggregate([
        { $match: filter },
        {
          $facet: {
            roleCounts: [
              {
                $addFields: {
                  userObjId: {
                    $convert: {
                      input: "$user_id",
                      to: "objectId",
                      onError: null,
                      onNull: null,
                    },
                  },
                },
              },
              {
                $lookup: {
                  from: "users",
                  localField: "userObjId",
                  foreignField: "_id",
                  as: "u",
                },
              },
              { $unwind: { path: "$u", preserveNullAndEmptyArrays: true } },
              { $group: { _id: "$u.role", count: { $sum: 1 } } },
            ],
            actionCounts: [
              { $group: { _id: "$action_type", count: { $sum: 1 } } }
            ],
            anchorCounts: [
              { $group: { _id: "$anchored", count: { $sum: 1 } } }
            ],
          },
        },
      ]),
    ]);

    const facet = facets?.[0] || { roleCounts: [], actionCounts: [], anchorCounts: [] };

    const roleMap = {};
    facet.roleCounts.forEach(r => { if (r?._id) roleMap[r._id] = r.count; });

    const actionMap = {};
    facet.actionCounts.forEach(a => { if (a?._id) actionMap[a._id] = a.count; });

    let anchoredCount = 0;
    let pendingCount = 0;
    facet.anchorCounts.forEach(a => {
      if (a._id === true) anchoredCount = a.count;
      if (a._id === false) pendingCount = a.count;
    });

    const stats = {
      totalUsers,
      adminActions: roleMap.admin || 0,
      operationsActions: roleMap.operations || 0,
      courierActions: roleMap.courier || 0,
      printerActions: roleMap.printer || 0,
      blockchainAnchored: anchoredCount,
      blockchainPending: pendingCount,
      updateStatus: actionMap.UPDATE_STATUS || 0,
      importDeliveries: actionMap.IMPORT_DELIVERIES || 0,
      roleUpdates: actionMap.ROLE_UPDATE || 0,
    };


    // dropdown lists (simple demo list; replace with your real action/entity list)
    const actionList = ["LOGIN","LOGOUT","UPDATE_STATUS","IMPORT_DELIVERIES","ROLE_UPDATE"];
    const entityList = ["User","Delivery","Batch","System"];

    return res.render("auditLog", {
      logs,
      page,
      totalPages,
      perPage,
      q,
      action,
      entity,
      batchId,
      anchored,
      from,
      to,
      actionList,
      entityList,
      stats,
      chartData,
    });
  } catch (err) {
    console.error("Error loading auditLog:", err);
    return res.render("auditLog", {
      logs: [],
      page: 1,
      totalPages: 1,
      perPage: 20,
      q: "",
      action: "",
      entity: "",
      batchId: "",
      anchored: "",
      from: "",
      to: "",
      actionList: [],
      entityList: [],
      stats: {
        totalUsers: 0,
        adminActions: 0,
        operationsActions: 0,
        courierActions: 0,
        printerActions: 0,
        blockchainAnchored: 0,
        blockchainPending: 0,
        updateStatus: 0,
        importDeliveries: 0,
        roleUpdates: 0,
      },
    });
  }
});

// -------------------- ROUTER MOUNTING --------------------

// Courier routes (courier only)
app.use("/courier", authMiddleware, requireRole(["courier"]), courierRouter);

// Auth (login, logout, signup actions, etc.)
app.use('/', authRouter);

// Contact (e.g. POST /contact)
app.use('/', contactRouter);
app.use('/contact', contactRouter);

// Operations routes (operations team only)
app.use("/operations", operationsRouter);

// Admin-only modules
app.use("/admin",authMiddleware, adminRouter);

// Deliveries routes (admin only)
app.use("/deliveries", authMiddleware, adminMiddleware, deliveryRouter);
app.use("/exceptions", authMiddleware, adminMiddleware, exceptionRouter);

// Printer routes (Idemia only)
app.use(
  "/printer",
  authMiddleware,
  requireRole("printer"),
  printerRouter
);

// Deliveries (admin only)
// Deliveries – Admin + Operations
app.use(
  '/deliveries',
  authMiddleware,
  requireRole(['admin', 'operations']),
  deliveryRouter
);
app.post('/wip', async (req, res) => {
  return res.status(403).render('wip', {
    message: "This feature is still under development."
  });
});

// Exceptions – Admin + Operations
app.use(
  '/exceptions',
  authMiddleware,
  requireRole(['admin', 'operations']),
  exceptionRouter
);


// Audit Log – Admin only
app.use(
  '/',
  authMiddleware,
  requireRole('admin'),
  auditRouter
);

// -------------------- ERROR HANDLING (LAST) --------------------
app.use(notFound);
app.use(errorHandler);
app.get("/test-error", (req, res) => {
  throw new Error("TEST: centralized error middleware works");
});


// -------------------- DATABASE & SERVER --------------------

mongoose
  .connect(MONGO_URI)
  .then(() => {
    console.log('Connected to MongoDB');
    app.listen(PORT, () => {
      console.log(`Server running at http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('MongoDB connection error:', err);
  });
