import express from 'express';
import cors from 'cors';
import env from './config';
import healthRoutes from './routes/health.routes';
import userRoutes from './routes/user.routes';
import equipmentRoutes from './routes/equipment.routes';
import { errorHandler } from './middlewares/errorHandler';

const app = express();

// CORS configuration for CLIENT_URL with credentials
app.use(
  cors({
    origin: env.CLIENT_URL,
    credentials: true,
  })
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/', healthRoutes);
app.use('/users', userRoutes);
app.use('/equipment', equipmentRoutes);

// Error handling middleware
app.use(errorHandler);

export default app;
