import { Request, Response } from 'express';
import { ObjectId } from 'mongodb';
import * as dbConfig from '../config/db';
import { calculateQuoteTotal, calculateDuration, computeRentalTotal } from '../utils/pricing';

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
