import { Request, Response } from 'express';
import { ObjectId } from 'mongodb';
import * as dbConfig from '../config/db';
import { calculateQuoteTotal, calculateDuration, computeRentalTotal } from '../utils/pricing';
import { Booking, Equipment, User } from '../types/models';

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

const getUserFilter = (id: string) => {
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
 * POST /bookings/quote
 * Checks equipment availability for the specified date range by summing
 * the quantities of all overlapping paid bookings against the equipment's quantity.
 * Returns the calculated quote (total = price × duration × quantity) or an error.
 */
export const getBookingQuote = async (req: Request, res: Response): Promise<void> => {
  try {
    const { equipmentId, startDate, endDate, quantity } = req.body;

    // 1. Validate equipmentId
    if (!equipmentId || typeof equipmentId !== 'string' || !equipmentId.trim()) {
      res.status(400).json({ error: 'Valid equipmentId is required' });
      return;
    }

    const trimmedEquipmentId = equipmentId.trim();

    // 2. Validate dates
    if (!startDate || !endDate) {
      res.status(400).json({ error: 'Both startDate and endDate are required' });
      return;
    }

    const reqStart = new Date(startDate);
    const reqEnd = new Date(endDate);

    if (isNaN(reqStart.getTime()) || isNaN(reqEnd.getTime())) {
      res.status(400).json({ error: 'Invalid startDate or endDate format' });
      return;
    }

    if (reqEnd.getTime() < reqStart.getTime()) {
      res.status(400).json({ error: 'endDate cannot be earlier than startDate' });
      return;
    }

    // 3. Validate quantity
    const reqQty = quantity !== undefined ? Number(quantity) : 1;
    if (isNaN(reqQty) || !Number.isInteger(reqQty) || reqQty < 1) {
      res.status(400).json({ error: 'quantity must be a positive integer (>= 1)' });
      return;
    }

    const { equipment, bookings } = await dbConfig.getCollections();

    // 4. Fetch equipment
    const targetEquipment = await equipment.findOne(getEquipmentFilter(trimmedEquipmentId));
    if (!targetEquipment) {
      res.status(404).json({ error: 'Equipment not found' });
      return;
    }

    if (
      targetEquipment.status === 'maintenance' ||
      targetEquipment.status === 'rejected' ||
      targetEquipment.status === 'rented'
    ) {
      res.status(400).json({
        available: false,
        error: `Equipment is currently not available for rental (status: ${targetEquipment.status})`,
      });
      return;
    }

    const totalQuantity =
      typeof targetEquipment.quantity === 'number' ? targetEquipment.quantity : 1;

    // 5. Query overlapping paid bookings
    // Two periods [A_start, A_end] and [B_start, B_end] overlap when:
    // A_start <= B_end AND A_end >= B_start
    const eqIdStr = targetEquipment._id?.toString() || targetEquipment.id || trimmedEquipmentId;
    const eqIdClauses: any[] = [{ equipmentId: eqIdStr }, { equipmentId: trimmedEquipmentId }];
    if (ObjectId.isValid(eqIdStr) && eqIdStr.length === 24) {
      eqIdClauses.push({ equipmentId: new ObjectId(eqIdStr) });
    }
    if (ObjectId.isValid(trimmedEquipmentId) && trimmedEquipmentId.length === 24) {
      eqIdClauses.push({ equipmentId: new ObjectId(trimmedEquipmentId) });
    }

    const overlappingFilter = {
      $and: [
        { $or: eqIdClauses },
        { startDate: { $lte: reqEnd } },
        { endDate: { $gte: reqStart } },
        {
          $or: [
            { status: { $in: ['confirmed', 'paid', 'completed'] } },
            { paymentStatus: 'paid' },
          ],
        },
        {
          status: { $nin: ['cancelled', 'rejected'] },
        },
      ],
    };

    const overlappingBookings = await bookings.find(overlappingFilter).toArray();

    // Sum quantities of overlapping paid bookings
    const bookedQuantity = overlappingBookings.reduce((sum, b) => {
      const qty = typeof b.quantity === 'number' && b.quantity > 0 ? b.quantity : 1;
      return sum + qty;
    }, 0);

    const availableQuantity = Math.max(0, totalQuantity - bookedQuantity);

    // 6. Check availability against equipment's quantity
    if (reqQty > availableQuantity) {
      res.status(400).json({
        available: false,
        error: `Requested quantity (${reqQty}) exceeds available inventory (${availableQuantity}) for the selected dates`,
        requestedQuantity: reqQty,
        availableQuantity,
        totalQuantity,
        bookedQuantity,
      });
      return;
    }

    // 7. Calculate quote: total = price × duration × quantity
    const quote = calculateQuoteTotal(
      targetEquipment.price,
      reqStart,
      reqEnd,
      targetEquipment.rentalType,
      reqQty
    );

    res.status(200).json({
      available: true,
      equipmentId: eqIdStr,
      equipmentName: targetEquipment.name,
      rentalType: targetEquipment.rentalType,
      price: targetEquipment.price,
      startDate: reqStart.toISOString(),
      endDate: reqEnd.toISOString(),
      days: quote.days,
      duration: quote.duration,
      unit: quote.unit,
      quantity: reqQty,
      total: quote.total,
      availableQuantity,
      totalQuantity,
      bookedQuantity,
    });
  } catch (error: any) {
    console.error('Error in getBookingQuote:', error);
    res.status(500).json({ error: 'Internal Server Error', message: error?.message });
  }
};

/**
 * GET /bookings/mine
 * Customer only: retrieves all bookings placed by the authenticated customer.
 * Supports page and limit pagination. Includes equipment name and equipment details.
 */
export const getMyBookings = async (req: Request, res: Response): Promise<void> => {
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

    const { page, limit } = req.query;
    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const limitNum = Math.max(1, Math.min(100, parseInt(limit as string, 10) || 10));
    const skip = (pageNum - 1) * limitNum;

    const { bookings, equipment } = await dbConfig.getCollections();

    const userClauses: any[] = [{ userId }];
    if (ObjectId.isValid(userId) && userId.length === 24) {
      userClauses.push({ userId: new ObjectId(userId) });
    }

    const query = { $or: userClauses };

    const [rawBookings, total] = await Promise.all([
      bookings.find(query).sort({ createdAt: -1 }).skip(skip).limit(limitNum).toArray(),
      bookings.countDocuments(query),
    ]);

    // Populate equipment details including equipmentName
    const enrichedBookings = await Promise.all(
      rawBookings.map(async (b) => {
        const eqId = b.equipmentId?.toString();
        let eqItem: Equipment | null = null;
        if (eqId) {
          eqItem = await equipment.findOne(getEquipmentFilter(eqId));
        }
        return {
          ...b,
          equipmentName: eqItem?.name || b.equipmentName || 'Equipment',
          equipment: eqItem || null,
        };
      })
    );

    const totalPages = Math.ceil(total / limitNum) || 1;

    res.status(200).json({
      bookings: enrichedBookings,
      items: enrichedBookings,
      total,
      totalPages,
      page: pageNum,
      limit: limitNum,
    });
  } catch (error: any) {
    console.error('Error in getMyBookings:', error);
    res.status(500).json({ error: 'Internal Server Error', message: error?.message });
  }
};

