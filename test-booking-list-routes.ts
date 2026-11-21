import app from './src/app';
import { Server } from 'http';
import { generateKeyPair, exportJWK, SignJWT, createLocalJWKSet } from 'jose';
import * as dbConfig from './src/config/db';
import { setJWKS } from './src/middlewares/auth.middleware';
import { User, Equipment, Booking } from './src/types/models';

let server: Server;

async function runBookingListTests() {
  console.log('--- Starting Booking List Routes End-to-End Tests ---');
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

  const mockUsersCollection = {
    findOne: async (filter: any) => {
      const targetId = filter.$or
        ? filter.$or.map((f: any) => f._id?.toString() || f.id).find(Boolean)
        : filter._id?.toString() || filter.id || filter.email;

      for (const user of usersDatabase.values()) {
        if (filter.email && user.email === filter.email) return user;
        if (targetId && (user._id?.toString() === targetId || user.id === targetId)) return user;
      }
      return null;
    },
  };

  const mockEquipmentCollection = {
    findOne: async (filter: any) => {
      const targetId = filter.$or
        ? filter.$or.map((f: any) => f._id?.toString() || f.id).find(Boolean)
        : filter._id?.toString() || filter.id;

      if (targetId && equipmentDatabase.has(targetId)) {
        return equipmentDatabase.get(targetId) || null;
      }
      for (const eq of equipmentDatabase.values()) {
        if (targetId && (eq._id?.toString() === targetId || eq.id === targetId)) {
          return eq;
        }
      }
      return null;
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
    find: (filter: any) => {
      let items = Array.from(bookingsDatabase.values());

      if (filter && filter.$or) {
        items = items.filter((b) => {
          return filter.$or.some((clause: any) => {
            if (clause.userId && b.userId?.toString() === clause.userId?.toString()) return true;
            if (clause.equipmentId) {
              if (clause.equipmentId.$in) {
                return clause.equipmentId.$in.includes(b.equipmentId?.toString());
              }
              return b.equipmentId?.toString() === clause.equipmentId?.toString();
            }
            return false;
          });
        });
      }

      if (filter && filter.status) {
        items = items.filter((b) => b.status === filter.status);
      }

      return {
        sort: () => ({
          skip: (skipCount: number) => ({
            limit: (limitCount: number) => ({
              toArray: async () => items.slice(skipCount, skipCount + limitCount),
            }),
          }),
          limit: (limitCount: number) => ({
            toArray: async () => items.slice(0, limitCount),
          }),
          toArray: async () => items,
        }),
      };
    },
    countDocuments: async (filter: any) => {
      let items = Array.from(bookingsDatabase.values());
      if (filter && filter.$or) {
        items = items.filter((b) => {
          return filter.$or.some((clause: any) => {
            if (clause.userId && b.userId?.toString() === clause.userId?.toString()) return true;
            if (clause.equipmentId) {
              if (clause.equipmentId.$in) {
                return clause.equipmentId.$in.includes(b.equipmentId?.toString());
              }
              return b.equipmentId?.toString() === clause.equipmentId?.toString();
            }
            return false;
          });
        });
      }
      if (filter && filter.status) {
        items = items.filter((b) => b.status === filter.status);
      }
      return items.length;
    },
  };

  dbConfig.setCollectionsGetter(async () => {
    return {
      users: mockUsersCollection as any,
      equipment: mockEquipmentCollection as any,
      bookings: mockBookingsCollection as any,
      payments: {} as any,
      favorites: {} as any,
      reviews: {} as any,
    };
  });

  // Setup Jose JWKS mock
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = await exportJWK(publicKey);
  jwk.kid = 'test-booking-list-kid';
  jwk.alg = 'RS256';
  jwk.use = 'sig';

  const mockJWKS = createLocalJWKSet({ keys: [jwk] });
  setJWKS(mockJWKS);

  async function createToken(sub: string, email: string) {
    return await new SignJWT({ email })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-booking-list-kid' })
      .setSubject(sub)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(privateKey);
  }

  // Prepopulate test users
  const customer1: User = {
    id: 'user_cust_10',
    _id: 'user_cust_10' as any,
    name: 'Cathy Customer',
    email: 'cathy@example.com',
    phone: '555-0101',
    role: 'customer',
  };
  const customer2: User = {
    id: 'user_cust_20',
    _id: 'user_cust_20' as any,
    name: 'David Diver',
    email: 'david@example.com',
    phone: '555-0202',
    role: 'customer',
  };
  const owner1: User = {
    id: 'user_owner_10',
    _id: 'user_owner_10' as any,
    name: 'Oscar Owner',
    email: 'oscar@example.com',
    role: 'owner',
  };
  const admin1: User = {
    id: 'user_admin_10',
    _id: 'user_admin_10' as any,
    name: 'Alice Admin',
    email: 'alice@example.com',
    role: 'admin',
  };

  usersDatabase.set('user_cust_10', customer1);
  usersDatabase.set('user_cust_20', customer2);
  usersDatabase.set('user_owner_10', owner1);
  usersDatabase.set('user_admin_10', admin1);

  const customer1Token = await createToken('user_cust_10', 'cathy@example.com');
  const owner1Token = await createToken('user_owner_10', 'oscar@example.com');
  const admin1Token = await createToken('user_admin_10', 'alice@example.com');

  // Prepopulate test equipment
  const equipment1: Equipment = {
    _id: 'eq_item_1' as any,
    id: 'eq_item_1',
    name: 'Caterpillar 320 Excavator',
    description: 'Heavy duty hydraulic excavator',
    category: 'Heavy Machinery',
    location: 'Houston, TX',
    price: 400,
    rentalType: 'daily',
    quantity: 2,
    condition: 'Excellent',
    brand: 'Caterpillar',
    model: '320',
    image: 'https://example.com/cat320.jpg',
    terms: 'Valid operator certificate',
    status: 'approved',
    ownerId: 'user_owner_10',
    owner: {
      id: 'user_owner_10',
      name: 'Oscar Owner',
      email: 'oscar@example.com',
    },
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  };

  const equipment2: Equipment = {
    _id: 'eq_item_2' as any,
    id: 'eq_item_2',
    name: 'Honda Generator 7000W',
    description: 'Quiet portable inverter generator',
    category: 'Power Tools',
    location: 'Austin, TX',
    price: 90,
    rentalType: 'daily',
    quantity: 4,
    condition: 'Good',
    brand: 'Honda',
    model: 'EU7000is',
    image: 'https://example.com/honda.jpg',
    terms: 'Return with full tank',
    status: 'approved',
    ownerId: 'user_owner_10',
    owner: {
      id: 'user_owner_10',
      name: 'Oscar Owner',
      email: 'oscar@example.com',
    },
    createdAt: new Date('2026-01-02'),
    updatedAt: new Date('2026-01-02'),
  };

  equipmentDatabase.set('eq_item_1', equipment1);
  equipmentDatabase.set('eq_item_2', equipment2);

  // Prepopulate test bookings
  const booking1: Booking = {
    _id: 'bkg_cust1_eq1',
    id: 'bkg_cust1_eq1',
    equipmentId: 'eq_item_1',
    userId: 'user_cust_10',
    startDate: new Date('2026-07-01'),
    endDate: new Date('2026-07-04'),
    quantity: 1,
    totalPrice: 1200,
    status: 'confirmed',
    paymentStatus: 'paid',
    createdAt: new Date('2026-06-20T10:00:00Z'),
    updatedAt: new Date('2026-06-20T10:00:00Z'),
  };

  const booking2: Booking = {
    _id: 'bkg_cust1_eq2',
    id: 'bkg_cust1_eq2',
    equipmentId: 'eq_item_2',
    userId: 'user_cust_10',
    startDate: new Date('2026-07-10'),
    endDate: new Date('2026-07-12'),
    quantity: 2,
    totalPrice: 360,
    status: 'completed',
    paymentStatus: 'paid',
    createdAt: new Date('2026-06-21T10:00:00Z'),
    updatedAt: new Date('2026-06-21T10:00:00Z'),
  };

  const booking3: Booking = {
    _id: 'bkg_cust2_eq1',
    id: 'bkg_cust2_eq1',
    equipmentId: 'eq_item_1',
    userId: 'user_cust_20',
    startDate: new Date('2026-07-15'),
    endDate: new Date('2026-07-18'),
    quantity: 1,
    totalPrice: 1200,
    status: 'confirmed',
    paymentStatus: 'paid',
    createdAt: new Date('2026-06-22T10:00:00Z'),
    updatedAt: new Date('2026-06-22T10:00:00Z'),
  };

  bookingsDatabase.set('bkg_cust1_eq1', booking1);
  bookingsDatabase.set('bkg_cust1_eq2', booking2);
  bookingsDatabase.set('bkg_cust2_eq1', booking3);

  const port = await new Promise<number>((resolve) => {
    server = app.listen(0, () => {
      resolve((server.address() as any).port);
    });
  });

  const baseUrl = `http://localhost:${port}`;

  try {
    // --- 1. GET /bookings/mine ---
    const res1 = await fetch(`${baseUrl}/bookings/mine`);
    assert(res1.status === 401, 'GET /bookings/mine without auth returns 401');

    const res2 = await fetch(`${baseUrl}/bookings/mine`, {
      headers: { Authorization: `Bearer ${owner1Token}` },
    });
    assert(res2.status === 403, 'GET /bookings/mine with owner token returns 403 (renter only)');

    const res3 = await fetch(`${baseUrl}/bookings/mine?page=1&limit=10`, {
      headers: { Authorization: `Bearer ${customer1Token}` },
    });
    const data3 = await res3.json();
    assert(res3.status === 200, 'GET /bookings/mine for customer1 returns 200');
    assert(Array.isArray(data3.bookings), 'Returns bookings array');
    assert(data3.total === 2, `Customer1 has 2 bookings (got ${data3.total})`);
    assert(data3.page === 1, 'Pagination page is 1');
    assert(data3.limit === 10, 'Pagination limit is 10');
    assert(data3.totalPages === 1, 'Total pages is 1');
    assert(
      data3.bookings.some((b: any) => b.equipmentName === 'Caterpillar 320 Excavator'),
      'Booking 1 includes equipment name "Caterpillar 320 Excavator"'
    );
    assert(
      data3.bookings.some((b: any) => b.equipmentName === 'Honda Generator 7000W'),
      'Booking 2 includes equipment name "Honda Generator 7000W"'
    );
    assert(
      data3.bookings.every((b: any) => b.equipment !== null),
      'Each booking includes populated equipment object'
    );

    // --- 2. GET /bookings/owner ---
    const res4 = await fetch(`${baseUrl}/bookings/owner`);
    assert(res4.status === 401, 'GET /bookings/owner without auth returns 401');

    const res5 = await fetch(`${baseUrl}/bookings/owner`, {
      headers: { Authorization: `Bearer ${customer1Token}` },
    });
    assert(res5.status === 403, 'GET /bookings/owner with customer token returns 403 (owner only)');

    const res6 = await fetch(`${baseUrl}/bookings/owner?page=1&limit=10`, {
      headers: { Authorization: `Bearer ${owner1Token}` },
    });
    const data6 = await res6.json();
    assert(res6.status === 200, 'GET /bookings/owner for owner1 returns 200');
    assert(Array.isArray(data6.bookings), 'Owner bookings is an array');
    assert(data6.total === 3, `Owner1 has 3 bookings on their equipment (got ${data6.total})`);
    assert(
      data6.bookings.every((b: any) => b.equipmentName !== undefined && b.equipmentName !== ''),
      'All owner bookings include equipment names'
    );
    assert(
      data6.bookings.every((b: any) => b.customer !== null && b.customer.name !== undefined),
      'All owner bookings include customer info (name, email, phone)'
    );
    assert(
      data6.bookings.some((b: any) => b.customer.name === 'Cathy Customer' && b.customer.phone === '555-0101'),
      'Customer info for Cathy Customer populated correctly'
    );
    assert(
      data6.bookings.some((b: any) => b.customer.name === 'David Diver' && b.customer.phone === '555-0202'),
      'Customer info for David Diver populated correctly'
    );

    // --- 3. GET /admin/bookings ---
    const res7 = await fetch(`${baseUrl}/admin/bookings`);
    assert(res7.status === 401, 'GET /admin/bookings without auth returns 401');

    const res8 = await fetch(`${baseUrl}/admin/bookings`, {
      headers: { Authorization: `Bearer ${customer1Token}` },
    });
    assert(res8.status === 403, 'GET /admin/bookings with customer token returns 403 (admin only)');

    const res9 = await fetch(`${baseUrl}/admin/bookings`, {
      headers: { Authorization: `Bearer ${owner1Token}` },
    });
    assert(res9.status === 403, 'GET /admin/bookings with owner token returns 403 (admin only)');

    const res10 = await fetch(`${baseUrl}/admin/bookings?page=1&limit=20`, {
      headers: { Authorization: `Bearer ${admin1Token}` },
    });
    const data10 = await res10.json();
    assert(res10.status === 200, 'GET /admin/bookings for admin1 returns 200');
    assert(Array.isArray(data10.bookings), 'Admin bookings is an array');
    assert(data10.total === 3, `Admin retrieves all 3 bookings in the system (got ${data10.total})`);
    assert(
      data10.bookings.every((b: any) => b.equipmentName !== undefined),
      'Admin bookings include equipment names'
    );
    assert(
      data10.bookings.every((b: any) => b.customer !== null && b.customerName !== undefined),
      'Admin bookings include customer info'
    );
    assert(
      data10.bookings.every((b: any) => b.owner !== null && b.ownerName === 'Oscar Owner'),
      'Admin bookings include owner info (Oscar Owner)'
    );

  } finally {
    server.close();
  }

  console.log(`\nBooking List Route Tests finished: ${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

runBookingListTests().catch((err) => {
  console.error('Fatal error during booking list route tests:', err);
  if (server) server.close();
  process.exit(1);
});
