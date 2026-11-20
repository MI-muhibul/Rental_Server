import app from './src/app';
import { Server } from 'http';
import { generateKeyPair, exportJWK, SignJWT, createLocalJWKSet } from 'jose';
import * as dbConfig from './src/config/db';
import { setJWKS } from './src/middlewares/auth.middleware';
import { User } from './src/types/models';

let server: Server;

async function runRouteTests() {
  console.log('--- Starting User Routes End-to-End Tests ---');
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

  const mockUsersCollection = {
    findOneAndUpdate: async (filter: any, update: any, options?: any) => {
      let user: User | undefined;

      if (filter.email) {
        user = Array.from(usersDatabase.values()).find((u) => u.email === filter.email);
      } else if (filter.$or) {
        for (const cond of filter.$or) {
          const val = cond._id?.toString() || cond.id;
          if (val && usersDatabase.has(val)) {
            user = usersDatabase.get(val);
            break;
          }
        }
      }

      if (!user) {
        if (options?.upsert) {
          const newDoc: User = {
            _id: 'user_' + Date.now() + Math.random().toString(36).substring(2, 7),
            ...update.$setOnInsert,
            ...update.$set,
          };
          usersDatabase.set(newDoc._id!.toString(), newDoc);
          return newDoc;
        }
        return null;
      }

      // Update existing
      if (update.$set) {
        Object.assign(user, update.$set);
      }
      return { ...user };
    },
    findOne: async (filter: any) => {
      if (filter.email) {
        return Array.from(usersDatabase.values()).find((u) => u.email === filter.email) || null;
      }
      if (filter.$or) {
        for (const cond of filter.$or) {
          const val = cond._id?.toString() || cond.id;
          if (val && usersDatabase.has(val)) {
            return usersDatabase.get(val) || null;
          }
        }
      }
      return null;
    },
    find: (query: any) => ({
      skip: () => ({
        limit: () => ({
          sort: () => ({
            toArray: async () => Array.from(usersDatabase.values()),
          }),
        }),
      }),
    }),
    countDocuments: async () => usersDatabase.size,
    deleteOne: async (filter: any) => {
      let targetId: string | null = null;
      if (filter.$or) {
        for (const cond of filter.$or) {
          const val = cond._id?.toString() || cond.id;
          if (val && usersDatabase.has(val)) {
            targetId = val;
            break;
          }
        }
      }
      if (targetId && usersDatabase.has(targetId)) {
        usersDatabase.delete(targetId);
        return { deletedCount: 1 };
      }
      return { deletedCount: 0 };
    },
  };

  dbConfig.setCollectionsGetter(async () => ({
    users: mockUsersCollection as any,
    equipment: {} as any,
    bookings: {} as any,
    payments: {} as any,
    favorites: {} as any,
    reviews: {} as any,
  }));

  // Setup Mock JWKS
  const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true });
  const publicJwk = await exportJWK(publicKey);
  publicJwk.kid = 'route-test-key';
  publicJwk.alg = 'RS256';
  publicJwk.use = 'sig';

  const localJwkSet = createLocalJWKSet({ keys: [publicJwk] });
  setJWKS(localJwkSet as any);

  // Helper to create JWT tokens
  const signTestToken = async (userId: string, email: string) => {
    return new SignJWT({ sub: userId, email })
      .setProtectedHeader({ alg: 'RS256', kid: 'route-test-key' })
      .setIssuedAt()
      .setExpirationTime('2h')
      .sign(privateKey);
  };

  // Seed Admin and Regular Customer
  const adminId = 'admin_001';
  const customerId = 'customer_001';
  usersDatabase.set(adminId, {
    _id: adminId,
    id: adminId,
    name: 'Admin User',
    email: 'admin@rental.com',
    role: 'admin',
  });
  usersDatabase.set(customerId, {
    _id: customerId,
    id: customerId,
    name: 'Regular Customer',
    email: 'customer@rental.com',
    role: 'customer',
  });

  const adminToken = await signTestToken(adminId, 'admin@rental.com');
  const customerToken = await signTestToken(customerId, 'customer@rental.com');

  server = app.listen(5006);
  const baseUrl = 'http://localhost:5006';

  try {
    // --- 1. POST /users ---
    // 1a. Missing email -> 400
    const postNoEmail = await fetch(`${baseUrl}/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'No Email' }),
    });
    assert(postNoEmail.status === 400, 'POST /users without email returns 400');

    // 1b. Upsert new user -> defaults role to "customer"
    const postNewUser = await fetch(`${baseUrl}/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'newuser@rental.com',
        name: 'New Registered User',
        phone: '123-456-7890',
        address: '123 Test St',
      }),
    });
    assert(postNewUser.status === 200, 'POST /users creates/upserts user successfully (200)');
    const postNewUserData = await postNewUser.json();
    assert(postNewUserData.user?.role === 'customer', 'POST /users assigns default role "customer"');
    assert(postNewUserData.user?.email === 'newuser@rental.com', 'POST /users sets user email');

    // --- 2. GET /users/me ---
    // 2a. Without auth -> 401
    const getMeNoAuth = await fetch(`${baseUrl}/users/me`);
    assert(getMeNoAuth.status === 401, 'GET /users/me without auth returns 401');

    // 2b. With valid customer token -> 200
    const getMeAuth = await fetch(`${baseUrl}/users/me`, {
      headers: { Authorization: `Bearer ${customerToken}` },
    });
    assert(getMeAuth.status === 200, 'GET /users/me with token returns 200');
    const getMeData = await getMeAuth.json();
    assert(getMeData.user?.email === 'customer@rental.com', 'GET /users/me returns authenticated user details');

    // --- 3. PATCH /users/me ---
    // 3a. Without auth -> 401
    const patchMeNoAuth = await fetch(`${baseUrl}/users/me`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Changed' }),
    });
    assert(patchMeNoAuth.status === 401, 'PATCH /users/me without auth returns 401');

    // 3b. Update name, photo, phone, address
    const patchMeAuth = await fetch(`${baseUrl}/users/me`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${customerToken}`,
      },
      body: JSON.stringify({
        name: 'Updated Customer Name',
        photo: 'https://example.com/avatar.jpg',
        phone: '555-0199',
        address: '456 Updated Way',
      }),
    });
    assert(patchMeAuth.status === 200, 'PATCH /users/me updates profile (200)');
    const patchMeData = await patchMeAuth.json();
    assert(patchMeData.user?.name === 'Updated Customer Name', 'PATCH /users/me updated name');
    assert(patchMeData.user?.photo === 'https://example.com/avatar.jpg', 'PATCH /users/me updated photo');
    assert(patchMeData.user?.phone === '555-0199', 'PATCH /users/me updated phone');
    assert(patchMeData.user?.address === '456 Updated Way', 'PATCH /users/me updated address');

    // --- 4. GET /users (admin only) ---
    // 4a. Without auth -> 401
    const getAllNoAuth = await fetch(`${baseUrl}/users`);
    assert(getAllNoAuth.status === 401, 'GET /users without auth returns 401');

    // 4b. With customer token -> 403 Forbidden
    const getAllCustomer = await fetch(`${baseUrl}/users`, {
      headers: { Authorization: `Bearer ${customerToken}` },
    });
    assert(getAllCustomer.status === 403, 'GET /users for non-admin returns 403 Forbidden');

    // 4c. With admin token -> 200
    const getAllAdmin = await fetch(`${baseUrl}/users`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(getAllAdmin.status === 200, 'GET /users for admin returns 200');
    const getAllAdminData = await getAllAdmin.json();
    assert(Array.isArray(getAllAdminData.users) && getAllAdminData.total >= 2, 'GET /users returns users array');

    // --- 5. PATCH /users/:id/role (admin only, validate customer/owner/admin) ---
    // 5a. Without auth -> 401
    const patchRoleNoAuth = await fetch(`${baseUrl}/users/${customerId}/role`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'owner' }),
    });
    assert(patchRoleNoAuth.status === 401, 'PATCH /users/:id/role without auth returns 401');

    // 5b. With customer token -> 403 Forbidden
    const patchRoleCustomer = await fetch(`${baseUrl}/users/${customerId}/role`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${customerToken}`,
      },
      body: JSON.stringify({ role: 'owner' }),
    });
    assert(patchRoleCustomer.status === 403, 'PATCH /users/:id/role for non-admin returns 403');

    // 5c. Admin with invalid role -> 400
    const patchRoleInvalid = await fetch(`${baseUrl}/users/${customerId}/role`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ role: 'superhero' }),
    });
    assert(patchRoleInvalid.status === 400, 'PATCH /users/:id/role with invalid role returns 400');
    const patchRoleInvalidData = await patchRoleInvalid.json();
    assert(patchRoleInvalidData.error?.includes('customer, owner, admin'), 'Validation message lists allowed roles');

    // 5d. Admin updates role to "owner" -> 200
    const patchRoleSuccess = await fetch(`${baseUrl}/users/${customerId}/role`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ role: 'owner' }),
    });
    assert(patchRoleSuccess.status === 200, 'PATCH /users/:id/role with valid role returns 200');
    const patchRoleSuccessData = await patchRoleSuccess.json();
    assert(patchRoleSuccessData.user?.role === 'owner', 'Target user role updated to "owner"');

    // --- 6. DELETE /users/:id (admin only) ---
    // 6a. Without auth -> 401
    const deleteNoAuth = await fetch(`${baseUrl}/users/${customerId}`, {
      method: 'DELETE',
    });
    assert(deleteNoAuth.status === 401, 'DELETE /users/:id without auth returns 401');

    // 6b. With customer token -> 403 Forbidden
    const deleteCustomer = await fetch(`${baseUrl}/users/${customerId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${customerToken}` },
    });
    assert(deleteCustomer.status === 403, 'DELETE /users/:id for non-admin returns 403');

    // 6c. Admin deleting self -> 400
    const deleteAdminSelf = await fetch(`${baseUrl}/users/${adminId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(deleteAdminSelf.status === 400, 'Admin cannot delete their own account (400)');

    // 6d. Admin deleting customer -> 200
    const deleteAdminSuccess = await fetch(`${baseUrl}/users/${customerId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(deleteAdminSuccess.status === 200, 'Admin deletes user successfully (200)');
    const deleteAdminSuccessData = await deleteAdminSuccess.json();
    assert(deleteAdminSuccessData.deletedId === customerId, 'Correct deletedId returned');

  } finally {
    setJWKS(null);
    dbConfig.setCollectionsGetter(null);
    server.close();
  }

  console.log(`\nRoute Tests finished: ${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

runRouteTests().catch(console.error);
