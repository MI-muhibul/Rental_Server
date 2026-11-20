import { Request, Response } from 'express';
import { ObjectId } from 'mongodb';
import env from '../config';
import * as dbConfig from '../config/db';
import { getStripeClient } from '../config/stripe';
import { calculateQuoteTotal } from '../utils/pricing';
import { Booking, Payment } from '../types/models';

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
 * POST /payments/checkout-session
 * Customer only: re-validates equipment availability for the specified dates,
 * calculates total price, generates Stripe Checkout Session with booking metadata,
 * and returns the session URL.
 */
export const createCheckoutSession = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized: Authentication required' });
      return;
    }

    const { equipmentId, startDate, endDate, quantity } = req.body;

    // 1. Validate inputs
    if (!equipmentId || typeof equipmentId !== 'string' || !equipmentId.trim()) {
      res.status(400).json({ error: 'Valid equipmentId is required' });
      return;
    }
    if (!startDate || !endDate) {
      res.status(400).json({ error: 'startDate and endDate are required' });
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

    const reqQty = quantity !== undefined ? Number(quantity) : 1;
    if (isNaN(reqQty) || !Number.isInteger(reqQty) || reqQty < 1) {
      res.status(400).json({ error: 'quantity must be an integer >= 1' });
      return;
    }

    const trimmedEquipmentId = equipmentId.trim();
    const { equipment, bookings } = await dbConfig.getCollections();

    // 2. Fetch equipment
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

    // 3. Re-validate availability (sum overlapping paid bookings)
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
        { status: { $nin: ['cancelled', 'rejected'] } },
      ],
    };

    const overlappingBookings = await bookings.find(overlappingFilter).toArray();
    const bookedQuantity = overlappingBookings.reduce((sum, b) => {
      const q = typeof b.quantity === 'number' && b.quantity > 0 ? b.quantity : 1;
      return sum + q;
    }, 0);

    const availableQuantity = Math.max(0, totalQuantity - bookedQuantity);
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

    // 4. Compute quote
    const quote = calculateQuoteTotal(
      targetEquipment.price,
      reqStart,
      reqEnd,
      targetEquipment.rentalType,
      reqQty
    );

    const userIdStr = req.user._id?.toString() || req.user.id || '';

    // 5. Create Stripe Checkout Session
    const stripe = getStripeClient();
    const unitPriceCents = Math.round((quote.total / reqQty) * 100);

    const metadata: Record<string, string> = {
      equipmentId: eqIdStr,
      equipmentName: targetEquipment.name,
      userId: userIdStr,
      userEmail: req.user.email || '',
      userName: req.user.name || '',
      startDate: reqStart.toISOString(),
      endDate: reqEnd.toISOString(),
      quantity: String(reqQty),
      days: String(quote.days),
      duration: String(quote.duration),
      rentalType: targetEquipment.rentalType,
      totalPrice: String(quote.total),
    };

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: req.user.email,
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: `${targetEquipment.name} (${quote.duration} ${quote.unit})`,
              description: `Rental from ${reqStart.toISOString().split('T')[0]} to ${reqEnd.toISOString().split('T')[0]}`,
              images: targetEquipment.image ? [targetEquipment.image] : undefined,
            },
            unit_amount: unitPriceCents,
          },
          quantity: reqQty,
        },
      ],
      metadata,
      success_url: `${env.CLIENT_URL}/payments/confirm?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${env.CLIENT_URL}/equipment/${eqIdStr}`,
    });

    res.status(200).json({
      url: session.url,
      sessionId: session.id,
      total: quote.total,
    });
  } catch (error: any) {
    console.error('Error in createCheckoutSession:', error);
    res.status(500).json({ error: 'Internal Server Error', message: error?.message });
  }
};

/**
 * GET /payments/confirm?session_id=
 * Retrieves the Stripe Checkout session.
 * If paid and not already processed, creates the booking (paymentStatus: "paid",
 * status: "confirmed") and a payments record (transactionId, amount, currency, date).
 * Ensures full idempotency.
 */
