import { Request, Response } from 'express';
import { ObjectId } from 'mongodb';
import * as dbConfig from '../config/db';
import { Equipment, RentalType } from '../types/models';

const ALLOWED_RENTAL_TYPES: RentalType[] = ['daily', 'weekly', 'monthly'];

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
 * Validates equipment payload fields.
 * Required fields: name, description, category, location, price, rentalType, quantity, condition, brand, model, image, terms.
 */
export const validateEquipmentInput = (
  body: any,
  isUpdate = false
): { isValid: boolean; error?: string } => {
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
  } = body;

  const errors: string[] = [];

  // 1. name
  if (!isUpdate || name !== undefined) {
    if (!name || typeof name !== 'string' || !name.trim()) {
      errors.push('name is required and must be a non-empty string');
    }
  }

  // 2. description
  if (!isUpdate || description !== undefined) {
    if (!description || typeof description !== 'string' || !description.trim()) {
      errors.push('description is required and must be a non-empty string');
    }
  }

  // 3. category
  if (!isUpdate || category !== undefined) {
    if (!category || typeof category !== 'string' || !category.trim()) {
      errors.push('category is required and must be a non-empty string');
    }
  }

  // 4. location
  if (!isUpdate || location !== undefined) {
    if (!location || typeof location !== 'string' || !location.trim()) {
      errors.push('location is required and must be a non-empty string');
    }
  }

  // 5. price
  if (!isUpdate || price !== undefined) {
    const numPrice = Number(price);
    if (price === undefined || price === null || isNaN(numPrice) || numPrice <= 0) {
      errors.push('price is required and must be a positive number');
    }
  }

  // 6. rentalType (daily, weekly, monthly)
  if (!isUpdate || rentalType !== undefined) {
    const normalizedRentalType =
      typeof rentalType === 'string' ? (rentalType.toLowerCase().trim() as RentalType) : '';
    if (!normalizedRentalType || !ALLOWED_RENTAL_TYPES.includes(normalizedRentalType)) {
      errors.push(
        `rentalType is required and must be one of: ${ALLOWED_RENTAL_TYPES.join(', ')}`
      );
    }
  }

  // 7. quantity
  if (!isUpdate || quantity !== undefined) {
    const numQuantity = Number(quantity);
    if (
      quantity === undefined ||
      quantity === null ||
      isNaN(numQuantity) ||
      !Number.isInteger(numQuantity) ||
      numQuantity < 1
    ) {
      errors.push('quantity is required and must be an integer >= 1');
    }
  }

  // 8. condition
  if (!isUpdate || condition !== undefined) {
    if (!condition || typeof condition !== 'string' || !condition.trim()) {
      errors.push('condition is required and must be a non-empty string');
    }
  }

  // 9. brand
  if (!isUpdate || brand !== undefined) {
    if (!brand || typeof brand !== 'string' || !brand.trim()) {
      errors.push('brand is required and must be a non-empty string');
    }
  }

  // 10. model
  if (!isUpdate || model !== undefined) {
    if (!model || typeof model !== 'string' || !model.trim()) {
      errors.push('model is required and must be a non-empty string');
    }
  }

  // 11. image
  const primaryImage = image || (Array.isArray(images) && images[0]);
  if (!isUpdate || image !== undefined || images !== undefined) {
    if (!primaryImage || typeof primaryImage !== 'string' || !primaryImage.trim()) {
      errors.push('image is required and must be a valid non-empty string/URL');
    }
  }

  // 12. terms
  if (!isUpdate || terms !== undefined) {
    if (!terms || typeof terms !== 'string' || !terms.trim()) {
      errors.push('terms is required and must be a non-empty string');
    }
  }

  if (errors.length > 0) {
    return { isValid: false, error: errors.join('; ') };
  }

  return { isValid: true };
};

/**
 * Helper to verify that the logged-in user is the equipment's owner.
 */
