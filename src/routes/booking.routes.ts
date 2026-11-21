import { Router } from 'express';
import {
  getBookingQuote,
  getMyBookings,
  getOwnerBookings,
} from '../controllers/booking.controller';
import { verifyToken, verifyRenter, verifyOwner } from '../middlewares/auth.middleware';

const router = Router();

// Public / Quote endpoint: check availability and calculate price quote
router.post('/quote', getBookingQuote);

// Customer bookings (with page and limit)
router.get('/mine', verifyToken, verifyRenter, getMyBookings);

// Owner bookings (bookings on owner's equipment with customer info)
router.get('/owner', verifyToken, verifyOwner, getOwnerBookings);

export default router;
