import { Request, Response } from 'express';
import { ObjectId } from 'mongodb';
import * as dbConfig from '../config/db';
import { Equipment, EquipmentStatus } from '../types/models';

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

const ALLOWED_ADMIN_STATUSES: EquipmentStatus[] = ['approved', 'rejected'];

/**
 * GET /admin/equipment
 * Admin only: retrieves all equipment listings across all statuses.
 * Supports pagination, search, status filtering, category filtering, and sorting.
 */
export const getAdminEquipment = async (req: Request, res: Response): Promise<void> => {
  try {
    const { equipment } = await dbConfig.getCollections();
    const { status, search, category, sort, page, limit } = req.query;

    const query: any = {};

    // 1. Status filter (if provided, otherwise returns ALL statuses: pending, approved, rejected, maintenance, etc.)
    if (status && typeof status === 'string' && status.trim()) {
      query.status = status.toLowerCase().trim();
    }

    // 2. Search by name, location, or owner info
    if (search && typeof search === 'string' && search.trim()) {
      const trimmedSearch = search.trim();
      query.$or = [
        { name: { $regex: trimmedSearch, $options: 'i' } },
        { location: { $regex: trimmedSearch, $options: 'i' } },
        { 'owner.name': { $regex: trimmedSearch, $options: 'i' } },
        { 'owner.email': { $regex: trimmedSearch, $options: 'i' } },
      ];
    }

    // 3. Category filter
    if (category && typeof category === 'string' && category.trim()) {
      query.category = { $regex: `^${category.trim()}$`, $options: 'i' };
    }

    // 4. Sorting
    let sortOptions: any = { createdAt: -1 };
    if (sort === 'price_asc') {
      sortOptions = { price: 1 };
    } else if (sort === 'price_desc') {
      sortOptions = { price: -1 };
    } else if (sort === 'oldest') {
      sortOptions = { createdAt: 1 };
    }

    // 5. Pagination
    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const limitNum = Math.max(1, Math.min(100, parseInt(limit as string, 10) || 50));
    const skip = (pageNum - 1) * limitNum;

    const [items, total] = await Promise.all([
      equipment.find(query).sort(sortOptions).skip(skip).limit(limitNum).toArray(),
      equipment.countDocuments(query),
    ]);

    const totalPages = Math.ceil(total / limitNum) || 1;

    res.status(200).json({
      items,
      equipment: items,
      total,
      totalPages,
      page: pageNum,
      limit: limitNum,
    });
  } catch (error: any) {
    console.error('Error in getAdminEquipment:', error);
    res.status(500).json({ error: 'Internal Server Error', message: error?.message });
  }
};

/**
 * PATCH /admin/equipment/:id/status
 * Admin only: update equipment status to "approved" or "rejected".
 */
export const updateAdminEquipmentStatus = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const id = (Array.isArray(req.params.id) ? req.params.id[0] : req.params.id) as string;
    const { status, rejectionReason } = req.body;

    if (!id) {
      res.status(400).json({ error: 'Equipment ID is required' });
      return;
    }

    if (!status || typeof status !== 'string') {
      res.status(400).json({
        error: "Status is required and must be either 'approved' or 'rejected'",
      });
      return;
    }

    const normalizedStatus = status.toLowerCase().trim() as EquipmentStatus;
    if (!ALLOWED_ADMIN_STATUSES.includes(normalizedStatus)) {
      res.status(400).json({
        error: `Invalid status "${status}". Allowed status values are: ${ALLOWED_ADMIN_STATUSES.join(', ')}`,
      });
      return;
    }

    const { equipment } = await dbConfig.getCollections();
    const existing = await equipment.findOne(getEquipmentFilter(id));

    if (!existing) {
      res.status(404).json({ error: 'Equipment not found' });
      return;
    }

    const updateFields: any = {
      status: normalizedStatus,
      updatedAt: new Date(),
    };

    if (normalizedStatus === 'rejected' && rejectionReason) {
      updateFields.rejectionReason = String(rejectionReason).trim();
    }

    const updated = await equipment.findOneAndUpdate(
      getEquipmentFilter(id),
      { $set: updateFields },
      { returnDocument: 'after' }
    );

    res.status(200).json({
      message: `Equipment status updated to ${normalizedStatus} successfully`,
      equipment: updated,
    });
  } catch (error: any) {
    console.error('Error in updateAdminEquipmentStatus:', error);
    res.status(500).json({ error: 'Internal Server Error', message: error?.message });
  }
};

