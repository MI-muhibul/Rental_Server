import { Router } from 'express';
import {
  addFavorite,
  getFavorites,
  removeFavorite,
} from '../controllers/favorite.controller';
import { verifyToken, verifyRenter } from '../middlewares/auth.middleware';

const router = Router();

// Protect all customer favorite routes with verifyToken and verifyRenter
router.use(verifyToken, verifyRenter);

router.post('/', addFavorite);
router.get('/', getFavorites);
router.delete('/:equipmentId', removeFavorite);

export default router;
