import { Router } from 'express';
import {
  getAdminAnalytics,
  getOwnerAnalytics,
} from '../controllers/analytics.controller';
import {
  verifyToken,
  verifyAdmin,
  verifyOwner,
} from '../middlewares/auth.middleware';

const router = Router();

// GET /analytics/admin - Protected with verifyToken and verifyAdmin
router.get('/admin', verifyToken, verifyAdmin, getAdminAnalytics);

// GET /analytics/owner - Protected with verifyToken and verifyOwner
router.get('/owner', verifyToken, verifyOwner, getOwnerAnalytics);

export default router;
