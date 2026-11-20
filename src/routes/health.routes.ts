import { Router } from 'express';
import { getHealth } from '../controllers/health.controller';

const router = Router();

// GET / health route
router.get('/', getHealth);

export default router;
