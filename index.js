const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

// Load environment variables
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Security Middleware
app.use(helmet());

// CORS Configuration - Production Security
const allowedOrigins = [
  'https://nisayapimarket.com',
  'https://www.nisayapimarket.com',
  'http://localhost:3002',      // Web admin dev
  'http://127.0.0.1:3002',
  'tauri://localhost',           // Tauri desktop app
  'http://tauri.localhost'
];

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps, Postman, curl)
    if (!origin) return callback(null, true);

    // Development mode - allow localhost
    if (process.env.NODE_ENV === 'development') {
      return callback(null, true);
    }

    // Production mode - check whitelist
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.warn(`CORS blocked: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin']
}));

// Handle preflight requests explicitly
app.options('*', cors());

app.use(express.json({ limit: '10mb' })); // Support larger payloads for sync

// Rate Limiting (Basic DDoS protection)
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.'
});
app.use(limiter);

// Database Connection Pool
const mysql = require('mysql2/promise');

// Create the connection pool. The pool-specific settings are the defaults
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  maxIdle: 10, // max idle connections, the default value is the same as `connectionLimit`
  idleTimeout: 60000, // idle connections timeout, in milliseconds, the default value 60000
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0
});

// Test DB Connection
pool.getConnection()
  .then(conn => {
    console.log("Successfully connected to MySQL Database!");
    conn.release();
  })
  .catch(err => {
    console.error("Database connection failed:", err);
  });

// Middleware to make DB pool available in routes
app.use((req, res, next) => {
  req.db = pool;
  next();
});

// Basic Route
app.get('/', (req, res) => {
  res.json({ message: 'Nexus Inventory API is running secure and fast' });
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Routes (Will be imported later)
app.use('/api/auth', require('./routes/auth'));
app.use('/api/dealers', require('./routes/dealers'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/license', require('./routes/license'));
app.use('/api/sync', require('./routes/sync'));
app.use('/api/cloud', require('./routes/sync'));
app.use('/api/inventory', require('./routes/inventory'));

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
