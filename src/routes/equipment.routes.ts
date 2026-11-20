import { Router } from 'express';
import {
  getApprovedEquipment,
  getFeaturedEquipment,
  getEquipmentById,
  createEquipment,
  getMyEquipment,
  updateEquipment,
  deleteEquipment,
} from '../controllers/equipment.controller';
import { verifyToken, verifyOwner } from '../middlewares/auth.middleware';

const router = Router();

// Public equipment endpoints
// Note: /featured and /mine must come before /:id to avoid collision
router.get('/', getApprovedEquipment);
router.get('/featured', getFeaturedEquipment);
router.get('/mine', verifyToken, verifyOwner, getMyEquipment);
router.get('/:id', getEquipmentById);

// Owner equipment endpoints
router.post('/', verifyToken, verifyOwner, createEquipment);
router.patch('/:id', verifyToken, verifyOwner, updateEquipment);
router.delete('/:id', verifyToken, verifyOwner, deleteEquipment);

export default router;
