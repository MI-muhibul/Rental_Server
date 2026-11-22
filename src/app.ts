import express from 'express';
import cors from 'cors';
import env from './config';
import healthRoutes from './routes/health.routes';
import userRoutes from './routes/user.routes';
import equipmentRoutes from './routes/equipment.routes';
import adminRoutes from './routes/admin.routes';
import favoriteRoutes from './routes/favorite.routes';
import bookingRoutes from './routes/booking.routes';
import paymentRoutes from './routes/payment.routes';
import analyticsRoutes from './routes/analytics.routes';
import { errorHandler } from './middlewares/errorHandler';

const app = express();

/**
 * Normalizes and parses allowed origins from CLIENT_URL environment variable.
 * Supports single URLs, comma-separated lists, and wildcard Vercel preview domains.
 */
const parseAllowedOrigins = (clientUrlEnv?: string): string[] => {
  if (!clientUrlEnv) return ['http://localhost:3000'];
  return clientUrlEnv
    .split(',')
    .map((url) => url.trim().replace(/\/$/, ''))
    .filter(Boolean);
};

const isOriginAllowed = (origin: string | undefined, allowedOrigins: string[]): boolean => {
  // Allow server-to-server, mobile, postman, and curl requests with no origin header
  if (!origin) return true;

  const cleanOrigin = origin.replace(/\/$/, '');

  if (allowedOrigins.includes('*')) return true;
  if (allowedOrigins.includes(cleanOrigin)) return true;

  // Always allow deployed Vercel domains (production and preview branches)
  if (cleanOrigin.endsWith('.vercel.app')) return true;

  // Always allow local development origins
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(cleanOrigin)) return true;

  // Support wildcard matching in configured origins
  for (const allowed of allowedOrigins) {
    if (allowed.includes('*')) {
      const regex = new RegExp('^' + allowed.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$');
      if (regex.test(cleanOrigin)) return true;
    }
  }

  return false;
};

// CORS configuration supporting deployed client origin, credentials, and preflight
app.use(
  cors({
    origin: (origin, callback) => {
      const allowedOrigins = parseAllowedOrigins(env.CLIENT_URL);
      if (isOriginAllowed(origin, allowedOrigins)) {
        callback(null, true);
      } else {
        callback(
          new Error(`CORS error: Origin ${origin} not allowed by Access-Control-Allow-Origin`)
        );
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
    exposedHeaders: ['Content-Range', 'X-Content-Range'],
    optionsSuccessStatus: 200,
  })
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/', healthRoutes);
app.use('/users', userRoutes);
app.use('/equipment', equipmentRoutes);
app.use('/admin', adminRoutes);
app.use('/favorites', favoriteRoutes);
app.use('/bookings', bookingRoutes);
app.use('/payments', paymentRoutes);
app.use('/analytics', analyticsRoutes);

// 404 handler for unmatched routes (returns clean JSON with CORS headers)
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Cannot ${req.method} ${req.originalUrl}`,
  });
});

// Error handling middleware
app.use(errorHandler);

export default app;
