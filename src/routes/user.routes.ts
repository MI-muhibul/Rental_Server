import { Router } from 'express';
import {
  upsertUser,
  getMe,
  updateMe,
  getAllUsers,
  updateUserRole,
  deleteUser,
} from '../controllers/user.controller';
import { verifyToken, verifyAdmin } from '../middlewares/auth.middleware';

const router = Router();

// Public / Auth callback: Upsert user on register or Google login
router.post('/', upsertUser);

// Current user profile routes (must be declared before /:id)
router.get('/me', verifyToken, getMe);
router.patch('/me', verifyToken, updateMe);

// Admin only routes
router.get('/', verifyToken, verifyAdmin, getAllUsers);
router.patch('/:id/role', verifyToken, verifyAdmin, updateUserRole);
router.delete('/:id', verifyToken, verifyAdmin, deleteUser);

export default router;
