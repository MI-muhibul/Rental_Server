import { Server } from 'http';
import { generateKeyPair, exportJWK, SignJWT, createLocalJWKSet } from 'jose';
import * as fs from 'fs';
import * as path from 'path';
import * as dbConfig from './src/config/db';
import env from './src/config';
import { setJWKS } from './src/middlewares/auth.middleware';
import { setStripeClient } from './src/config/stripe';
import { setCustomTransporter } from './src/services/email.service';
import { User, Equipment, Booking, Payment, Favorite } from './src/types/models';

let server: Server;

async function runVercelTests() {
  console.log('--- Starting Vercel Serverless & Origin Route Tests ---');
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

  // 1. Verify vercel.json exists and is valid
  console.log('\n[Phase 1: vercel.json validation]');
  const vercelJsonPath = path.resolve(__dirname, 'vercel.json');
  assert(fs.existsSync(vercelJsonPath), 'vercel.json exists in server root');
  const vercelConfig = JSON.parse(fs.readFileSync(vercelJsonPath, 'utf8'));
  assert(vercelConfig.version === 2, 'vercel.json specifies version 2');
  assert(Array.isArray(vercelConfig.builds), 'vercel.json includes builds configuration');
  assert(Array.isArray(vercelConfig.routes), 'vercel.json includes routes configuration');
  assert(
    vercelConfig.routes.some((r: any) => r.src === '/(.*)'),
    'vercel.json routes all paths (/(.*)) to entry point'
  );
  assert(Array.isArray(vercelConfig.crons), 'vercel.json includes crons configuration');

  // 2. Verify serverless exports and no app.listen in serverless
  console.log('\n[Phase 2: Serverless Export validation]');
  process.env.VERCEL = '1'; // Simulate Vercel environment
  const importedIndex = await import('./src/index');
  assert(
    typeof importedIndex.default === 'function',
    'src/index.ts exports Express app as default export'
  );

  const importedApiIndex = await import('./api/index');
  assert(
    typeof importedApiIndex.default === 'function',
    'api/index.ts exports Express app as default export'
  );
  delete process.env.VERCEL;

  // 3. Setup mock database and dependencies
  const usersDatabase: Map<string, User> = new Map();
  const equipmentDatabase: Map<string, Equipment> = new Map();
  const bookingsDatabase: Map<string, Booking> = new Map();
  const paymentsDatabase: Map<string, Payment> = new Map();
  const favoritesDatabase: Map<string, Favorite> = new Map();

  const eqId1 = '507f1f77bcf86cd799439011';
  const userIdAdmin = '507f1f77bcf86cd799439021';
  const userIdOwner = '507f1f77bcf86cd799439022';
  const userIdRenter = '507f1f77bcf86cd799439023';

  const findUserByFilter = (filter: any) => {
    for (const u of usersDatabase.values()) {
      if (filter.$or) {
        const matches = filter.$or.some((sub: any) => {
          if (sub.email && u.email === sub.email) return true;
          if (sub.id && u.id === sub.id) return true;
          if (sub._id && (u._id?.toString() === sub._id.toString() || u.id === sub._id.toString())) return true;
          return false;
        });
        if (matches) return u;
      }
      if (filter.email && u.email === filter.email) return u;
      if (filter.id && u.id === filter.id) return u;
      if (filter._id && (u._id?.toString() === filter._id.toString() || u.id === filter._id.toString())) return u;
    }
    return null;
  };

  const createCursor = (items: any[]) => {
    return {
      sort: () => createCursor(items),
      skip: () => createCursor(items),
      limit: () => createCursor(items),
      toArray: async () => items,
    };
  };

  const mockUsersCollection = {
    findOne: async (filter: any) => findUserByFilter(filter),
    findOneAndUpdate: async (filter: any, update: any, options?: any) => {
      let u = findUserByFilter(filter);
      if (!u && options?.upsert) {
        const id = 'user-' + Date.now();
        u = {
          id,
          _id: id as any,
          email: filter.email,
          role: 'customer',
          createdAt: new Date(),
          updatedAt: new Date(),
          ...(update.$setOnInsert || {}),
          ...(update.$set || {}),
        };
        usersDatabase.set(id, u);
        return u;
      }
      if (u) {
        if (update.$set) Object.assign(u, update.$set);
        return u;
      }
      return null;
    },
    updateOne: async (filter: any, update: any) => {
      const u = findUserByFilter(filter);
      if (u) {
        if (update.$set) Object.assign(u, update.$set);
        return { modifiedCount: 1, matchedCount: 1 };
      }
      return { modifiedCount: 0, matchedCount: 0 };
    },
    countDocuments: async () => usersDatabase.size,
    find: (filter?: any) => createCursor(Array.from(usersDatabase.values())),
    deleteOne: async (filter: any) => {
      for (const [k, u] of usersDatabase.entries()) {
        if ((filter.id && u.id === filter.id) || (filter._id && (u._id?.toString() === filter._id.toString() || u.id === filter._id.toString()))) {
          usersDatabase.delete(k);
          return { deletedCount: 1 };
        }
      }
      return { deletedCount: 0 };
    },
  };

  const findEqByFilter = (filter: any) => {
    for (const eq of equipmentDatabase.values()) {
      if (filter.$or) {
        const matches = filter.$or.some((sub: any) => {
          if (sub._id && (eq._id?.toString() === sub._id.toString() || eq.id === sub._id.toString())) return true;
          if (sub.id && eq.id === sub.id) return true;
          return false;
        });
        if (matches) return eq;
      }
      if (filter._id && (eq._id?.toString() === filter._id.toString() || eq.id === filter._id.toString())) return eq;
      if (filter.id && eq.id === filter.id) return eq;
    }
    return null;
  };

  const mockEquipmentCollection = {
    findOne: async (filter: any) => findEqByFilter(filter),
    findOneAndUpdate: async (filter: any, update: any) => {
      const item = findEqByFilter(filter);
      if (item && update.$set) {
        Object.assign(item, update.$set);
        return item;
      }
      return null;
    },
    find: (filter: any) => {
      let items = Array.from(equipmentDatabase.values());
      if (filter && filter.status) {
        items = items.filter((e) => e.status === filter.status);
      }
      return createCursor(items);
    },
    countDocuments: async (filter?: any) => {
      let items = Array.from(equipmentDatabase.values());
      if (filter && filter.status) {
        items = items.filter((e) => e.status === filter.status);
      }
      return items.length;
    },
    insertOne: async (doc: Equipment) => {
      const id = doc.id || 'eq-' + Date.now();
      const item = { ...doc, id, _id: id as any };
      equipmentDatabase.set(id, item);
      return { insertedId: id };
    },
    updateOne: async (filter: any, update: any) => {
      const item = findEqByFilter(filter);
      if (item && update.$set) {
        Object.assign(item, update.$set);
        return { modifiedCount: 1, matchedCount: 1 };
      }
      return { modifiedCount: 0, matchedCount: 0 };
    },
    deleteOne: async (filter: any) => {
      for (const [k, eq] of equipmentDatabase.entries()) {
        if ((filter.id && eq.id === filter.id) || (filter._id && (eq._id?.toString() === filter._id.toString() || eq.id === filter._id.toString()))) {
          equipmentDatabase.delete(k);
          return { deletedCount: 1 };
        }
      }
      return { deletedCount: 0 };
    },
  };

  const mockBookingsCollection = {
    find: (filter: any) => createCursor(Array.from(bookingsDatabase.values())),
    countDocuments: async () => bookingsDatabase.size,
    insertOne: async (doc: Booking) => {
      const id = doc.id || 'bk-' + Date.now();
      bookingsDatabase.set(id, { ...doc, id, _id: id as any });
      return { insertedId: id };
    },
    aggregate: (pipeline: any[]) => ({
      toArray: async () => [
        { _id: null, totalEarnings: 1500 },
        { _id: { year: 2026, month: 11 }, count: 1, earnings: 1500 },
      ],
    }),
  };

  const mockPaymentsCollection = {
    find: () => createCursor(Array.from(paymentsDatabase.values())),
    findOne: async (filter: any) => {
      for (const p of paymentsDatabase.values()) {
        if (filter.transactionId && p.transactionId === filter.transactionId) return p;
        if (filter.id && p.id === filter.id) return p;
      }
      return null;
    },
    insertOne: async (doc: Payment) => {
      const id = doc.id || 'pm-' + Date.now();
      paymentsDatabase.set(id, { ...doc, id, _id: id as any });
      return { insertedId: id };
    },
    aggregate: (pipeline: any[]) => ({
      toArray: async () => [{ _id: null, totalRevenue: 1500 }],
    }),
  };

  const mockFavoritesCollection = {
    find: () => createCursor(Array.from(favoritesDatabase.values())),
    insertOne: async (doc: Favorite) => {
      const id = doc.id || 'fav-' + Date.now();
      favoritesDatabase.set(id, { ...doc, id, _id: id as any });
      return { insertedId: id };
    },
    findOne: async (filter: any) => {
      for (const f of favoritesDatabase.values()) {
        if (f.userId === filter.userId && f.equipmentId === filter.equipmentId) return f;
      }
      return null;
    },
    deleteOne: async (filter: any) => {
      for (const [k, f] of favoritesDatabase.entries()) {
        favoritesDatabase.delete(k);
        return { deletedCount: 1 };
      }
      return { deletedCount: 0 };
    },
  };

  dbConfig.setCollectionsGetter(async () => ({
    users: mockUsersCollection as any,
    equipment: mockEquipmentCollection as any,
    bookings: mockBookingsCollection as any,
    payments: mockPaymentsCollection as any,
    favorites: mockFavoritesCollection as any,
    reviews: {} as any,
  }));

  // Setup mock Stripe and nodemailer
  setStripeClient({
    checkout: {
      sessions: {
        create: async () => ({
          id: 'cs_test_session',
          url: 'https://checkout.stripe.com/pay/cs_test_session',
        }),
        retrieve: async () => ({
          id: 'cs_test_session',
          payment_status: 'paid',
          amount_total: 50000,
          currency: 'usd',
          payment_intent: 'pi_test_123',
          metadata: {
            equipmentId: eqId1,
            userId: userIdRenter,
            startDate: '2026-12-01T00:00:00.000Z',
            endDate: '2026-12-05T00:00:00.000Z',
            rentalType: 'daily',
            quantity: '1',
            totalPrice: '500',
          },
        }),
      },
    },
  });

  setCustomTransporter({
    sendMail: async () => ({ messageId: 'test-email-id' }),
  });

  // Setup JWKS Keys
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = await exportJWK(publicKey);
  jwk.kid = 'test-vercel-key-id';
  jwk.alg = 'RS256';
  setJWKS(createLocalJWKSet({ keys: [jwk] }));

  // Seed sample data
  const adminUser: User = {
    id: userIdAdmin,
    _id: userIdAdmin as any,
    email: 'admin@company.com',
    name: 'Admin Boss',
    role: 'admin',
    createdAt: new Date(),
  };
  const ownerUser: User = {
    id: userIdOwner,
    _id: userIdOwner as any,
    email: 'owner@equipment.com',
    name: 'Owner Bob',
    role: 'owner',
    createdAt: new Date(),
  };
  const renterUser: User = {
    id: userIdRenter,
    _id: userIdRenter as any,
    email: 'renter@customer.com',
    name: 'Renter Alice',
    role: 'customer',
    createdAt: new Date(),
  };
  usersDatabase.set(adminUser.id!, adminUser);
  usersDatabase.set(ownerUser.id!, ownerUser);
  usersDatabase.set(renterUser.id!, renterUser);

  const sampleEquipment: Equipment = {
    id: eqId1,
    _id: eqId1 as any,
    name: 'CAT Mini Excavator',
    description: 'High performance excavator',
    category: 'Earthmoving',
    rentalType: 'daily',
    price: 250,
    quantity: 2,
    location: 'Chicago, IL',
    images: ['https://example.com/cat.jpg'],
    ownerId: ownerUser.id!,
    owner: { id: ownerUser.id!, email: ownerUser.email, name: ownerUser.name },
    status: 'approved',
    createdAt: new Date(),
  };
  equipmentDatabase.set(sampleEquipment.id!, sampleEquipment);

  async function createToken(sub: string, email: string) {
    return new SignJWT({ email, name: 'User' })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-vercel-key-id' })
      .setSubject(sub)
      .setIssuedAt()
      .setExpirationTime('2h')
      .sign(privateKey);
  }

  const adminToken = await createToken(adminUser.id!, adminUser.email);
  const ownerToken = await createToken(ownerUser.id!, ownerUser.email);
  const renterToken = await createToken(renterUser.id!, renterUser.email);

  // Set deployed client origin in env
  const deployedClientOrigin = 'https://equipment-rental-client.vercel.app';
  env.CLIENT_URL = `${deployedClientOrigin},http://localhost:3000`;

  // Start server on dynamic port
  const app = importedIndex.default;
  server = app.listen(0);
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 5000;
  const baseUrl = `http://127.0.0.1:${port}`;

  console.log(`\n[Phase 3: Testing Routes & Preflight with Deployed Client Origin: ${deployedClientOrigin}]`);

  // Helper to make requests from deployed client origin
  async function testRoute(params: {
    name: string;
    method: string;
    path: string;
    token?: string;
    body?: any;
    expectedStatus?: number;
    origin?: string;
  }) {
    const origin = params.origin !== undefined ? params.origin : deployedClientOrigin;
    const headers: Record<string, string> = {};
    if (origin) {
      headers['Origin'] = origin;
    }
    if (params.token) {
      headers['Authorization'] = `Bearer ${params.token}`;
    }
    if (params.body) {
      headers['Content-Type'] = 'application/json';
    }

    const res = await fetch(`${baseUrl}${params.path}`, {
      method: params.method,
      headers,
      body: params.body ? JSON.stringify(params.body) : undefined,
    });

    const allowOrigin = res.headers.get('access-control-allow-origin');
    const allowCreds = res.headers.get('access-control-allow-credentials');

    if (params.expectedStatus !== undefined) {
      assert(
        res.status === params.expectedStatus,
        `${params.name} returned status ${res.status} (expected ${params.expectedStatus})`
      );
    } else {
      assert(
        res.status >= 200 && res.status < 400,
        `${params.name} returned success status ${res.status}`
      );
    }

    // CORS verification
    if (origin && origin === deployedClientOrigin) {
      assert(
        allowOrigin === deployedClientOrigin,
        `${params.name} set Access-Control-Allow-Origin: ${deployedClientOrigin}`
      );
      assert(
        allowCreds === 'true',
        `${params.name} set Access-Control-Allow-Credentials: true`
      );
    }

    return res;
  }

  // Preflight test (OPTIONS)
  const preflightRes = await fetch(`${baseUrl}/equipment`, {
    method: 'OPTIONS',
    headers: {
      'Origin': deployedClientOrigin,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'Authorization,Content-Type',
    },
  });
  assert(
    preflightRes.status === 200 || preflightRes.status === 204,
    `CORS Preflight (OPTIONS) returned ${preflightRes.status}`
  );
  assert(
    preflightRes.headers.get('access-control-allow-origin') === deployedClientOrigin,
    'Preflight returns Access-Control-Allow-Origin matching client origin'
  );
  assert(
    preflightRes.headers.get('access-control-allow-credentials') === 'true',
    'Preflight returns Access-Control-Allow-Credentials: true'
  );

  // Test every route
  // Health
  await testRoute({ name: 'GET /', method: 'GET', path: '/' });
  await testRoute({ name: 'GET /health', method: 'GET', path: '/health' });
  await testRoute({ name: 'GET /cron/daily', method: 'GET', path: '/cron/daily' });

  // Users
  await testRoute({
    name: 'POST /users',
    method: 'POST',
    path: '/users',
    body: { email: 'newrenter@test.com', name: 'New Renter' },
  });
  await testRoute({
    name: 'GET /users/me',
    method: 'GET',
    path: '/users/me',
    token: renterToken,
  });
  await testRoute({
    name: 'PATCH /users/me',
    method: 'PATCH',
    path: '/users/me',
    token: renterToken,
    body: { phone: '123456789' },
  });
  await testRoute({
    name: 'GET /users',
    method: 'GET',
    path: '/users',
    token: adminToken,
  });
  await testRoute({
    name: 'PATCH /users/:id/role',
    method: 'PATCH',
    path: `/users/${userIdRenter}/role`,
    token: adminToken,
    body: { role: 'customer' },
  });
  await testRoute({
    name: 'DELETE /users/:id',
    method: 'DELETE',
    path: `/users/507f1f77bcf86cd799439099`,
    token: adminToken,
    expectedStatus: 404,
  });

  // Equipment
  await testRoute({
    name: 'GET /equipment',
    method: 'GET',
    path: '/equipment?category=Earthmoving&search=CAT&sort=newest&page=1&limit=5',
  });
  await testRoute({
    name: 'GET /equipment/featured',
    method: 'GET',
    path: '/equipment/featured',
  });
  await testRoute({
    name: 'GET /equipment/mine',
    method: 'GET',
    path: '/equipment/mine',
    token: ownerToken,
  });
  await testRoute({
    name: 'POST /equipment',
    method: 'POST',
    path: '/equipment',
    token: ownerToken,
    body: {
      name: 'Plate Compactor',
      description: 'Heavy duty compactor',
      category: 'Compaction',
      rentalType: 'daily',
      price: 80,
      quantity: 3,
      location: 'Chicago, IL',
      condition: 'Excellent',
      brand: 'Caterpillar',
      model: 'PC-200',
      terms: 'Standard rental terms',
      images: ['https://example.com/compactor.jpg'],
    },
    expectedStatus: 201,
  });
  await testRoute({
    name: 'GET /equipment/:id',
    method: 'GET',
    path: `/equipment/${eqId1}`,
  });
  await testRoute({
    name: 'PATCH /equipment/:id',
    method: 'PATCH',
    path: `/equipment/${eqId1}`,
    token: ownerToken,
    body: { price: 275 },
  });
  await testRoute({
    name: 'DELETE /equipment/:id',
    method: 'DELETE',
    path: '/equipment/507f1f77bcf86cd799439099',
    token: ownerToken,
    expectedStatus: 404,
  });

  // Admin Equipment & Bookings
  await testRoute({
    name: 'GET /admin/equipment',
    method: 'GET',
    path: '/admin/equipment',
    token: adminToken,
  });
  await testRoute({
    name: 'PATCH /admin/equipment/:id/status',
    method: 'PATCH',
    path: `/admin/equipment/${eqId1}/status`,
    token: adminToken,
    body: { status: 'approved' },
  });
  await testRoute({
    name: 'PATCH /admin/equipment/:id',
    method: 'PATCH',
    path: `/admin/equipment/${eqId1}`,
    token: adminToken,
    body: { location: 'Chicago Downtown' },
  });
  await testRoute({
    name: 'GET /admin/bookings',
    method: 'GET',
    path: '/admin/bookings',
    token: adminToken,
  });

  // Favorites
  await testRoute({
    name: 'POST /favorites',
    method: 'POST',
    path: '/favorites',
    token: renterToken,
    body: { equipmentId: eqId1 },
    expectedStatus: 201,
  });
  await testRoute({
    name: 'GET /favorites',
    method: 'GET',
    path: '/favorites',
    token: renterToken,
  });
  await testRoute({
    name: 'DELETE /favorites/:equipmentId',
    method: 'DELETE',
    path: `/favorites/${eqId1}`,
    token: renterToken,
  });

  // Bookings
  await testRoute({
    name: 'POST /bookings/quote',
    method: 'POST',
    path: '/bookings/quote',
    body: {
      equipmentId: eqId1,
      startDate: '2026-12-01',
      endDate: '2026-12-05',
      rentalType: 'daily',
      quantity: 1,
    },
  });
  await testRoute({
    name: 'GET /bookings/mine',
    method: 'GET',
    path: '/bookings/mine',
    token: renterToken,
  });
  await testRoute({
    name: 'GET /bookings/owner',
    method: 'GET',
    path: '/bookings/owner',
    token: ownerToken,
  });

  // Payments
  await testRoute({
    name: 'POST /payments/checkout-session',
    method: 'POST',
    path: '/payments/checkout-session',
    token: renterToken,
    body: {
      equipmentId: eqId1,
      startDate: '2026-12-01',
      endDate: '2026-12-05',
      rentalType: 'daily',
      quantity: 1,
    },
  });
  await testRoute({
    name: 'GET /payments/confirm',
    method: 'GET',
    path: '/payments/confirm?session_id=cs_test_session',
  });

  // Analytics
  await testRoute({
    name: 'GET /analytics/admin',
    method: 'GET',
    path: '/analytics/admin',
    token: adminToken,
  });
  await testRoute({
    name: 'GET /analytics/owner',
    method: 'GET',
    path: '/analytics/owner',
    token: ownerToken,
  });

  // 4. Test 404 Route handling (Must return 404 JSON with CORS headers, never hang or return HTML)
  console.log('\n[Phase 4: 404 Route Handling & CORS Protection]');
  const res404 = await testRoute({
    name: 'GET /nonexistent-route',
    method: 'GET',
    path: '/nonexistent-route',
    expectedStatus: 404,
  });
  const data404 = await res404.json();
  assert(data404.success === false, '404 returns JSON with success: false');
  assert(
    data404.message && data404.message.includes('Cannot GET /nonexistent-route'),
    '404 returns structured message'
  );

  // 5. Test CORS Rejection for Unauthorized Origin
  console.log('\n[Phase 5: CORS Rejection for Unauthorized Origin]');
  const rejectedOrigin = 'https://unauthorized-evil-domain.com';
  const badCorsRes = await fetch(`${baseUrl}/equipment`, {
    method: 'GET',
    headers: {
      Origin: rejectedOrigin,
    },
  });
  assert(
    badCorsRes.status === 403,
    `Unauthorized origin rejected with 403 Forbidden (got ${badCorsRes.status})`
  );
  assert(
    badCorsRes.headers.get('access-control-allow-origin') === null,
    'Unauthorized origin did NOT receive Access-Control-Allow-Origin header'
  );

  // 6. Test 504 Gateway Timeout Prevention
  console.log('\n[Phase 6: 504 Gateway Timeout Protection]');
  const dbFileContent = fs.readFileSync(path.resolve(__dirname, 'src/config/db.ts'), 'utf8');
  assert(
    dbFileContent.includes('serverSelectionTimeoutMS: 5000'),
    'MongoClient configured with serverSelectionTimeoutMS: 5000 to prevent 504 gateway timeout'
  );
  assert(
    dbFileContent.includes('global._mongoClientPromise = undefined'),
    'MongoClient resets promise on connection failure to allow fresh reconnect'
  );

  server.close();
  console.log(`\nVercel Serverless & Origin Tests finished: ${passed} passed, ${failed} failed.`);

  if (failed > 0) {
    process.exit(1);
  }
}

runVercelTests().catch((err) => {
  console.error('Test suite failed:', err);
  if (server) server.close();
  process.exit(1);
});