const checkIsOwner = (item: Equipment, user: any): boolean => {
  if (!user) return false;
  const userId = user._id?.toString() || user.id?.toString() || '';
  const itemOwnerId = item.ownerId?.toString() || item.owner?.id?.toString() || '';
  const itemOwnerEmail = item.owner?.email?.toLowerCase() || '';
  const userEmail = user.email?.toLowerCase() || '';

  return (
    (userId !== '' && itemOwnerId !== '' && userId === itemOwnerId) ||
    (userEmail !== '' && itemOwnerEmail !== '' && userEmail === itemOwnerEmail)
  );
};

/**
 * POST /equipment
 * Owner only: create new equipment item.
 * Status is forced to "pending", owner info is derived from the JWT user token.
 */
export const createEquipment = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized: User authentication required' });
      return;
    }

    const validation = validateEquipmentInput(req.body, false);
    if (!validation.isValid) {
      res.status(400).json({ error: validation.error });
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
    } = req.body;

    const { equipment } = await dbConfig.getCollections();
    const now = new Date();

    const ownerIdStr = req.user._id?.toString() || req.user.id || '';
    const ownerObjectId =
      ObjectId.isValid(ownerIdStr) && ownerIdStr.length === 24
        ? new ObjectId(ownerIdStr)
        : ownerIdStr;

    const primaryImage = (image || (Array.isArray(images) ? images[0] : '')).trim();
    const imageList = Array.isArray(images) && images.length > 0 ? images : [primaryImage];

    // Status is FORCED to "pending"
    const newEquipment: Equipment = {
      name: name.trim(),
      description: description.trim(),
      category: category.trim(),
      location: location.trim(),
      price: Number(price),
      pricePerDay: Number(price),
      rentalType: rentalType.toLowerCase().trim() as RentalType,
      quantity: Number(quantity),
      condition: condition.trim(),
      brand: brand.trim(),
      model: model.trim(),
      image: primaryImage,
      images: imageList,
      terms: terms.trim(),
      status: 'pending', // forced to "pending"
      ownerId: ownerObjectId,
      owner: {
        id: ownerIdStr,
        name: req.user.name,
        email: req.user.email,
      },
      createdAt: now,
      updatedAt: now,
    };

    const insertResult = await equipment.insertOne(newEquipment as any);
    const createdItem = {
      ...newEquipment,
      _id: insertResult.insertedId,
    };

    res.status(201).json({
      message: 'Equipment created successfully',
      equipment: createdItem,
    });
  } catch (error: any) {
    console.error('Error in createEquipment:', error);
    res.status(500).json({ error: 'Internal Server Error', message: error?.message });
  }
};

/**
 * GET /equipment/mine
 * Owner only: retrieve all equipment listings belonging to the authenticated owner.
 */
export const getMyEquipment = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized: User authentication required' });
      return;
    }

    const { equipment } = await dbConfig.getCollections();
    const userId = req.user._id?.toString() || req.user.id || '';

    const orClauses: any[] = [
      { ownerId: userId },
      { 'owner.id': userId },
      { 'owner.email': req.user.email },
    ];

    if (ObjectId.isValid(userId) && userId.length === 24) {
      orClauses.push({ ownerId: new ObjectId(userId) });
    }

    const items = await equipment
      .find({ $or: orClauses })
      .sort({ createdAt: -1 })
      .toArray();

    res.status(200).json({
      equipment: items,
      total: items.length,
    });
  } catch (error: any) {
    console.error('Error in getMyEquipment:', error);
    res.status(500).json({ error: 'Internal Server Error', message: error?.message });
  }
};

/**
 * PATCH /equipment/:id
 * Owner only: update equipment details (only allowed if the requester is the item's owner).
 */
