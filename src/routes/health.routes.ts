import { Router } from 'express';
import { getHealth } from '../controllers/health.controller';
import { processCompletedBookings } from '../services/cron.service';

const router = Router();

// GET / and GET /health
router.get('/', getHealth);
router.get('/health', getHealth);

// GET /cron/daily - Cron trigger endpoint for Vercel Cron or external schedulers
router.get('/cron/daily', async (req, res) => {
  try {
    const result = await processCompletedBookings();
    res.status(200).json({
      success: true,
      message: 'Daily booking completion cron executed successfully',
      result,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: 'Error executing daily cron',
      error: error.message || error,
    });
  }
});

export default router;
