import { Router } from 'express';
import { getBookingQuote } from '../controllers/booking.controller';

const router = Router();

// Public / Quote endpoint: check availability and calculate price quote
router.post('/quote', getBookingQuote);

export default router;