/**
 * GET /bookings/owner
 * Owner only: retrieves all bookings placed on the owner's equipment.
 * Includes equipment names and customer info (name, email, phone, etc.).
 */
export const getOwnerBookings = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized: Authentication required' });
      return;
    }

    const ownerId = req.user._id?.toString() || req.user.id || '';
    if (!ownerId) {
      res.status(401).json({ error: 'Unauthorized: Owner identifier missing' });
      return;
    }

    const { page, limit } = req.query;
    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const limitNum = Math.max(1, Math.min(100, parseInt(limit as string, 10) || 10));
    const skip = (pageNum - 1) * limitNum;

    const { equipment, bookings, users } = await dbConfig.getCollections();

    // 1. Find all equipment owned by this user
    const ownerClauses: any[] = [
      { ownerId },
      { 'owner.id': ownerId },
      { 'owner.email': req.user.email },
    ];
    if (ObjectId.isValid(ownerId) && ownerId.length === 24) {
      ownerClauses.push({ ownerId: new ObjectId(ownerId) });
    }

    const ownedEquipment = await equipment.find({ $or: ownerClauses }).toArray();

    if (ownedEquipment.length === 0) {
      res.status(200).json({
        bookings: [],
        items: [],
        total: 0,
        totalPages: 1,
        page: pageNum,
        limit: limitNum,
      });
      return;
    }

    // 2. Query bookings matching the owner's equipment IDs
    const eqIds = ownedEquipment.map((e) => e._id?.toString() || e.id);
    const bookingClauses: any[] = [
      { equipmentId: { $in: eqIds } },
      ...eqIds
        .filter((id) => ObjectId.isValid(id) && id.length === 24)
        .map((id) => ({ equipmentId: new ObjectId(id) })),
    ];

    const bookingQuery = { $or: bookingClauses };

    const [rawBookings, total] = await Promise.all([
      bookings.find(bookingQuery).sort({ createdAt: -1 }).skip(skip).limit(limitNum).toArray(),
      bookings.countDocuments(bookingQuery),
    ]);

    // Create lookup map for owned equipment
    const equipmentMap = new Map<string, Equipment>();
    for (const eq of ownedEquipment) {
      if (eq._id) equipmentMap.set(eq._id.toString(), eq);
      if (eq.id) equipmentMap.set(eq.id, eq);
    }

    // 3. Populate customer info and equipment name
    const enrichedBookings = await Promise.all(
      rawBookings.map(async (b) => {
        const eqId = b.equipmentId?.toString() || '';
        const eq = equipmentMap.get(eqId) || (await equipment.findOne(getEquipmentFilter(eqId)));

        const custId = b.userId?.toString() || '';
        let customer: User | null = null;
        if (custId) {
          customer = await users.findOne(getUserFilter(custId));
        }

        return {
          ...b,
          equipmentName: eq?.name || b.equipmentName || 'Equipment',
          equipment: eq || null,
          customer: customer
            ? {
                id: customer._id?.toString() || customer.id,
                name: customer.name,
                email: customer.email,
                phone: customer.phone,
                photo: customer.photo || customer.avatar,
                address: customer.address,
              }
            : null,
          customerName: customer?.name || 'Customer',
          customerEmail: customer?.email || '',
        };
      })
    );

    const totalPages = Math.ceil(total / limitNum) || 1;

    res.status(200).json({
      bookings: enrichedBookings,
      items: enrichedBookings,
      total,
      totalPages,
      page: pageNum,
      limit: limitNum,
    });
  } catch (error: any) {
    console.error('Error in getOwnerBookings:', error);
    res.status(500).json({ error: 'Internal Server Error', message: error?.message });
  }
};