export const updateEquipment = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized: User authentication required' });
      return;
    }

    const id = (Array.isArray(req.params.id) ? req.params.id[0] : req.params.id) as string;
    if (!id) {
      res.status(400).json({ error: 'Equipment ID is required' });
      return;
    }

    const validation = validateEquipmentInput(req.body, true);
    if (!validation.isValid) {
      res.status(400).json({ error: validation.error });
      return;
    }

    const { equipment } = await dbConfig.getCollections();
    const existing = await equipment.findOne(getEquipmentFilter(id));

    if (!existing) {
      res.status(404).json({ error: 'Equipment not found' });
      return;
    }

    // Only the item's owner can modify it
    if (!checkIsOwner(existing, req.user)) {
      res.status(403).json({
        error: 'Forbidden: You can only edit your own equipment',
      });
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
    } = req.body;

    const updateFields: Partial<Equipment> = {
      updatedAt: new Date(),
    };

    if (name !== undefined) updateFields.name = name.trim();
    if (description !== undefined) updateFields.description = description.trim();
    if (category !== undefined) updateFields.category = category.trim();
    if (location !== undefined) updateFields.location = location.trim();
    if (price !== undefined) {
      updateFields.price = Number(price);
      updateFields.pricePerDay = Number(price);
    }
    if (rentalType !== undefined) {
      updateFields.rentalType = rentalType.toLowerCase().trim() as RentalType;
    }
    if (quantity !== undefined) updateFields.quantity = Number(quantity);
    if (condition !== undefined) updateFields.condition = condition.trim();
    if (brand !== undefined) updateFields.brand = brand.trim();
    if (model !== undefined) updateFields.model = model.trim();
    if (image !== undefined) updateFields.image = image.trim();
    if (images !== undefined) updateFields.images = Array.isArray(images) ? images : [images];
    if (terms !== undefined) updateFields.terms = terms.trim();

    const updated = await equipment.findOneAndUpdate(
      getEquipmentFilter(id),
      { $set: updateFields },
      { returnDocument: 'after' }
    );

    res.status(200).json({
      message: 'Equipment updated successfully',
      equipment: updated,
    });
  } catch (error: any) {
    console.error('Error in updateEquipment:', error);
    res.status(500).json({ error: 'Internal Server Error', message: error?.message });
  }
};

/**
 * DELETE /equipment/:id
 * Owner only: delete equipment (only allowed if the requester is the item's owner).
 */
export const deleteEquipment = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized: User authentication required' });
      return;
    }

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

    // Only the item's owner can delete it
    if (!checkIsOwner(existing, req.user)) {
      res.status(403).json({
        error: 'Forbidden: You can only delete your own equipment',
      });
      return;
    }

    const result = await equipment.deleteOne(getEquipmentFilter(id));

    if (result.deletedCount === 0) {
      res.status(404).json({ error: 'Equipment not found' });
      return;
    }

    res.status(200).json({
      message: 'Equipment deleted successfully',
      deletedId: id,
    });
  } catch (error: any) {
    console.error('Error in deleteEquipment:', error);
    res.status(500).json({ error: 'Internal Server Error', message: error?.message });
  }
};

/**
 * GET /equipment
 * Public: returns approved items only.
 * Supports:
 * - Server-side search by name or location (query: ?search=... or ?q=...)
 * - Filters for:
 *   - category: ?category=...
 *   - rentalType: ?rentalType=... (daily, weekly, monthly)
 *   - min/max price: ?minPrice=... & ?maxPrice=...
 *   - availability: ?availability=true / false or "available" / "rented"
 * - Sorting: ?sort=price_asc | price_desc | newest (default: newest)
 * - Pagination: ?page=1 & ?limit=10
 * Returns { items, total, totalPages }
 */
