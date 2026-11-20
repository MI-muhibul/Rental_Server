import express, { Request, Response } from 'express';
import { generateKeyPair, exportJWK, SignJWT, createLocalJWKSet } from 'jose';
import http from 'http';
import env from './src/config';
import * as dbConfig from './src/config/db';
import { verifyToken, verifyRenter, verifyOwner, verifyAdmin, getJWKS, setJWKS } from './src/middlewares/auth.middleware';

async function runMiddlewareTests() {
  console.log('--- Starting Middleware Tests ---');
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

  const createMockRes = () => {
    const res: any = {};
    res.statusCode = 200;
    res.status = (code: number) => {
      res.statusCode = code;
      return res;
    };
    res.json = (data: any) => {
      res.body = data;
      return res;
    };
    return res;
  };

  // 1. Role Middlewares Unit Tests
  // verifyRenter with customer
  {
    const req: any = { user: { role: 'customer' } };
    const res = createMockRes();
    let nextCalled = false;
    verifyRenter(req, res, () => { nextCalled = true; });
    assert(nextCalled === true, 'verifyRenter allows role "customer"');
  }

  // verifyRenter with renter
  {
    const req: any = { user: { role: 'renter' } };
    const res = createMockRes();
    let nextCalled = false;
    verifyRenter(req, res, () => { nextCalled = true; });
    assert(nextCalled === true, 'verifyRenter allows role "renter"');
  }

  // verifyRenter with owner -> 403
  {
    const req: any = { user: { role: 'owner' } };
    const res = createMockRes();
    let nextCalled = false;
    verifyRenter(req, res, () => { nextCalled = true; });
    assert(!nextCalled && res.statusCode === 403 && res.body?.error === 'Forbidden: Access restricted to renters (customers)', 'verifyRenter rejects role "owner" with 403 and clear message');
  }

  // verifyOwner with owner
  {
    const req: any = { user: { role: 'owner' } };
    const res = createMockRes();
    let nextCalled = false;
    verifyOwner(req, res, () => { nextCalled = true; });
    assert(nextCalled === true, 'verifyOwner allows role "owner"');
  }

  // verifyOwner with customer -> 403
  {
    const req: any = { user: { role: 'customer' } };
    const res = createMockRes();
    let nextCalled = false;
    verifyOwner(req, res, () => { nextCalled = true; });
    assert(!nextCalled && res.statusCode === 403 && res.body?.error === 'Forbidden: Access restricted to equipment owners', 'verifyOwner rejects role "customer" with 403 and clear message');
  }

  // verifyAdmin with admin
  {
    const req: any = { user: { role: 'admin' } };
    const res = createMockRes();
    let nextCalled = false;
    verifyAdmin(req, res, () => { nextCalled = true; });
    assert(nextCalled === true, 'verifyAdmin allows role "admin"');
  }

  // verifyAdmin with owner -> 403
  {
    const req: any = { user: { role: 'owner' } };
    const res = createMockRes();
    let nextCalled = false;
    verifyAdmin(req, res, () => { nextCalled = true; });
    assert(!nextCalled && res.statusCode === 403 && res.body?.error === 'Forbidden: Access restricted to administrators', 'verifyAdmin rejects role "owner" with 403 and clear message');
  }

  // 2. Token verification error cases
  // Without token -> 401
  {
    const req: any = { headers: {} };
    const res = createMockRes();
    let nextCalled = false;
    await verifyToken(req, res, () => { nextCalled = true; });
    assert(!nextCalled && res.statusCode === 401 && res.body?.error?.includes('No token provided'), 'verifyToken returns 401 when no token is provided');
  }

  // With invalid token -> 401
  {
    const req: any = { headers: { authorization: 'Bearer invalid.token.here' } };
    const res = createMockRes();
    let nextCalled = false;
    await verifyToken(req, res, () => { nextCalled = true; });
    assert(!nextCalled && res.statusCode === 401, 'verifyToken returns 401 when invalid token is provided');
  }

  // 3. JWKS and DB User Loading Test
  console.log('\n--- Running JWKS and DB User Loading Test ---');
  // Generate RSA Key Pair
  const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true });
  const publicJwk = await exportJWK(publicKey);
  publicJwk.kid = 'test-key-id';
  publicJwk.alg = 'RS256';
  publicJwk.use = 'sig';

  // Use createLocalJWKSet to mock remote JWKS resolution for test
  const localJwkSet = createLocalJWKSet({ keys: [publicJwk] });
  setJWKS(localJwkSet as any, 'mock://jwks');

  // Mock collections getter for testing
  const mockUserDoc = {
    _id: '507f1f77bcf86cd799439011',
    id: 'user_123',
    name: 'Alice Tester',
    email: 'alice@example.com',
    role: 'owner',
  };

  dbConfig.setCollectionsGetter(async () => ({
    users: {
      findOne: async (query: any) => {
        if (
          query.email === 'alice@example.com' ||
          query._id?.toString() === '507f1f77bcf86cd799439011' ||
          query.id === 'user_123'
        ) {
          return mockUserDoc;
        }
        return null;
      },
    } as any,
    equipment: {} as any,
    bookings: {} as any,
    payments: {} as any,
    favorites: {} as any,
    reviews: {} as any,
  }));

  try {
    // Generate valid JWT signed with private key
    const validJwt = await new SignJWT({
      sub: '507f1f77bcf86cd799439011',
      email: 'alice@example.com',
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key-id' })
      .setIssuedAt()
      .setExpirationTime('2h')
      .sign(privateKey);

    // Verify token with valid JWT
    const req: any = {
      headers: {
        authorization: `Bearer ${validJwt}`,
      },
    };
    const res = createMockRes();
    let nextCalled = false;

    await verifyToken(req, res, () => {
      nextCalled = true;
    });



    assert(nextCalled === true, 'verifyToken successfully verified JWT via JWKS and called next()');
    assert(req.user?.role === 'owner', 'verifyToken loaded user role "owner" from users collection');
    assert(req.user?.email === 'alice@example.com', 'verifyToken loaded user email correctly');

    // Also verify owner middleware allows this user
    let ownerNextCalled = false;
    const ownerRes = createMockRes();
    verifyOwner(req, ownerRes, () => { ownerNextCalled = true; });
    assert(ownerNextCalled === true, 'verifyOwner allows req.user with role "owner"');

    // And verify admin rejects this user with 403
    let adminNextCalled = false;
    const adminRes = createMockRes();
    verifyAdmin(req, adminRes, () => { adminNextCalled = true; });
    assert(!adminNextCalled && adminRes.statusCode === 403 && adminRes.body?.error === 'Forbidden: Access restricted to administrators', 'verifyAdmin rejects "owner" with 403 clear message');

    // Test token when user not found in database -> 401
    const unknownJwt = await new SignJWT({
      sub: 'unknown_user_id',
      email: 'unknown@example.com',
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key-id' })
      .setIssuedAt()
      .setExpirationTime('2h')
      .sign(privateKey);

    const unknownReq: any = {
      headers: {
        authorization: `Bearer ${unknownJwt}`,
      },
    };
    const unknownRes = createMockRes();
    let unknownNext = false;
    await verifyToken(unknownReq, unknownRes, () => { unknownNext = true; });
    assert(!unknownNext && unknownRes.statusCode === 401 && unknownRes.body?.error?.includes('User not found'), 'verifyToken returns 401 when user is not found in database');

  } finally {
    setJWKS(null);
    dbConfig.setCollectionsGetter(null);
  }

  console.log(`\nAll Tests finished: ${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

runMiddlewareTests().catch(console.error);
