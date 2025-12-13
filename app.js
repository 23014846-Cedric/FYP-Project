// app.js
require('dotenv').config();

const express       = require('express');
const mongoose      = require('mongoose');
const cookieParser  = require('cookie-parser');
const path          = require('path');
const jwt           = require('jsonwebtoken');

// Utils
const { maskCard, maskAddress } = require('./utils/mask');

// Models
const CardDelivery  = require('./models/CardDelivery');

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

// Middleware
const authMiddleware = require('./middleware/authMiddleware');
const requireRole = require('./middleware/requireRole');
const revealMiddleware = require("./middleware/revealMiddleware");

const app  = express();
const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGODB_URI;

// -------------------- CORE MIDDLEWARE --------------------

// Parse form data & JSON
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Cookies
app.use(cookieParser());

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

// Mount reveal router
app.use(revealRouter);

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

// Simple admin-only middleware
function adminMiddleware(req, res, next) {
  if (req.user && (req.user.role === 'admin' || req.user.role === 'operations')) {
    return next();
  }
  return res.status(403).send('Access denied. Admins / Operations only.');
}


// -------------------- PAGE ROUTES --------------------

// Public pages
app.get('/',        (req, res) => res.redirect('/login'));
app.get('/login',   (req, res) => res.render('login',   { errors: [] }));
app.get('/signup',  (req, res) => res.render('signup',  { errors: [], formData: {} }));
app.get('/about',   (req, res) => res.render('about',   { errors: [], formData: {} }));
app.get('/profile', authMiddleware, (req, res) => res.render('profile'));


app.get('/errorDiagnostics', authMiddleware, async (req, res) => {
  if (!req.user || req.user.role !== 'operations') {
    return res.status(403).render('403', {
      message: 'You do not have permission to access this page.'
    });
  }

  try {
    const logs = await ErrorLog.find()
      .sort({ createdAt: -1 })   // or timestamp, see note below
      .lean();

    res.render('errorDiagnostics', { logs });
  } catch (err) {
    console.error('Error loading error diagnostics:', err);
    res.render('errorDiagnostics', { logs: [] });
  }
});


// Protected dashboard (any logged-in user)
// Protected dashboard
app.get('/dashboard', authMiddleware, async (req, res) => {
  try {
    let deliveries;

  // Admin, Operations, Printer all see ALL deliveries
  if (req.user && ['admin', 'operations', 'printer'].includes(req.user.role)) {
    deliveries = await CardDelivery.find().lean();
  } else {
    return res.status(403).send('Access denied');
  }

    const stats = {
      total: deliveries.length,
      delivered: deliveries.filter(d => d.status === 'Delivered').length,
      inTransit: deliveries.filter(d => d.status === 'Shipped').length,
      exceptions: deliveries.filter(
        d => d.status === 'Failed' || d.status === 'Delayed'
      ).length,
    };

    res.render('dashboard', {
      user: req.user,
      deliveries,
      stats,
    });
  } catch (err) {
    console.error('Error loading dashboard:', err);
    res.render('dashboard', {
      user: req.user,
      deliveries: [],
      stats: { total: 0, delivered: 0, inTransit: 0, exceptions: 0 },
    });
  }
});


// -------------------- ROUTER MOUNTING --------------------

// Auth (login, logout, signup actions, etc.)
app.use('/', authRouter);

// Contact (e.g. POST /contact)
app.use('/', contactRouter);
app.use('/contact', contactRouter);

// Operations routes (operations team only)
app.use("/operations", operationsRouter);

// Admin-only modules
app.use("/admin", adminRouter);

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
