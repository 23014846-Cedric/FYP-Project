// app.js
require('dotenv').config();

const express       = require('express');
const mongoose      = require('mongoose');
const cookieParser  = require('cookie-parser');
const path          = require('path');
const jwt           = require('jsonwebtoken');

// Models
const CardDelivery  = require('./models/CardDelivery');
const ErrorLog = require('./models/ErrorLog');

// Routers
const contactRouter   = require('./routes/contactRouter');
const auditRouter     = require('./routes/auditRouter');
const authRouter      = require('./routes/authRouter');
const deliveryRouter  = require('./routes/deliveryRouter');
const exceptionRouter = require('./routes/exceptionRouter');
const operationsRouter = require("./routes/operationsRouter");

// Middleware
const authMiddleware = require('./middleware/authMiddleware');
const { requireAuth, requireRole } = require('./middleware/authMiddleware');

const app  = express();
const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGODB_URI;

// -------------------- CORE MIDDLEWARE --------------------

const { maskCard, maskAddress } = require('./utils/mask');

// Make helpers available in ALL EJS views
app.use((req, res, next) => {
  res.locals.maskCard = maskCard;
  res.locals.maskAddress = maskAddress;
  next();
});

// Parse form data & JSON
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Cookies
app.use(cookieParser());

// Static assets
app.use(express.static(path.join(__dirname, 'public')));

// Global error-handling middleware – MUST be after all routes
app.use(async (err, req, res, next) => {
  try {
    // Basic info
    const statusCode = err.status || err.statusCode || 500;

    await ErrorLog.create({
      message: err.message || 'Unknown error',
      stack: err.stack,
      statusCode,
      route: req.originalUrl,
      method: req.method,
      userId: req.user?.id || req.user?._id || null,
      userEmail: req.user?.email || null,
      userRole: req.user?.role || null,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
    });
  } catch (logErr) {
    console.error('Failed to log error:', logErr);
  }

  // For end-users: show friendly error page (no stack leak)
  res.status(500);
  res.render('500', {
    message: 'Something went wrong on our side. Our team has been notified.',
  });
});

// View engine (EJS)
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

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
  if (req.user && req.user.role === 'admin' || req.user.role === 'operations') {
    return next();
  }
  // you can change this to res.redirect('/dashboard') if you prefer
  return res.status(403).send('Access denied. Admins only.');
}


// -------------------- PAGE ROUTES --------------------

// Public pages
app.get('/',        (req, res) => res.redirect('/login'));
app.get('/login',   (req, res) => res.render('login',   { errors: [] }));
app.get('/signup',  (req, res) => res.render('signup',  { errors: [], formData: {} }));
app.get('/about',   (req, res) => res.render('about',   { errors: [], formData: {} }));
app.get('/contact', (req, res) => res.render('contact', { errors: [], formData: {} }));
app.get('/profile', authMiddleware, (req, res) => res.render('profile'));
app.get('/errorDiagnostics', authMiddleware, (req, res) => {
  if (!req.user || req.user.role !== 'operations') {
    return res.status(403).render('403', {
      message: 'You do not have permission to access this page.'
    });
  }

  // TODO: pull error logs / structured errors here later
  res.render('errorDiagnostics');
});

// Protected dashboard (any logged-in user)
// Protected dashboard
app.get('/dashboard', authMiddleware, async (req, res) => {
  try {
    let deliveries;

    // If admin -> see everything
    if (req.user && (req.user.role === 'admin' || req.user.role === 'operations')) {
      deliveries = await CardDelivery.find().lean();
    } else {
      // Normal user -> only see their own deliveries
      // Assumes CardDelivery.recipient_name matches req.user.name (e.g. "Mr Ling")
      deliveries = await CardDelivery.find({
        recipient_name: req.user.name
      }).lean();
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

// Operations routes (operations team only)
app.use("/operations", operationsRouter);

// Admin-only modules

// Deliveries (admin only)
app.use('/deliveries', authMiddleware, adminMiddleware, deliveryRouter);

// Exceptions (admin only)
app.use('/exceptions', authMiddleware, adminMiddleware, exceptionRouter);


// Compliance ONLY access to audit logs
app.use(
  '/auditLog',
  authMiddleware,
  (req, res, next) => {
    if (req.user && req.user.role === 'compliance') {
      return next();
    }
    return res.status(403).send('Access denied. Compliance only.');
  },
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
