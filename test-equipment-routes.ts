import app from './src/app';
import { Server } from 'http';
import { generateKeyPair, exportJWK, SignJWT, createLocalJWKSet } from 'jose';
import * as dbConfig from './src/config/db';
import { setJWKS } from './src/middlewares/auth.middleware';
import { User, Equipment } from './src/types/models';

let server: Server;

async function runEquipmentTests() {
  console.log('--- Starting Equipment Owner Routes End-to-End Tests ---');
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
    insertOne: async (doc: any) => {
      const id = 'eq_' + Math.random().toString(36).substring(2, 9);
      const saved = { ...doc, _id: id };
      equipmentDatabase.set(id, saved);
      return { insertedId: id };
    },
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
        items = items.filter((item) => {
          return filter.$or.some((clause: any) => {
            if (clause.ownerId && (item.ownerId === clause.ownerId || item.ownerId?.toString() === clause.ownerId?.toString())) return true;
            if (clause['owner.id'] && item.owner?.id === clause['owner.id']) return true;
            if (clause['owner.email'] && item.owner?.email === clause['owner.email']) return true;
            return false;
          });
        });
      }
      return {
        sort: () => ({
          toArray: async () => items,
        }),
      };
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
  jwk.kid = 'test-equipment-kid';
  jwk.alg = 'RS256';
  jwk.use = 'sig';

  const mockJWKS = createLocalJWKSet({ keys: [jwk] });
  setJWKS(mockJWKS);

  // Helper to issue tokens
  async function createToken(sub: string, email: string) {
    return await new SignJWT({ email })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-equipment-kid' })
      .setSubject(sub)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(privateKey);
  }

  // Prepopulate test users
  const customerUser: User = {
    id: 'user_cust_1',
    _id: 'user_cust_1' as any,
    name: 'Charlie Customer',
    email: 'customer@test.com',
    role: 'customer',
  };
  const owner1User: User = {
    id: 'user_owner_1',
    _id: 'user_owner_1' as any,
    name: 'Oliver Owner',
    email: 'owner1@test.com',
    role: 'owner',
  };
  const owner2User: User = {
    id: 'user_owner_2',
    _id: 'user_owner_2' as any,
    name: 'Oscar Other',
    email: 'owner2@test.com',
    role: 'owner',
  };

  usersDatabase.set('user_cust_1', customerUser);
  usersDatabase.set('user_owner_1', owner1User);
  usersDatabase.set('user_owner_2', owner2User);

  const customerToken = await createToken('user_cust_1', 'customer@test.com');
  const owner1Token = await createToken('user_owner_1', 'owner1@test.com');
  const owner2Token = await createToken('user_owner_2', 'owner2@test.com');

  // Start HTTP server on random port
  const port = await new Promise<number>((resolve) => {
    server = app.listen(0, () => {
      resolve((server.address() as any).port);
    });
  });

  const baseUrl = `http://localhost:${port}`;

  const validPayload = {
    name: 'Heavy Duty Excavator',
    description: 'Cat 320 Hydraulic Excavator in prime operating condition',
    category: 'Heavy Machinery',
    location: 'Austin, TX',
    price: 450,
    rentalType: 'daily',
    quantity: 2,
    condition: 'Excellent',
    brand: 'Caterpillar',
    model: '320D',
    image: 'https://example.com/cat320.jpg',
    terms: 'Valid operator certification and refundable security deposit required.',
  };

  try {
    // 1. POST /equipment without token -> 401
    const res1 = await fetch(`${baseUrl}/equipment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validPayload),
    });
    assert(res1.status === 401, 'POST /equipment without auth returns 401');

    // 2. POST /equipment with customer token -> 403
    const res2 = await fetch(`${baseUrl}/equipment`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${customerToken}`,
      },
      body: JSON.stringify(validPayload),
    });
    assert(res2.status === 403, 'POST /equipment with customer token returns 403');

    // 3. POST /equipment with missing fields -> 400
    const res3 = await fetch(`${baseUrl}/equipment`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${owner1Token}`,
      },
      body: JSON.stringify({ name: 'Incomplete Item' }),
    });
    const data3 = await res3.json();
    assert(res3.status === 400, 'POST /equipment with missing fields returns 400');
    assert(data3.error.includes('description is required'), 'Validation error mentions description');
    assert(data3.error.includes('price is required'), 'Validation error mentions price');
    assert(data3.error.includes('rentalType is required'), 'Validation error mentions rentalType');

    // 4. POST /equipment with invalid rentalType -> 400
    const res4 = await fetch(`${baseUrl}/equipment`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${owner1Token}`,
      },
      body: JSON.stringify({ ...validPayload, rentalType: 'hourly' }),
    });
    assert(res4.status === 400, 'POST /equipment with invalid rentalType returns 400');

    // 5. POST /equipment with valid payload and attempted status: "available"
    const res5 = await fetch(`${baseUrl}/equipment`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${owner1Token}`,
      },
      body: JSON.stringify({
        ...validPayload,
        status: 'available', // Should be forced to "pending"
      }),
    });
    const data5 = await res5.json();
    assert(res5.status === 201, 'POST /equipment creates item successfully (201)');
    assert(data5.equipment.status === 'pending', 'Equipment status forced to "pending"');
    assert(data5.equipment.ownerId === 'user_owner_1', 'Equipment ownerId set from token');
    assert(data5.equipment.owner.email === 'owner1@test.com', 'Equipment owner.email set from token');
    assert(data5.equipment.owner.name === 'Oliver Owner', 'Equipment owner.name set from token');
    assert(data5.equipment.rentalType === 'daily', 'Equipment rentalType saved correctly');
    assert(data5.equipment.price === 450, 'Equipment price saved correctly');

    const createdEquipmentId = data5.equipment._id;

    // 6. GET /equipment/mine without auth -> 401
    const res6 = await fetch(`${baseUrl}/equipment/mine`);
    assert(res6.status === 401, 'GET /equipment/mine without auth returns 401');

    // 7. GET /equipment/mine with customer -> 403
    const res7 = await fetch(`${baseUrl}/equipment/mine`, {
      headers: { Authorization: `Bearer ${customerToken}` },
    });
    assert(res7.status === 403, 'GET /equipment/mine for customer returns 403');

    // 8. GET /equipment/mine for owner1 -> 200 with their equipment
    const res8 = await fetch(`${baseUrl}/equipment/mine`, {
      headers: { Authorization: `Bearer ${owner1Token}` },
    });
    const data8 = await res8.json();
    assert(res8.status === 200, 'GET /equipment/mine for owner1 returns 200');
    assert(Array.isArray(data8.equipment), 'Equipment list returned');
    assert(data8.equipment.length === 1, 'Owner1 has 1 equipment item');
    assert(data8.equipment[0]._id === createdEquipmentId, 'Owner1 retrieved their equipment');

    // 9. GET /equipment/mine for owner2 -> 200 with empty list
    const res9 = await fetch(`${baseUrl}/equipment/mine`, {
      headers: { Authorization: `Bearer ${owner2Token}` },
    });
    const data9 = await res9.json();
    assert(res9.status === 200, 'GET /equipment/mine for owner2 returns 200');
    assert(data9.equipment.length === 0, 'Owner2 has 0 equipment items');

    // 10. PATCH /equipment/:id without auth -> 401
    const res10 = await fetch(`${baseUrl}/equipment/${createdEquipmentId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ price: 500 }),
    });
    assert(res10.status === 401, 'PATCH /equipment/:id without auth returns 401');

    // 11. PATCH /equipment/:id by owner2 (not the item's owner) -> 403
    const res11 = await fetch(`${baseUrl}/equipment/${createdEquipmentId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${owner2Token}`,
      },
      body: JSON.stringify({ price: 500 }),
    });
    const data11 = await res11.json();
    assert(res11.status === 403, 'PATCH /equipment/:id by non-item-owner returns 403');
    assert(data11.error.includes('only edit your own equipment'), 'Clear error message on forbidden edit');

    // 12. PATCH /equipment/:id with invalid rentalType -> 400
    const res12 = await fetch(`${baseUrl}/equipment/${createdEquipmentId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${owner1Token}`,
      },
      body: JSON.stringify({ rentalType: 'yearly' }),
    });
    assert(res12.status === 400, 'PATCH /equipment/:id with invalid rentalType returns 400');

    // 13. PATCH /equipment/:id with negative price -> 400
    const res13 = await fetch(`${baseUrl}/equipment/${createdEquipmentId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${owner1Token}`,
      },
      body: JSON.stringify({ price: -10 }),
    });
    assert(res13.status === 400, 'PATCH /equipment/:id with negative price returns 400');

    // 14. PATCH /equipment/:id by owner1 (actual owner) -> 200
    const res14 = await fetch(`${baseUrl}/equipment/${createdEquipmentId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${owner1Token}`,
      },
      body: JSON.stringify({
        price: 520,
        rentalType: 'weekly',
        quantity: 3,
        location: 'Dallas, TX',
      }),
    });
    const data14 = await res14.json();
    assert(res14.status === 200, 'PATCH /equipment/:id by item owner returns 200');
    assert(data14.equipment.price === 520, 'Price updated to 520');
    assert(data14.equipment.rentalType === 'weekly', 'rentalType updated to weekly');
    assert(data14.equipment.quantity === 3, 'quantity updated to 3');
    assert(data14.equipment.location === 'Dallas, TX', 'location updated to Dallas, TX');

    // 15. DELETE /equipment/:id by owner2 (not item owner) -> 403
    const res15 = await fetch(`${baseUrl}/equipment/${createdEquipmentId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${owner2Token}` },
    });
    const data15 = await res15.json();
    assert(res15.status === 403, 'DELETE /equipment/:id by non-item-owner returns 403');
    assert(data15.error.includes('only delete your own equipment'), 'Clear error message on forbidden delete');

    // 16. DELETE /equipment/:id by owner1 (item owner) -> 200
    const res16 = await fetch(`${baseUrl}/equipment/${createdEquipmentId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${owner1Token}` },
    });
    const data16 = await res16.json();
    assert(res16.status === 200, 'DELETE /equipment/:id by item owner returns 200');
    assert(data16.deletedId === createdEquipmentId, 'Returns deletedId');

    // 17. GET /equipment/mine now returns empty for owner1
    const res17 = await fetch(`${baseUrl}/equipment/mine`, {
      headers: { Authorization: `Bearer ${owner1Token}` },
    });
    const data17 = await res17.json();
    assert(data17.equipment.length === 0, 'Equipment confirmed deleted from mine');

  } finally {
    server.close();
  }

  console.log(`\nEquipment Owner Route Tests finished: ${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

runEquipmentTests().catch((err) => {
  console.error('Fatal error during equipment route tests:', err);
  if (server) server.close();
  process.exit(1);
});
