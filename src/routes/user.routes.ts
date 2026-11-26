import { Router } from 'express';
import {
  upsertUser,
  getMe,
  updateMe,
  getAllUsers,
  updateUserRole,
  deleteUser,
} from '../controllers/user.controller';
import { verifyToken, verifyJwtOnly, verifyAdmin } from '../middlewares/auth.middleware';

const router = Router();

// Authenticated sync callback: Upsert user on register or Google login
router.post('/', verifyJwtOnly, upsertUser);

// Current user profile routes (must be declared before /:id)
router.get('/me', verifyToken, getMe);
router.patch('/me', verifyToken, updateMe);

// Admin only routes
router.get('/', verifyToken, verifyAdmin, getAllUsers);
router.patch('/:id/role', verifyToken, verifyAdmin, updateUserRole);
router.delete('/:id', verifyToken, verifyAdmin, deleteUser);

export default router;
