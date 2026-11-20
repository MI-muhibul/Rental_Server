import app from './src/app';
import { Server } from 'http';
import { generateKeyPair, exportJWK, SignJWT, createLocalJWKSet } from 'jose';
import * as dbConfig from './src/config/db';
import { setJWKS } from './src/middlewares/auth.middleware';
import { User, Equipment, Favorite } from './src/types/models';

let server: Server;

async function runFavoriteTests() {
  console.log('--- Starting Customer Favorite Routes End-to-End Tests ---');
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
  const favoritesDatabase: Map<string, Favorite> = new Map();

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
  };

  const mockFavoritesCollection = {
    findOne: async (filter: any) => {
      for (const fav of favoritesDatabase.values()) {
        if (filter.$and) {
          const userClause = filter.$and[0];
          const eqClause = filter.$and[1];

          const userMatch = userClause.$or.some((u: any) => {
            const uid = u.userId?.toString();
            return fav.userId.toString() === uid;
          });

          const eqMatch = eqClause.$or.some((e: any) => {
            const eid = e.equipmentId?.toString();
            return fav.equipmentId.toString() === eid;
          });

          if (userMatch && eqMatch) return fav;
        }
      }
      return null;
    },
    insertOne: async (doc: any) => {
      const id = 'fav_' + Math.random().toString(36).substring(2, 9);
      const saved = { ...doc, _id: id };
      favoritesDatabase.set(id, saved);
      return { insertedId: id };
    },
    find: (filter: any) => {
      let items = Array.from(favoritesDatabase.values());
      if (filter && filter.$or) {
        items = items.filter((fav) => {
          return filter.$or.some((clause: any) => {
            const uid = clause.userId?.toString();
            return fav.userId.toString() === uid;
          });
        });
      }
      return {
        sort: () => ({
          toArray: async () => items,
        }),
      };
    },
    deleteOne: async (filter: any) => {
      if (filter.$and) {
        const userClause = filter.$and[0];
        const eqClause = filter.$and[1];

        for (const [key, fav] of favoritesDatabase.entries()) {
          const userMatch = userClause.$or.some((u: any) => {
            const uid = u.userId?.toString();
            return fav.userId.toString() === uid;
          });

          const eqMatch = eqClause.$or.some((e: any) => {
            const eid = e.equipmentId?.toString();
            const fid = e._id?.toString();
            return fav.equipmentId.toString() === eid || fav._id?.toString() === fid;
          });

          if (userMatch && eqMatch) {
            favoritesDatabase.delete(key);
            return { deletedCount: 1 };
          }
        }
      }
      return { deletedCount: 0 };
    },
  };

  dbConfig.setCollectionsGetter(async () => {
    return {
      users: mockUsersCollection as any,
      equipment: mockEquipmentCollection as any,
      favorites: mockFavoritesCollection as any,
      bookings: {} as any,
      payments: {} as any,
      reviews: {} as any,
    };
  });

  // Setup Jose JWKS mock
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = await exportJWK(publicKey);
  jwk.kid = 'test-fav-kid';
  jwk.alg = 'RS256';
  jwk.use = 'sig';

  const mockJWKS = createLocalJWKSet({ keys: [jwk] });
  setJWKS(mockJWKS);

  async function createToken(sub: string, email: string) {
    return await new SignJWT({ email })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-fav-kid' })
      .setSubject(sub)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(privateKey);
  }

  // Prepopulate test users
  const customerUser: User = {
    id: 'user_cust_1',
    _id: 'user_cust_1' as any,
    name: 'Customer Clara',
    email: 'clara@test.com',
    role: 'customer',
  };
  const ownerUser: User = {
    id: 'user_owner_1',
    _id: 'user_owner_1' as any,
    name: 'Owner Otto',
    email: 'otto@test.com',
    role: 'owner',
  };

  usersDatabase.set('user_cust_1', customerUser);
  usersDatabase.set('user_owner_1', ownerUser);

  const customerToken = await createToken('user_cust_1', 'clara@test.com');
  const ownerToken = await createToken('user_owner_1', 'otto@test.com');

  // Prepopulate test equipment
  const sampleEquipment: Equipment = {
    _id: 'eq_fav_1' as any,
    id: 'eq_fav_1',
    name: 'Compact Mini Excavator 3000',
    description: 'Powerful mini excavator for excavation and landscaping',
    category: 'Heavy Machinery',
    location: 'Austin, TX',
    price: 320,
    rentalType: 'daily',
    quantity: 2,
    condition: 'Excellent',
    brand: 'Kubota',
    model: 'KX033',
    image: 'https://example.com/kubota.jpg',
    terms: 'Operator license required',
    status: 'approved',
    ownerId: 'user_owner_1',
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  };

  equipmentDatabase.set('eq_fav_1', sampleEquipment);

  const port = await new Promise<number>((resolve) => {
    server = app.listen(0, () => {
      resolve((server.address() as any).port);
    });
  });

  const baseUrl = `http://localhost:${port}`;

  try {
    // 1. POST /favorites without auth -> 401
    const res1 = await fetch(`${baseUrl}/favorites`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ equipmentId: 'eq_fav_1' }),
    });
    assert(res1.status === 401, 'POST /favorites without auth returns 401');

    // 2. POST /favorites with owner token -> 403 (verifyRenter blocks owners)
    const res2 = await fetch(`${baseUrl}/favorites`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ownerToken}`,
      },
      body: JSON.stringify({ equipmentId: 'eq_fav_1' }),
    });
    assert(res2.status === 403, 'POST /favorites with owner token returns 403');

    // 3. POST /favorites without equipmentId -> 400
    const res3 = await fetch(`${baseUrl}/favorites`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${customerToken}`,
      },
      body: JSON.stringify({}),
    });
    assert(res3.status === 400, 'POST /favorites without equipmentId returns 400');

    // 4. POST /favorites with non-existent equipmentId -> 404
    const res4 = await fetch(`${baseUrl}/favorites`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${customerToken}`,
      },
      body: JSON.stringify({ equipmentId: 'non_existent_eq' }),
    });
    assert(res4.status === 404, 'POST /favorites with unknown equipmentId returns 404');

    // 5. POST /favorites with valid equipmentId -> 201
    const res5 = await fetch(`${baseUrl}/favorites`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${customerToken}`,
      },
      body: JSON.stringify({ equipmentId: 'eq_fav_1' }),
    });
    const data5 = await res5.json();
    assert(res5.status === 201, 'POST /favorites returns 201 Created');
    assert(data5.favorite !== undefined, 'Favorite object returned');
    assert(data5.favorite.equipmentId === 'eq_fav_1', 'Favorite has correct equipmentId');
    assert(data5.favorite.equipment.name === 'Compact Mini Excavator 3000', 'Favorite response includes equipment info');

    // 6. POST /favorites duplicate check -> 409 Conflict
    const res6 = await fetch(`${baseUrl}/favorites`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${customerToken}`,
      },
      body: JSON.stringify({ equipmentId: 'eq_fav_1' }),
    });
    const data6 = await res6.json();
    assert(res6.status === 409, 'Duplicate POST /favorites returns 409 Conflict');
    assert(data6.error.includes('already in your favorites'), 'Duplicate error message indicates already in favorites');

    // 7. GET /favorites without auth -> 401
    const res7 = await fetch(`${baseUrl}/favorites`);
    assert(res7.status === 401, 'GET /favorites without auth returns 401');

    // 8. GET /favorites with owner token -> 403
    const res8 = await fetch(`${baseUrl}/favorites`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(res8.status === 403, 'GET /favorites with owner token returns 403');

    // 9. GET /favorites with customer token -> 200 with equipment details populated
    const res9 = await fetch(`${baseUrl}/favorites`, {
      headers: { Authorization: `Bearer ${customerToken}` },
    });
    const data9 = await res9.json();
    assert(res9.status === 200, 'GET /favorites returns 200');
    assert(Array.isArray(data9.favorites), 'data.favorites is an array');
    assert(data9.total === 1, 'Total favorites is 1');
    assert(data9.favorites[0].equipmentId === 'eq_fav_1', 'Favorite equipmentId matches');
    assert(data9.favorites[0].equipment !== null, 'Equipment details are populated');
    assert(data9.favorites[0].equipment.name === 'Compact Mini Excavator 3000', 'Populated equipment name is correct');
    assert(data9.favorites[0].equipment.price === 320, 'Populated equipment price is correct');

    // 10. DELETE /favorites/:equipmentId without auth -> 401
    const res10 = await fetch(`${baseUrl}/favorites/eq_fav_1`, {
      method: 'DELETE',
    });
    assert(res10.status === 401, 'DELETE /favorites/:equipmentId without auth returns 401');

    // 11. DELETE /favorites/:equipmentId with owner token -> 403
    const res11 = await fetch(`${baseUrl}/favorites/eq_fav_1`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(res11.status === 403, 'DELETE /favorites/:equipmentId with owner token returns 403');

    // 12. DELETE /favorites/:equipmentId for non-favorited item -> 404
    const res12 = await fetch(`${baseUrl}/favorites/other_eq`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${customerToken}` },
    });
    assert(res12.status === 404, 'DELETE non-existent favorite returns 404');

    // 13. DELETE /favorites/:equipmentId for favorited item -> 200
    const res13 = await fetch(`${baseUrl}/favorites/eq_fav_1`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${customerToken}` },
    });
    const data13 = await res13.json();
    assert(res13.status === 200, 'DELETE /favorites/:equipmentId returns 200');
    assert(data13.equipmentId === 'eq_fav_1', 'Deleted equipmentId returned');

    // 14. GET /favorites confirms favorite was removed -> 200 with 0 items
    const res14 = await fetch(`${baseUrl}/favorites`, {
      headers: { Authorization: `Bearer ${customerToken}` },
    });
    const data14 = await res14.json();
    assert(res14.status === 200, 'GET /favorites after delete returns 200');
    assert(data14.total === 0, 'Total favorites is now 0');
    assert(data14.favorites.length === 0, 'Favorites array is empty');

  } finally {
    server.close();
  }

  console.log(`\nCustomer Favorite Route Tests finished: ${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

runFavoriteTests().catch((err) => {
  console.error('Fatal error during favorite route tests:', err);
  if (server) server.close();
  process.exit(1);
});
