import { Request, Response } from 'express';
import { ObjectId } from 'mongodb';
import * as dbConfig from '../config/db';

/**
 * Generates an array of the last 12 calendar month buckets up to the current month.
 */
export const generate12MonthBuckets = () => {
  const buckets: {
    key: string;
    year: number;
    month: number;
    label: string;
  }[] = [];

  const now = new Date();
  const monthNames = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];

  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const year = d.getFullYear();
    const month = d.getMonth() + 1; // 1-12
    const key = `${year}-${String(month).padStart(2, '0')}`;
    const label = `${monthNames[month - 1]} ${year}`;
    buckets.push({ key, year, month, label });
  }

  return buckets;
};

/**
 * GET /analytics/admin
 * Admin only: retrieves platform-wide summary metrics:
 * - total users
 * - total equipment
 * - total bookings
 * - pending approvals (equipment status: "pending")
 * - completed rentals (booking status: "completed")
 * - total revenue from payments
 * - monthly booking counts for 12 months using aggregation
 */
export const getAdminAnalytics = async (req: Request, res: Response): Promise<void> => {
  try {
    const { users, equipment, bookings, payments } = await dbConfig.getCollections();

    const now = new Date();
    const twelveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 11, 1);

    // 1. Run count & revenue queries in parallel
    const [
      totalUsers,
      totalEquipment,
      totalBookings,
      pendingApprovals,
      completedRentals,
      revenueAgg,
      monthlyBookingsAgg,
    ] = await Promise.all([
      users.countDocuments({}),
      equipment.countDocuments({}),
      bookings.countDocuments({}),
      equipment.countDocuments({ status: 'pending' }),
      bookings.countDocuments({ status: 'completed' }),
      payments
        .aggregate([
          {
            $match: {
              status: { $in: ['paid', 'succeeded'] },
            },
          },
          {
            $group: {
              _id: null,
              totalRevenue: { $sum: '$amount' },
            },
          },
        ])
        .toArray(),
      bookings
        .aggregate([
          {
            $match: {
              createdAt: { $gte: twelveMonthsAgo },
              status: { $nin: ['cancelled', 'rejected'] },
            },
          },
          {
            $group: {
              _id: {
                year: { $year: '$createdAt' },
                month: { $month: '$createdAt' },
              },
              count: { $sum: 1 },
            },
          },
          {
            $sort: { '_id.year': 1, '_id.month': 1 },
          },
        ])
        .toArray(),
    ]);

    const totalRevenue =
      revenueAgg.length > 0 && revenueAgg[0]?.totalRevenue
        ? Number(revenueAgg[0].totalRevenue.toFixed(2))
        : 0;

    // 2. Map aggregation counts into 12 calendar month slots
    const buckets = generate12MonthBuckets();
    const countMap = new Map<string, number>();

    for (const record of monthlyBookingsAgg) {
      if (record._id && record._id.year && record._id.month) {
        const key = `${record._id.year}-${String(record._id.month).padStart(2, '0')}`;
        countMap.set(key, record.count || 0);
      }
    }

    const monthlyBookings = buckets.map((bucket) => ({
      month: bucket.key,
      label: bucket.label,
      year: bucket.year,
      monthNumber: bucket.month,
      count: countMap.get(bucket.key) || 0,
    }));

    res.status(200).json({
      totalUsers,
      totalEquipment,
      totalBookings,
      pendingApprovals,
      completedRentals,
      totalRevenue,
      monthlyBookings,
    });
  } catch (error: any) {
    console.error('Error in getAdminAnalytics:', error);
    res.status(500).json({ error: 'Internal Server Error', message: error?.message });
  }
};

/**
 * GET /analytics/owner
 * Owner only: retrieves owner-specific summary metrics:
 * - listed equipment
 * - completed rentals
 * - total earnings
 * - monthly earnings for 12 months for that owner only
 */
