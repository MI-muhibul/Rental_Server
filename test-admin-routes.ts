import app from './src/app';
import { Server } from 'http';
import { generateKeyPair, exportJWK, SignJWT, createLocalJWKSet } from 'jose';
import * as dbConfig from './src/config/db';
import { setJWKS } from './src/middlewares/auth.middleware';
import { User, Equipment } from './src/types/models';

let server: Server;

async function runAdminTests() {
  console.log('--- Starting Admin Equipment Routes End-to-End Tests ---');
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

  const mockUsersCollection = {
    findOne: async (filter: any) => {
      for (const user of usersDatabase.values()) {
        if (filter.email && user.email === filter.email) return user;
        if (filter.id && user.id === filter.id) return user;
        if (filter._id && user.id === filter._id.toString()) return user;
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
      if (filter && filter.status) {
        items = items.filter((it) => it.status === filter.status);
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
      let items = Array.from(equipmentDatabase.values());
      if (filter && filter.status) {
        items = items.filter((it) => it.status === filter.status);
      }
      return items.length;
    },
    findOneAndUpdate: async (filter: any, update: any) => {
      const targetId = filter.$or
        ? filter.$or.map((f: any) => f._id?.toString() || f.id).find(Boolean)
        : filter._id?.toString() || filter.id;

      const item = targetId ? equipmentDatabase.get(targetId) : null;
      if (!item) return null;

      const updated = {
        ...item,
        ...update.$set,
        updatedAt: update.$set.updatedAt || new Date(),
      };
      equipmentDatabase.set(targetId, updated);
      return updated;
    },
    deleteOne: async (filter: any) => {
      const targetId = filter.$or
        ? filter.$or.map((f: any) => f._id?.toString() || f.id).find(Boolean)
        : filter._id?.toString() || filter.id;

      if (targetId && equipmentDatabase.has(targetId)) {
        equipmentDatabase.delete(targetId);
        return { deletedCount: 1 };
      }
      return { deletedCount: 0 };
    },
  };

  dbConfig.setCollectionsGetter(async () => {
    return {
      users: mockUsersCollection as any,
      equipment: mockEquipmentCollection as any,
      bookings: {} as any,
      payments: {} as any,
      favorites: {} as any,
      reviews: {} as any,
    };
  });

  // Setup Jose JWKS mock
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = await exportJWK(publicKey);
  jwk.kid = 'test-admin-kid';
  jwk.alg = 'RS256';
  jwk.use = 'sig';

  const mockJWKS = createLocalJWKSet({ keys: [jwk] });
  setJWKS(mockJWKS);

  // Helper to issue tokens
  async function createToken(sub: string, email: string) {
    return await new SignJWT({ email })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-admin-kid' })
      .setSubject(sub)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(privateKey);
  }

  // Prepopulate test users
  const customerUser: User = {
    id: 'user_cust',
    _id: 'user_cust' as any,
    name: 'Customer Cathy',
    email: 'cathy@test.com',
    role: 'customer',
  };
  const ownerUser: User = {
    id: 'user_owner',
    _id: 'user_owner' as any,
    name: 'Owner Owen',
    email: 'owen@test.com',
    role: 'owner',
  };
  const adminUser: User = {
    id: 'user_admin',
    _id: 'user_admin' as any,
    name: 'Admin Alice',
    email: 'admin@test.com',
    role: 'admin',
  };

  usersDatabase.set('user_cust', customerUser);
  usersDatabase.set('user_owner', ownerUser);
  usersDatabase.set('user_admin', adminUser);

  const customerToken = await createToken('user_cust', 'cathy@test.com');
  const ownerToken = await createToken('user_owner', 'owen@test.com');
  const adminToken = await createToken('user_admin', 'admin@test.com');

  // Prepopulate equipment with various statuses
  const itemPending: Equipment = {
    _id: 'eq_pending' as any,
    id: 'eq_pending',
    name: 'Pending Trencher',
    description: 'Walk behind trencher',
    category: 'Earthmoving',
    location: 'Austin, TX',
    price: 120,
    rentalType: 'daily',
    quantity: 1,
    condition: 'Good',
    brand: 'Ditch Witch',
    model: 'C16X',
    image: 'https://example.com/trencher.jpg',
    terms: 'Deposit required',
    status: 'pending',
    ownerId: 'user_owner',
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  };

  const itemApproved: Equipment = {
    _id: 'eq_approved' as any,
    id: 'eq_approved',
    name: 'Approved Jackhammer',
    description: 'Demolition hammer',
    category: 'Power Tools',
    location: 'Austin, TX',
    price: 60,
    rentalType: 'daily',
    quantity: 2,
    condition: 'Excellent',
    brand: 'Hilti',
    model: 'TE 3000',
    image: 'https://example.com/hilti.jpg',
    terms: 'Safety goggles',
    status: 'approved',
    ownerId: 'user_owner',
    createdAt: new Date('2026-01-02'),
    updatedAt: new Date('2026-01-02'),
  };

  const itemRejected: Equipment = {
    _id: 'eq_rejected' as any,
    id: 'eq_rejected',
    name: 'Rejected Ladder',
    description: 'Damaged ladder',
    category: 'Access',
    location: 'Austin, TX',
    price: 20,
    rentalType: 'daily',
    quantity: 1,
    condition: 'Poor',
    brand: 'Werner',
    model: 'D1200',
    image: 'https://example.com/ladder.jpg',
    terms: 'Terms',
    status: 'rejected',
    ownerId: 'user_owner',
    createdAt: new Date('2026-01-03'),
    updatedAt: new Date('2026-01-03'),
  };

  equipmentDatabase.set('eq_pending', itemPending);
  equipmentDatabase.set('eq_approved', itemApproved);
  equipmentDatabase.set('eq_rejected', itemRejected);

  const port = await new Promise<number>((resolve) => {
    server = app.listen(0, () => {
      resolve((server.address() as any).port);
    });
  });

  const baseUrl = `http://localhost:${port}`;

  try {
    // 1. GET /admin/equipment without auth -> 401
    const res1 = await fetch(`${baseUrl}/admin/equipment`);
    assert(res1.status === 401, 'GET /admin/equipment without auth returns 401');

    // 2. GET /admin/equipment with customer token -> 403
    const res2 = await fetch(`${baseUrl}/admin/equipment`, {
      headers: { Authorization: `Bearer ${customerToken}` },
    });
    assert(res2.status === 403, 'GET /admin/equipment with customer token returns 403');

    // 3. GET /admin/equipment with owner token -> 403
    const res3 = await fetch(`${baseUrl}/admin/equipment`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(res3.status === 403, 'GET /admin/equipment with owner token returns 403');

    // 4. GET /admin/equipment with admin token -> 200, returns all statuses
    const res4 = await fetch(`${baseUrl}/admin/equipment`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const data4 = await res4.json();
    assert(res4.status === 200, 'GET /admin/equipment with admin token returns 200');
    assert(data4.total === 3, 'Admin equipment returns all 3 items across all statuses');
    assert(
      data4.items.some((it: any) => it.status === 'pending'),
      'Admin list includes pending items'
    );
    assert(
      data4.items.some((it: any) => it.status === 'approved'),
      'Admin list includes approved items'
    );
    assert(
      data4.items.some((it: any) => it.status === 'rejected'),
      'Admin list includes rejected items'
    );

    // 5. GET /admin/equipment?status=pending -> returns only pending items
    const res5 = await fetch(`${baseUrl}/admin/equipment?status=pending`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const data5 = await res5.json();
    assert(res5.status === 200, 'GET /admin/equipment?status=pending returns 200');
    assert(data5.items.length === 1, 'Returns 1 pending item');
    assert(data5.items[0].status === 'pending', 'Filtered item has status pending');

    // 6. PATCH /admin/equipment/:id/status without auth -> 401
    const res6 = await fetch(`${baseUrl}/admin/equipment/eq_pending/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'approved' }),
    });
    assert(res6.status === 401, 'PATCH status without auth returns 401');

    // 7. PATCH /admin/equipment/:id/status with non-admin -> 403
    const res7 = await fetch(`${baseUrl}/admin/equipment/eq_pending/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ownerToken}`,
      },
      body: JSON.stringify({ status: 'approved' }),
    });
    assert(res7.status === 403, 'PATCH status with owner token returns 403');

    // 8. PATCH /admin/equipment/:id/status with invalid status -> 400
    const res8 = await fetch(`${baseUrl}/admin/equipment/eq_pending/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ status: 'invalid_status' }),
    });
    assert(res8.status === 400, 'PATCH status with invalid status returns 400');

    // 9. PATCH /admin/equipment/:id/status for non-existent item -> 404
    const res9 = await fetch(`${baseUrl}/admin/equipment/eq_unknown/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ status: 'approved' }),
    });
    assert(res9.status === 404, 'PATCH status for unknown item returns 404');

    // 10. PATCH /admin/equipment/:id/status -> approve pending item
    const res10 = await fetch(`${baseUrl}/admin/equipment/eq_pending/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ status: 'approved' }),
    });
    const data10 = await res10.json();
    assert(res10.status === 200, 'PATCH status to approved returns 200');
    assert(data10.equipment.status === 'approved', 'Equipment status updated to approved in DB');

    // 11. PATCH /admin/equipment/:id/status -> reject item with reason
    const res11 = await fetch(`${baseUrl}/admin/equipment/eq_approved/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        status: 'rejected',
        rejectionReason: 'Photos do not match specifications',
      }),
    });
    const data11 = await res11.json();
    assert(res11.status === 200, 'PATCH status to rejected returns 200');
    assert(data11.equipment.status === 'rejected', 'Equipment status updated to rejected');
    assert(
      data11.equipment.rejectionReason === 'Photos do not match specifications',
      'Rejection reason recorded'
    );

    // 12. Admin update: PATCH /admin/equipment/:id without auth -> 401
    const res12 = await fetch(`${baseUrl}/admin/equipment/eq_pending`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ price: 175 }),
    });
    assert(res12.status === 401, 'PATCH /admin/equipment/:id without auth returns 401');

    // 13. Admin update: PATCH /admin/equipment/:id with customer -> 403
    const res13 = await fetch(`${baseUrl}/admin/equipment/eq_pending`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${customerToken}`,
      },
      body: JSON.stringify({ price: 175 }),
    });
    assert(res13.status === 403, 'PATCH /admin/equipment/:id with customer returns 403');

    // 14. Admin update: PATCH /admin/equipment/:id with admin -> 200
    const res14 = await fetch(`${baseUrl}/admin/equipment/eq_pending`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        name: 'Updated Trencher by Admin',
        price: 175,
        location: 'Dallas, TX',
      }),
    });
    const data14 = await res14.json();
    assert(res14.status === 200, 'Admin update returns 200');
    assert(data14.equipment.name === 'Updated Trencher by Admin', 'Name updated by admin');
    assert(data14.equipment.price === 175, 'Price updated by admin');
    assert(data14.equipment.location === 'Dallas, TX', 'Location updated by admin');

    // 15. Admin delete: DELETE /admin/equipment/:id without auth -> 401
    const res15 = await fetch(`${baseUrl}/admin/equipment/eq_rejected`, {
      method: 'DELETE',
    });
    assert(res15.status === 401, 'DELETE /admin/equipment/:id without auth returns 401');

    // 16. Admin delete: DELETE /admin/equipment/:id with customer -> 403
    const res16 = await fetch(`${baseUrl}/admin/equipment/eq_rejected`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${customerToken}` },
    });
    assert(res16.status === 403, 'DELETE /admin/equipment/:id with customer returns 403');

    // 17. Admin delete: DELETE /admin/equipment/:id with admin -> 200
    const res17 = await fetch(`${baseUrl}/admin/equipment/eq_rejected`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const data17 = await res17.json();
    assert(res17.status === 200, 'DELETE /admin/equipment/:id with admin returns 200');
    assert(data17.deletedId === 'eq_rejected', 'Returns deletedId');

    // 18. Verify deleted item is no longer in equipmentDatabase
    assert(!equipmentDatabase.has('eq_rejected'), 'Equipment successfully removed from database');

  } finally {
    server.close();
  }

  console.log(`\nAdmin Equipment Route Tests finished: ${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

runAdminTests().catch((err) => {
  console.error('Fatal error during admin equipment route tests:', err);
  if (server) server.close();
  process.exit(1);
});