export const confirmPayment = async (req: Request, res: Response): Promise<void> => {
  try {
    const sessionId = (req.query.session_id || req.query.sessionId) as string;

    if (!sessionId || typeof sessionId !== 'string' || !sessionId.trim()) {
      res.status(400).json({ error: 'session_id query parameter is required' });
      return;
    }

    const trimmedSessionId = sessionId.trim();
    const stripe = getStripeClient();

    // 1. Retrieve the session from Stripe
    const session = await stripe.checkout.sessions.retrieve(trimmedSessionId);
    if (!session) {
      res.status(404).json({ error: 'Stripe checkout session not found' });
      return;
    }

    // 2. Verify payment status is paid
    if (session.payment_status !== 'paid') {
      res.status(400).json({
        error: 'Payment has not been completed',
        paymentStatus: session.payment_status,
      });
      return;
    }

    const transactionId = (session.payment_intent as string) || session.id;
    const { bookings, payments } = await dbConfig.getCollections();

    // 3. IDEMPOTENCY CHECK:
    // If this payment session or transaction was already processed, return existing records
    const existingPayment = await payments.findOne({
      $or: [
        { transactionId: transactionId },
        { stripeSessionId: trimmedSessionId },
      ],
    });

    if (existingPayment) {
      const existingBooking = await bookings.findOne({
        $or: [
          { _id: existingPayment.bookingId as any },
          { stripeSessionId: trimmedSessionId },
          { transactionId: transactionId },
        ],
      });

      res.status(200).json({
        success: true,
        message: 'Payment already processed',
        alreadyProcessed: true,
        booking: existingBooking,
        payment: existingPayment,
      });
      return;
    }

    // 4. Extract booking metadata from Stripe session
    const metadata = session.metadata || {};
    const equipmentId = metadata.equipmentId;
    const userId = metadata.userId;

    if (!equipmentId || !userId) {
      res.status(400).json({
        error: 'Session metadata is missing equipmentId or userId',
      });
      return;
    }

    const startDate = metadata.startDate ? new Date(metadata.startDate) : new Date();
    const endDate = metadata.endDate ? new Date(metadata.endDate) : new Date();
    const quantity = parseInt(metadata.quantity, 10) || 1;
    const totalPrice =
      parseFloat(metadata.totalPrice) ||
      (session.amount_total ? session.amount_total / 100 : 0);

    const now = new Date();

    const eqIdObj =
      ObjectId.isValid(equipmentId) && equipmentId.length === 24
        ? new ObjectId(equipmentId)
        : equipmentId;
    const userIdObj =
      ObjectId.isValid(userId) && userId.length === 24 ? new ObjectId(userId) : userId;

    // 5. Insert Booking record: status "confirmed", paymentStatus "paid"
    const newBooking: Booking = {
      equipmentId: eqIdObj,
      userId: userIdObj,
      startDate,
      endDate,
      quantity,
      totalPrice,
      total: totalPrice,
      rentalType: (metadata.rentalType as any) || 'daily',
      duration: parseInt(metadata.duration, 10) || 1,
      status: 'confirmed', // bookingStatus "confirmed"
      paymentStatus: 'paid', // paymentStatus "paid"
      stripeSessionId: trimmedSessionId,
      transactionId,
      createdAt: now,
      updatedAt: now,
    };

    const bookingResult = await bookings.insertOne(newBooking as any);
    const bookingId = bookingResult.insertedId;

    // 6. Insert Payments record: (transactionId, amount, currency, date)
    const amount = session.amount_total ? session.amount_total / 100 : totalPrice;
    const currency = (session.currency || 'usd').toUpperCase();

    const newPayment: Payment = {
      transactionId,
      bookingId,
      userId: userIdObj,
      amount,
      currency,
      date: now,
      stripeSessionId: trimmedSessionId,
      stripePaymentIntentId:
        typeof session.payment_intent === 'string' ? session.payment_intent : undefined,
      status: 'paid',
      createdAt: now,
    };

    const paymentResult = await payments.insertOne(newPayment as any);

    res.status(200).json({
      success: true,
      message: 'Payment confirmed and booking created successfully',
      alreadyProcessed: false,
      booking: {
        ...newBooking,
        _id: bookingId,
      },
      payment: {
        ...newPayment,
        _id: paymentResult.insertedId,
      },
    });
  } catch (error: any) {
    console.error('Error in confirmPayment:', error);
    res.status(500).json({ error: 'Internal Server Error', message: error?.message });
  }
};
