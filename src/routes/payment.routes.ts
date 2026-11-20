import { Router } from 'express';
import {
  createCheckoutSession,
  confirmPayment,
} from '../controllers/payment.controller';
import { verifyToken, verifyRenter } from '../middlewares/auth.middleware';

const router = Router();

// Customer only: create checkout session
router.post('/checkout-session', verifyToken, verifyRenter, createCheckoutSession);

// Payment confirmation (session_id callback)
router.get('/confirm', confirmPayment);

export default router;