export const getOwnerAnalytics = async (req: Request, res: Response): Promise<void> => {
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

    const { equipment, bookings } = await dbConfig.getCollections();

    // 1. Find all equipment owned by this owner
    const ownerClauses: any[] = [
      { ownerId },
      { 'owner.id': ownerId },
      { 'owner.email': req.user.email },
    ];
    if (ObjectId.isValid(ownerId) && ownerId.length === 24) {
      ownerClauses.push({ ownerId: new ObjectId(ownerId) });
    }

    const ownedEquipment = await equipment.find({ $or: ownerClauses }).toArray();
    const listedEquipment = ownedEquipment.length;

    const buckets = generate12MonthBuckets();

    if (listedEquipment === 0) {
      res.status(200).json({
        listedEquipment: 0,
        completedRentals: 0,
        totalEarnings: 0,
        monthlyEarnings: buckets.map((b) => ({
          month: b.key,
          label: b.label,
          year: b.year,
          monthNumber: b.month,
          earnings: 0,
          count: 0,
        })),
      });
      return;
    }

    const eqIds = ownedEquipment.map((e) => e._id?.toString() || e.id);
    const bookingMatchClauses: any[] = [
      { equipmentId: { $in: eqIds } },
      ...eqIds
        .filter((id) => ObjectId.isValid(id) && id.length === 24)
        .map((id) => ({ equipmentId: new ObjectId(id) })),
    ];

    const now = new Date();
    const twelveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 11, 1);

    const paidFilter = {
      $and: [
        { $or: bookingMatchClauses },
        {
          $or: [
            { status: { $in: ['confirmed', 'paid', 'completed'] } },
            { paymentStatus: 'paid' },
          ],
        },
        { status: { $nin: ['cancelled', 'rejected'] } },
      ],
    };

    // 2. Run queries in parallel
    const [completedRentals, earningsAgg, monthlyEarningsAgg] = await Promise.all([
      bookings.countDocuments({
        $and: [{ $or: bookingMatchClauses }, { status: 'completed' }],
      }),
      bookings
        .aggregate([
          { $match: paidFilter },
          {
            $group: {
              _id: null,
              totalEarnings: { $sum: { $ifNull: ['$totalPrice', '$total'] } },
            },
          },
        ])
        .toArray(),
      bookings
        .aggregate([
          {
            $match: {
              ...paidFilter,
              createdAt: { $gte: twelveMonthsAgo },
            },
          },
          {
            $group: {
              _id: {
                year: { $year: '$createdAt' },
                month: { $month: '$createdAt' },
              },
              earnings: { $sum: { $ifNull: ['$totalPrice', '$total'] } },
              count: { $sum: 1 },
            },
          },
          {
            $sort: { '_id.year': 1, '_id.month': 1 },
          },
        ])
        .toArray(),
    ]);

    const totalEarnings =
      earningsAgg.length > 0 && earningsAgg[0]?.totalEarnings
        ? Number(earningsAgg[0].totalEarnings.toFixed(2))
        : 0;

    // 3. Map aggregation into 12 month slots
    const earningsMap = new Map<string, { earnings: number; count: number }>();
    for (const record of monthlyEarningsAgg) {
      if (record._id && record._id.year && record._id.month) {
        const key = `${record._id.year}-${String(record._id.month).padStart(2, '0')}`;
        earningsMap.set(key, {
          earnings: Number(record.earnings ? record.earnings.toFixed(2) : 0),
          count: record.count || 0,
        });
      }
    }

    const monthlyEarnings = buckets.map((bucket) => {
      const data = earningsMap.get(bucket.key) || { earnings: 0, count: 0 };
      return {
        month: bucket.key,
        label: bucket.label,
        year: bucket.year,
        monthNumber: bucket.month,
        earnings: data.earnings,
        count: data.count,
      };
    });

    res.status(200).json({
      listedEquipment,
      completedRentals,
      totalEarnings,
      monthlyEarnings,
    });
  } catch (error: any) {
    console.error('Error in getOwnerAnalytics:', error);
    res.status(500).json({ error: 'Internal Server Error', message: error?.message });
  }
};
