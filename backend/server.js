require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const http = require('http');
const { Server } = require('socket.io');

// Import routes
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/user');
const walletRoutes = require('./routes/wallet');
const adminRoutes = require('./routes/admin');
const gameRoutes = require('./routes/games');
const rouletteRoutes = require('./routes/roulette');
const minesRoutes = require('./routes/mines');

const app = express();
const server = http.createServer(app);

// Socket.io setup
const allowedOrigins = [
  'http://localhost:3000',
  process.env.CLIENT_URL,
  /\.vercel\.app$/  // Allow all Vercel preview URLs
].filter(Boolean);

const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST'],
    credentials: true
  }
});

// Make io accessible to routes
app.set('io', io);

// CORS Middleware - MUST be before helmet
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (mobile apps, curl, etc)
    if (!origin) return callback(null, true);

    // Allow all vercel.app domains
    if (origin.endsWith('.vercel.app')) {
      return callback(null, true);
    }

    // Allow localhost
    if (origin.includes('localhost')) {
      return callback(null, true);
    }

    // Check explicit CLIENT_URL
    if (process.env.CLIENT_URL && origin === process.env.CLIENT_URL) {
      return callback(null, true);
    }

    console.log('CORS allowing origin:', origin);
    callback(null, true); // Allow all for now
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
};

// Apply CORS first
app.use(cors(corsOptions));

// Then helmet with relaxed settings
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));

app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Supabase connection verification
const { supabase } = require('./config/supabase');
console.log('🔗 Supabase client initialized');

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/games', gameRoutes);
app.use('/api/games/roulette', rouletteRoutes);
app.use('/api/games/mines', minesRoutes);

// Test route
app.get('/api/test', (req, res) => {
  res.json({ message: 'Backend initialized with Supabase' });
});

// Health check
app.get('/api/health', async (req, res) => {
  try {
    // Quick Supabase check
    const { data, error } = await supabase.from('users').select('id').limit(1);
    res.json({
      status: 'ok',
      message: 'StakeX API is running with Supabase',
      database: error ? 'error' : 'connected'
    });
  } catch (err) {
    res.json({
      status: 'ok',
      message: 'StakeX API is running',
      database: 'unknown'
    });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    success: false,
    message: 'Something went wrong!',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// Socket.io connection handling
require('./socket/poker')(io);
require('./socket/coinflip')(io);

const PORT = process.env.PORT || 5000;
const HOST = '0.0.0.0';

server.listen(PORT, HOST, () => {
  console.log(`🚀 StakeX server running on http://${HOST}:${PORT}`);
  console.log(`📡 Socket.io ready for connections`);
  console.log(`🗄️  Using Supabase for database`);
});

module.exports = { app, io };
