import app from './src/app';
import { Server } from 'http';
import { generateKeyPair, exportJWK, SignJWT, createLocalJWKSet } from 'jose';
import * as dbConfig from './src/config/db';
import { setJWKS } from './src/middlewares/auth.middleware';
import { User, Equipment, Booking, Payment } from './src/types/models';

let server: Server;

async function runAnalyticsTests() {
  console.log('--- Starting Analytics Routes End-to-End Tests ---');
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, msg: string) {
    if (condition) {
      console.log(`[PASS] ${msg}`);
      passed++;
    } else {
      console.error(`[FAIL] ${msg}`);
      failed++;
    }
  }

  // Setup local mock database in memory
  const usersDatabase: Map<string, User> = new Map();
  const equipmentDatabase: Map<string, Equipment> = new Map();
  const bookingsDatabase: Map<string, Booking> = new Map();
  const paymentsDatabase: Map<string, Payment> = new Map();

  const mockUsersCollection = {
    findOne: async (filter: any) => {
      for (const user of usersDatabase.values()) {
        if (filter.email && user.email === filter.email) return user;
        if (filter.id && user.id === filter.id) return user;
        if (filter._id && user.id === filter._id.toString()) return user;
      }
      return null;
    },
    countDocuments: async () => usersDatabase.size,
  };

  const mockEquipmentCollection = {
    countDocuments: async (filter?: any) => {
      let items = Array.from(equipmentDatabase.values());
      if (filter && filter.status) {
        items = items.filter((e) => e.status === filter.status);
      }
      return items.length;
    },
    find: (filter: any) => {
      let items = Array.from(equipmentDatabase.values());
      if (filter && filter.$or) {
        items = items.filter((eq) => {
          return filter.$or.some((clause: any) => {
            if (clause.ownerId && eq.ownerId?.toString() === clause.ownerId?.toString()) return true;
            if (clause['owner.id'] && eq.owner?.id === clause['owner.id']) return true;
            if (clause['owner.email'] && eq.owner?.email === clause['owner.email']) return true;
            return false;
          });
        });
      }
      return {
        toArray: async () => items,
      };
    },
  };

  const mockBookingsCollection = {
    countDocuments: async (filter?: any) => {
      let items = Array.from(bookingsDatabase.values());
      if (filter && filter.$and) {
        for (const clause of filter.$and) {
          if (clause.status) {
            items = items.filter((b) => b.status === clause.status);
          }
          if (clause.$or) {
            items = items.filter((b) => {
              return clause.$or.some((sub: any) => {
                if (sub.equipmentId) {
                  if (sub.equipmentId.$in) return sub.equipmentId.$in.includes(b.equipmentId?.toString());
                  return b.equipmentId?.toString() === sub.equipmentId?.toString();
                }
                return false;
              });
            });
          }
        }
      } else if (filter && filter.status) {
        items = items.filter((b) => b.status === filter.status);
      }
      return items.length;
    },
    aggregate: (pipeline: any[]) => {
      let items = Array.from(bookingsDatabase.values());

      // 1. $match stage
      const matchStage = pipeline.find((p) => p.$match)?.$match;
      if (matchStage) {
        items = items.filter((b) => {
          if (matchStage.status?.$nin && matchStage.status.$nin.includes(b.status)) return false;

          if (matchStage.$and) {
            for (const clause of matchStage.$and) {
              if (clause.$or) {
                const matches = clause.$or.some((sub: any) => {
                  if (sub.equipmentId) {
                    if (sub.equipmentId.$in) return sub.equipmentId.$in.includes(b.equipmentId?.toString());
                    return b.equipmentId?.toString() === sub.equipmentId?.toString();
                  }
                  if (sub.status?.$in) return sub.status.$in.includes(b.status);
                  if (sub.paymentStatus) return b.paymentStatus === sub.paymentStatus;
                  return false;
                });
                if (!matches) return false;
              }
            }
          }

          if (matchStage.createdAt?.$gte) {
            if (new Date(b.createdAt) < new Date(matchStage.createdAt.$gte)) return false;
          }

          return true;
        });
      }

      // 2. $group stage
      const groupStage = pipeline.find((p) => p.$group)?.$group;
      let result: any[] = [];
      if (groupStage) {
        if (groupStage._id === null) {
          const totalEarnings = items.reduce((sum, b) => sum + (b.totalPrice || b.total || 0), 0);
          result = [{ _id: null, totalEarnings }];
        } else if (groupStage._id.year && groupStage._id.month) {
          const monthMap = new Map<string, { year: number; month: number; count: number; earnings: number }>();
          for (const b of items) {
            const date = new Date(b.createdAt);
            const year = date.getFullYear();
            const month = date.getMonth() + 1;
            const key = `${year}-${month}`;
            const existing = monthMap.get(key) || { year, month, count: 0, earnings: 0 };
            existing.count++;
            existing.earnings += (b.totalPrice || b.total || 0);
            monthMap.set(key, existing);
          }
          result = Array.from(monthMap.values()).map((v) => ({
            _id: { year: v.year, month: v.month },
            count: v.count,
            earnings: v.earnings,
          }));
        }
      }

      return {
        toArray: async () => result,
      };
    },
  };

  const mockPaymentsCollection = {
    aggregate: (pipeline: any[]) => {
      let items = Array.from(paymentsDatabase.values());
      const matchStage = pipeline.find((p) => p.$match)?.$match;
      if (matchStage && matchStage.status?.$in) {
        items = items.filter((p) => matchStage.status.$in.includes(p.status));
      }
      const totalRevenue = items.reduce((sum, p) => sum + p.amount, 0);
      return {
        toArray: async () => [{ _id: null, totalRevenue }],
      };
    },
  };

  dbConfig.setCollectionsGetter(async () => {
    return {
      users: mockUsersCollection as any,
      equipment: mockEquipmentCollection as any,
      bookings: mockBookingsCollection as any,
      payments: mockPaymentsCollection as any,
      favorites: {} as any,
      reviews: {} as any,
    };
  });

  // Setup Jose JWKS mock
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = await exportJWK(publicKey);
  jwk.kid = 'test-analytics-kid';
  jwk.alg = 'RS256';
  jwk.use = 'sig';

  const mockJWKS = createLocalJWKSet({ keys: [jwk] });
  setJWKS(mockJWKS);

  async function createToken(sub: string, email: string) {
    return await new SignJWT({ email })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-analytics-kid' })
      .setSubject(sub)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(privateKey);
  }

  // Prepopulate test users
  const customerUser: User = {
    id: 'user_cust_an',
    _id: 'user_cust_an' as any,
    name: 'Customer Cindy',
    email: 'cindy@example.com',
    role: 'customer',
  };
  const ownerUser: User = {
    id: 'user_owner_an',
    _id: 'user_owner_an' as any,
    name: 'Owner Oliver',
    email: 'oliver@example.com',
    role: 'owner',
  };
  const adminUser: User = {
    id: 'user_admin_an',
    _id: 'user_admin_an' as any,
    name: 'Admin Arthur',
    email: 'arthur@example.com',
    role: 'admin',
  };

  usersDatabase.set('user_cust_an', customerUser);
  usersDatabase.set('user_owner_an', ownerUser);
  usersDatabase.set('user_admin_an', adminUser);

  const customerToken = await createToken('user_cust_an', 'cindy@example.com');
  const ownerToken = await createToken('user_owner_an', 'oliver@example.com');
  const adminToken = await createToken('user_admin_an', 'arthur@example.com');

  // Prepopulate equipment
  const eqApproved: Equipment = {
    _id: 'eq_an_1' as any,
    id: 'eq_an_1',
    name: 'Excavator Cat 320',
    description: 'Excavator',
    category: 'Heavy',
    location: 'Austin',
    price: 300,
    rentalType: 'daily',
    quantity: 1,
    condition: 'Good',
    brand: 'Cat',
    model: '320',
    image: 'https://example.com/320.jpg',
    terms: 'Terms',
    status: 'approved',
    ownerId: 'user_owner_an',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const eqPending: Equipment = {
    _id: 'eq_an_2' as any,
    id: 'eq_an_2',
    name: 'Pending Scissor Lift',
    description: 'Lift',
    category: 'Access',
    location: 'Dallas',
    price: 150,
    rentalType: 'daily',
    quantity: 1,
    condition: 'New',
    brand: 'Genie',
    model: 'GS',
    image: 'https://example.com/lift.jpg',
    terms: 'Terms',
    status: 'pending', // Pending approval!
    ownerId: 'user_owner_an',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  equipmentDatabase.set('eq_an_1', eqApproved);
  equipmentDatabase.set('eq_an_2', eqPending);

  // Prepopulate bookings
  const now = new Date();
  const currentMonthDate = new Date(now.getFullYear(), now.getMonth(), 15);
  const prevMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 10);

  const bkg1: Booking = {
    _id: 'bkg_an_1',
    equipmentId: 'eq_an_1',
    userId: 'user_cust_an',
    startDate: new Date('2026-06-01'),
    endDate: new Date('2026-06-04'),
    quantity: 1,
    totalPrice: 900,
    status: 'completed', // completed rental!
    paymentStatus: 'paid',
    createdAt: currentMonthDate,
    updatedAt: currentMonthDate,
  };

  const bkg2: Booking = {
    _id: 'bkg_an_2',
    equipmentId: 'eq_an_1',
    userId: 'user_cust_an',
    startDate: new Date('2026-05-01'),
    endDate: new Date('2026-05-03'),
    quantity: 1,
    totalPrice: 600,
    status: 'confirmed',
    paymentStatus: 'paid',
    createdAt: prevMonthDate,
    updatedAt: prevMonthDate,
  };

  bookingsDatabase.set('bkg_an_1', bkg1);
  bookingsDatabase.set('bkg_an_2', bkg2);

  // Prepopulate payments
  const pay1: Payment = {
    _id: 'pay_an_1',
    transactionId: 'tx_an_1',
    bookingId: 'bkg_an_1',
    userId: 'user_cust_an',
    amount: 900,
    currency: 'USD',
    status: 'paid',
    date: currentMonthDate,
    createdAt: currentMonthDate,
  };

  const pay2: Payment = {
    _id: 'pay_an_2',
    transactionId: 'tx_an_2',
    bookingId: 'bkg_an_2',
    userId: 'user_cust_an',
    amount: 600,
    currency: 'USD',
    status: 'paid',
    date: prevMonthDate,
    createdAt: prevMonthDate,
  };

  paymentsDatabase.set('pay_an_1', pay1);
  paymentsDatabase.set('pay_an_2', pay2);

  const port = await new Promise<number>((resolve) => {
    server = app.listen(0, () => {
      resolve((server.address() as any).port);
    });
  });

  const baseUrl = `http://localhost:${port}`;

  try {
    // --- Part 1: GET /analytics/admin ---
    const res1 = await fetch(`${baseUrl}/analytics/admin`);
    assert(res1.status === 401, 'GET /analytics/admin without auth returns 401');

    const res2 = await fetch(`${baseUrl}/analytics/admin`, {
      headers: { Authorization: `Bearer ${customerToken}` },
    });
    assert(res2.status === 403, 'GET /analytics/admin with customer token returns 403 (admin only)');

    const res3 = await fetch(`${baseUrl}/analytics/admin`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(res3.status === 403, 'GET /analytics/admin with owner token returns 403 (admin only)');

    const res4 = await fetch(`${baseUrl}/analytics/admin`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const data4 = await res4.json();
    assert(res4.status === 200, 'GET /analytics/admin for admin returns 200');
    assert(data4.totalUsers === 3, `Admin totalUsers is 3 (got ${data4.totalUsers})`);
    assert(data4.totalEquipment === 2, `Admin totalEquipment is 2 (got ${data4.totalEquipment})`);
    assert(data4.totalBookings === 2, `Admin totalBookings is 2 (got ${data4.totalBookings})`);
    assert(data4.pendingApprovals === 1, `Admin pendingApprovals is 1 (got ${data4.pendingApprovals})`);
    assert(data4.completedRentals === 1, `Admin completedRentals is 1 (got ${data4.completedRentals})`);
    assert(data4.totalRevenue === 1500, `Admin totalRevenue is 1500 (got ${data4.totalRevenue})`);
    assert(Array.isArray(data4.monthlyBookings), 'Admin monthlyBookings is an array');
    assert(data4.monthlyBookings.length === 12, `monthlyBookings contains exactly 12 months (got ${data4.monthlyBookings.length})`);
    assert(
      data4.monthlyBookings.some((m: any) => m.count > 0),
      'Monthly bookings contains non-zero counts for recent booking activity'
    );

    // --- Part 2: GET /analytics/owner ---
    const res5 = await fetch(`${baseUrl}/analytics/owner`);
    assert(res5.status === 401, 'GET /analytics/owner without auth returns 401');

    const res6 = await fetch(`${baseUrl}/analytics/owner`, {
      headers: { Authorization: `Bearer ${customerToken}` },
    });
    assert(res6.status === 403, 'GET /analytics/owner with customer token returns 403 (owner only)');

    const res7 = await fetch(`${baseUrl}/analytics/owner`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    const data7 = await res7.json();
    assert(res7.status === 200, 'GET /analytics/owner for owner returns 200');
    assert(data7.listedEquipment === 2, `Owner listedEquipment is 2 (got ${data7.listedEquipment})`);
    assert(data7.completedRentals === 1, `Owner completedRentals is 1 (got ${data7.completedRentals})`);
    assert(data7.totalEarnings === 1500, `Owner totalEarnings is 1500 (got ${data7.totalEarnings})`);
    assert(Array.isArray(data7.monthlyEarnings), 'Owner monthlyEarnings is an array');
    assert(data7.monthlyEarnings.length === 12, `monthlyEarnings contains exactly 12 months (got ${data7.monthlyEarnings.length})`);
    assert(
      data7.monthlyEarnings.some((m: any) => m.earnings > 0),
      'Monthly earnings contains non-zero earnings for recent booking activity'
    );

  } finally {
    server.close();
  }

  console.log(`\nAnalytics Route Tests finished: ${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

runAnalyticsTests().catch((err) => {
  console.error('Fatal error during analytics route tests:', err);
  if (server) server.close();
  process.exit(1);
});
