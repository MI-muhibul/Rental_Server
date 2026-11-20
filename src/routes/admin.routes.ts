import { Router } from 'express';
import {
  getAdminEquipment,
  updateAdminEquipmentStatus,
  updateAdminEquipment,
  deleteAdminEquipment,
} from '../controllers/admin.controller';
import { verifyToken, verifyAdmin } from '../middlewares/auth.middleware';

const router = Router();

// Protect all admin routes with verifyToken and verifyAdmin
router.use(verifyToken, verifyAdmin);

router.get('/equipment', getAdminEquipment);
router.patch('/equipment/:id/status', updateAdminEquipmentStatus);
router.patch('/equipment/:id', updateAdminEquipment);
router.delete('/equipment/:id', deleteAdminEquipment);

export default router;