export const getApprovedEquipment = async (req: Request, res: Response): Promise<void> => {
  try {
    const { equipment } = await dbConfig.getCollections();
    const {
      search,
      q,
      category,
      rentalType,
      minPrice,
      maxPrice,
      availability,
      sort,
      page,
      limit,
    } = req.query;

    // Base query: ONLY approved / available items
    const query: any = {
      status: { $in: ['approved', 'available'] },
    };

    // 1. Search by name or location
    const searchTerm = (search || q) as string | undefined;
    if (searchTerm && typeof searchTerm === 'string' && searchTerm.trim()) {
      const trimmedSearch = searchTerm.trim();
      query.$or = [
        { name: { $regex: trimmedSearch, $options: 'i' } },
        { location: { $regex: trimmedSearch, $options: 'i' } },
      ];
    }

    // 2. Filter by category
    if (category && typeof category === 'string' && category.trim()) {
      query.category = { $regex: `^${category.trim()}$`, $options: 'i' };
    }

    // 3. Filter by rentalType
    if (rentalType && typeof rentalType === 'string' && rentalType.trim()) {
      query.rentalType = rentalType.toLowerCase().trim();
    }

    // 4. Min/Max price filter
    if (minPrice !== undefined || maxPrice !== undefined) {
      query.price = {};
      if (minPrice !== undefined && !isNaN(Number(minPrice))) {
        query.price.$gte = Number(minPrice);
      }
      if (maxPrice !== undefined && !isNaN(Number(maxPrice))) {
        query.price.$lte = Number(maxPrice);
      }
    }

    // 5. Availability filter
    if (availability !== undefined) {
      const availStr = String(availability).toLowerCase().trim();
      if (availStr === 'true' || availStr === 'available') {
        query.$and = query.$and || [];
        query.$and.push({
          $or: [
            { status: 'available' },
            { quantity: { $gt: 0 } },
          ],
        });
      } else if (availStr === 'false' || availStr === 'rented' || availStr === 'unavailable') {
        query.$and = query.$and || [];
        query.$and.push({
          $or: [
            { status: 'rented' },
            { status: 'maintenance' },
            { quantity: { $lte: 0 } },
          ],
        });
      }
    }

    // 6. Sorting
    let sortOptions: any = { createdAt: -1 }; // default newest
    if (sort === 'price_asc') {
      sortOptions = { price: 1 };
    } else if (sort === 'price_desc') {
      sortOptions = { price: -1 };
    } else if (sort === 'newest') {
      sortOptions = { createdAt: -1 };
    }

    // 7. Pagination
    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const limitNum = Math.max(1, Math.min(100, parseInt(limit as string, 10) || 10));
    const skip = (pageNum - 1) * limitNum;

    const [items, total] = await Promise.all([
      equipment.find(query).sort(sortOptions).skip(skip).limit(limitNum).toArray(),
      equipment.countDocuments(query),
    ]);

    const totalPages = Math.ceil(total / limitNum) || 1;

    res.status(200).json({
      items,
      total,
      totalPages,
      page: pageNum,
      limit: limitNum,
    });
  } catch (error: any) {
    console.error('Error in getApprovedEquipment:', error);
    res.status(500).json({ error: 'Internal Server Error', message: error?.message });
  }
};

/**
 * GET /equipment/featured
 * Public: retrieves 6 approved items using limit.
 */
export const getFeaturedEquipment = async (req: Request, res: Response): Promise<void> => {
  try {
    const { equipment } = await dbConfig.getCollections();

    const items = await equipment
      .find({ status: { $in: ['approved', 'available'] } })
      .sort({ createdAt: -1 })
      .limit(6)
      .toArray();

    res.status(200).json({
      items,
      total: items.length,
    });
  } catch (error: any) {
    console.error('Error in getFeaturedEquipment:', error);
    res.status(500).json({ error: 'Internal Server Error', message: error?.message });
  }
};

/**
 * GET /equipment/:id
 * Public: retrieves single equipment by ID.
 */
export const getEquipmentById = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = (Array.isArray(req.params.id) ? req.params.id[0] : req.params.id) as string;
    if (!id) {
      res.status(400).json({ error: 'Equipment ID is required' });
      return;
    }

    const { equipment } = await dbConfig.getCollections();
    const item = await equipment.findOne(getEquipmentFilter(id));

    if (!item) {
      res.status(404).json({ error: 'Equipment not found' });
      return;
    }

    res.status(200).json({
      equipment: item,
      item,
    });
  } catch (error: any) {
    console.error('Error in getEquipmentById:', error);
    res.status(500).json({ error: 'Internal Server Error', message: error?.message });
  }
};
