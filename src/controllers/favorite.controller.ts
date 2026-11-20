import { Request, Response } from 'express';
import { ObjectId } from 'mongodb';
import * as dbConfig from '../config/db';
import { Favorite, Equipment } from '../types/models';

const getEquipmentFilter = (id: string) => {
  if (ObjectId.isValid(id) && id.length === 24) {
    return {
      $or: [{ _id: new ObjectId(id) }, { _id: id as any }, { id: id as any }],
    };
  }
  return {
    $or: [{ _id: id as any }, { id: id as any }],
  };
};

/**
 * POST /favorites
 * Customer only: add an equipment item to favorites.
 * Enforces no duplicates per user and equipment.
 */
export const addFavorite = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized: Authentication required' });
      return;
    }

    const { equipmentId } = req.body;
    if (!equipmentId || typeof equipmentId !== 'string' || !equipmentId.trim()) {
      res.status(400).json({ error: 'Valid equipmentId is required' });
      return;
    }

    const trimmedEquipmentId = equipmentId.trim();
    const { equipment, favorites } = await dbConfig.getCollections();

    // Verify equipment exists
    const targetEquipment = await equipment.findOne(getEquipmentFilter(trimmedEquipmentId));
    if (!targetEquipment) {
      res.status(404).json({ error: 'Equipment not found' });
      return;
    }

    const userId = req.user._id?.toString() || req.user.id || '';
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized: User identifier missing' });
      return;
    }

    // Check for existing favorite (no duplicates per user and equipment)
    const existing = await favorites.findOne({
      $and: [
        {
          $or: [
            { userId: userId },
            ...(ObjectId.isValid(userId) && userId.length === 24
              ? [{ userId: new ObjectId(userId) }]
              : []),
          ],
        },
        {
          $or: [
            { equipmentId: trimmedEquipmentId },
            ...(ObjectId.isValid(trimmedEquipmentId) && trimmedEquipmentId.length === 24
              ? [{ equipmentId: new ObjectId(trimmedEquipmentId) }]
              : []),
          ],
        },
      ],
    });

    if (existing) {
      res.status(409).json({
        error: 'Equipment is already in your favorites',
      });
      return;
    }

    const now = new Date();
    const storedEquipmentId =
      targetEquipment._id?.toString() ||
      targetEquipment.id ||
      trimmedEquipmentId;

    const newFavorite: Favorite = {
      userId:
        ObjectId.isValid(userId) && userId.length === 24 ? new ObjectId(userId) : userId,
      equipmentId:
        ObjectId.isValid(storedEquipmentId) && storedEquipmentId.length === 24
          ? new ObjectId(storedEquipmentId)
          : storedEquipmentId,
      createdAt: now,
    };

    const insertResult = await favorites.insertOne(newFavorite as any);

    res.status(201).json({
      message: 'Equipment added to favorites successfully',
      favorite: {
        ...newFavorite,
        _id: insertResult.insertedId,
        equipment: targetEquipment,
      },
    });
  } catch (error: any) {
    // Catch unique index violation (MongoDB code 11000)
    if (error?.code === 11000) {
      res.status(409).json({ error: 'Equipment is already in your favorites' });
      return;
    }
    console.error('Error in addFavorite:', error);
    res.status(500).json({ error: 'Internal Server Error', message: error?.message });
  }
};

/**
 * GET /favorites
 * Customer only: retrieve user favorites populated with full equipment details.
 */
export const getFavorites = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized: Authentication required' });
      return;
    }

    const userId = req.user._id?.toString() || req.user.id || '';
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized: User identifier missing' });
      return;
    }

    const { favorites, equipment } = await dbConfig.getCollections();

    const userFavorites = await favorites
      .find({
        $or: [
          { userId: userId },
          ...(ObjectId.isValid(userId) && userId.length === 24
            ? [{ userId: new ObjectId(userId) }]
            : []),
        ],
      })
      .sort({ createdAt: -1 })
      .toArray();

    // Populate equipment details for each favorite item
    const populated = await Promise.all(
      userFavorites.map(async (fav) => {
        const eqId = fav.equipmentId?.toString();
        let eqDetails: Equipment | null = null;
        if (eqId) {
          eqDetails = await equipment.findOne(getEquipmentFilter(eqId));
        }
        return {
          ...fav,
          equipment: eqDetails,
        };
      })
    );

    res.status(200).json({
      favorites: populated,
      items: populated,
      total: populated.length,
    });
  } catch (error: any) {
    console.error('Error in getFavorites:', error);
    res.status(500).json({ error: 'Internal Server Error', message: error?.message });
  }
};

/**
 * DELETE /favorites/:equipmentId
 * Customer only: remove an equipment item from favorites.
 */
export const removeFavorite = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized: Authentication required' });
      return;
    }

    const equipmentId = (
      Array.isArray(req.params.equipmentId) ? req.params.equipmentId[0] : req.params.equipmentId
    ) as string;

    if (!equipmentId || !equipmentId.trim()) {
      res.status(400).json({ error: 'Equipment ID is required' });
      return;
    }

    const trimmedEquipmentId = equipmentId.trim();
    const userId = req.user._id?.toString() || req.user.id || '';
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized: User identifier missing' });
      return;
    }

    const { favorites } = await dbConfig.getCollections();

    const filter: any = {
      $and: [
        {
          $or: [
            { userId: userId },
            ...(ObjectId.isValid(userId) && userId.length === 24
              ? [{ userId: new ObjectId(userId) }]
              : []),
          ],
        },
        {
          $or: [
            { equipmentId: trimmedEquipmentId },
            ...(ObjectId.isValid(trimmedEquipmentId) && trimmedEquipmentId.length === 24
              ? [{ equipmentId: new ObjectId(trimmedEquipmentId) }]
              : []),
            { _id: trimmedEquipmentId as any },
            ...(ObjectId.isValid(trimmedEquipmentId) && trimmedEquipmentId.length === 24
              ? [{ _id: new ObjectId(trimmedEquipmentId) }]
              : []),
          ],
        },
      ],
    };

    const deleteResult = await favorites.deleteOne(filter);

    if (deleteResult.deletedCount === 0) {
      res.status(404).json({ error: 'Favorite not found' });
      return;
    }

    res.status(200).json({
      message: 'Favorite removed successfully',
      equipmentId: trimmedEquipmentId,
    });
  } catch (error: any) {
    console.error('Error in removeFavorite:', error);
    res.status(500).json({ error: 'Internal Server Error', message: error?.message });
  }
};