/**
 * PATCH /admin/equipment/:id
 * Admin only: update any equipment fields as an administrator.
 */
export const updateAdminEquipment = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = (Array.isArray(req.params.id) ? req.params.id[0] : req.params.id) as string;
    if (!id) {
      res.status(400).json({ error: 'Equipment ID is required' });
      return;
    }

    const { equipment } = await dbConfig.getCollections();
    const existing = await equipment.findOne(getEquipmentFilter(id));

    if (!existing) {
      res.status(404).json({ error: 'Equipment not found' });
      return;
    }

    const {
      name,
      description,
      category,
      location,
      price,
      rentalType,
      quantity,
      condition,
      brand,
      model,
      image,
      images,
      terms,
      status,
    } = req.body;

    const updateFields: Partial<Equipment> = {
      updatedAt: new Date(),
    };

    if (name !== undefined) updateFields.name = String(name).trim();
    if (description !== undefined) updateFields.description = String(description).trim();
    if (category !== undefined) updateFields.category = String(category).trim();
    if (location !== undefined) updateFields.location = String(location).trim();
    if (price !== undefined) {
      const numPrice = Number(price);
      if (isNaN(numPrice) || numPrice <= 0) {
        res.status(400).json({ error: 'Price must be a positive number' });
        return;
      }
      updateFields.price = numPrice;
      updateFields.pricePerDay = numPrice;
    }
    if (rentalType !== undefined) {
      const normalizedRentalType = String(rentalType).toLowerCase().trim() as any;
      if (!['daily', 'weekly', 'monthly'].includes(normalizedRentalType)) {
        res.status(400).json({ error: "rentalType must be 'daily', 'weekly', or 'monthly'" });
        return;
      }
      updateFields.rentalType = normalizedRentalType;
    }
    if (quantity !== undefined) {
      const numQty = Number(quantity);
      if (isNaN(numQty) || !Number.isInteger(numQty) || numQty < 0) {
        res.status(400).json({ error: 'Quantity must be an integer >= 0' });
        return;
      }
      updateFields.quantity = numQty;
    }
    if (condition !== undefined) updateFields.condition = String(condition).trim();
    if (brand !== undefined) updateFields.brand = String(brand).trim();
    if (model !== undefined) updateFields.model = String(model).trim();
    if (image !== undefined) updateFields.image = String(image).trim();
    if (images !== undefined) updateFields.images = Array.isArray(images) ? images : [images];
    if (terms !== undefined) updateFields.terms = String(terms).trim();
    if (status !== undefined) {
      const normalizedStatus = String(status).toLowerCase().trim() as EquipmentStatus;
      updateFields.status = normalizedStatus;
    }

    const updated = await equipment.findOneAndUpdate(
      getEquipmentFilter(id),
      { $set: updateFields },
      { returnDocument: 'after' }
    );

    res.status(200).json({
      message: 'Equipment updated successfully by admin',
      equipment: updated,
    });
  } catch (error: any) {
    console.error('Error in updateAdminEquipment:', error);
    res.status(500).json({ error: 'Internal Server Error', message: error?.message });
  }
};

/**
 * DELETE /admin/equipment/:id
 * Admin only: delete any equipment item.
 */
export const deleteAdminEquipment = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = (Array.isArray(req.params.id) ? req.params.id[0] : req.params.id) as string;
    if (!id) {
      res.status(400).json({ error: 'Equipment ID is required' });
      return;
    }

    const { equipment } = await dbConfig.getCollections();
    const existing = await equipment.findOne(getEquipmentFilter(id));

    if (!existing) {
      res.status(404).json({ error: 'Equipment not found' });
      return;
    }

    const result = await equipment.deleteOne(getEquipmentFilter(id));

    if (result.deletedCount === 0) {
      res.status(404).json({ error: 'Equipment not found' });
      return;
    }

    res.status(200).json({
      message: 'Equipment deleted successfully by admin',
      deletedId: id,
    });
  } catch (error: any) {
    console.error('Error in deleteAdminEquipment:', error);
    res.status(500).json({ error: 'Internal Server Error', message: error?.message });
  }
};