/**
 * GET /admin/bookings
 * Admin only: retrieves all bookings in the system.
 * Includes equipment names, owner info, and customer info.
 */
export const getAdminBookings = async (req: Request, res: Response): Promise<void> => {
  try {
    const { status, page, limit } = req.query;
    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const limitNum = Math.max(1, Math.min(100, parseInt(limit as string, 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    const query: any = {};
    if (status && typeof status === 'string' && status.trim()) {
      query.status = status.toLowerCase().trim();
    }

    const { bookings, equipment, users } = await dbConfig.getCollections();

    const [rawBookings, total] = await Promise.all([
      bookings.find(query).sort({ createdAt: -1 }).skip(skip).limit(limitNum).toArray(),
      bookings.countDocuments(query),
    ]);

    // Populate equipment names, owner info, and customer info
    const enrichedBookings = await Promise.all(
      rawBookings.map(async (b) => {
        const eqId = b.equipmentId?.toString() || '';
        let eq: Equipment | null = null;
        if (eqId) {
          eq = await equipment.findOne(getEquipmentFilter(eqId));
        }

        const custId = b.userId?.toString() || '';
        let customer: User | null = null;
        if (custId) {
          customer = await users.findOne(getUserFilter(custId));
        }

        // Owner info from equipment or lookup
        let owner = eq?.owner || null;
        if (!owner && eq?.ownerId) {
          const ownerUser = await users.findOne(getUserFilter(eq.ownerId.toString()));
          if (ownerUser) {
            owner = {
              id: ownerUser._id?.toString() || ownerUser.id || '',
              name: ownerUser.name,
              email: ownerUser.email,
            };
          }
        }

        return {
          ...b,
          equipmentName: eq?.name || b.equipmentName || 'Equipment',
          equipment: eq || null,
          owner: owner || null,
          ownerName: owner?.name || '',
          ownerEmail: owner?.email || '',
          customer: customer
            ? {
                id: customer._id?.toString() || customer.id,
                name: customer.name,
                email: customer.email,
                phone: customer.phone,
                photo: customer.photo || customer.avatar,
              }
            : null,
          customerName: customer?.name || 'Customer',
          customerEmail: customer?.email || '',
        };
      })
    );

    const totalPages = Math.ceil(total / limitNum) || 1;

    res.status(200).json({
      bookings: enrichedBookings,
      items: enrichedBookings,
      total,
      totalPages,
      page: pageNum,
      limit: limitNum,
    });
  } catch (error: any) {
    console.error('Error in getAdminBookings:', error);
    res.status(500).json({ error: 'Internal Server Error', message: error?.message });
  }
};
