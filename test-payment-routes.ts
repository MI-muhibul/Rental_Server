import app from './src/app';
import { Server } from 'http';
import { generateKeyPair, exportJWK, SignJWT, createLocalJWKSet } from 'jose';
import * as dbConfig from './src/config/db';
import { setJWKS } from './src/middlewares/auth.middleware';
import { setStripeClient } from './src/config/stripe';
import { User, Equipment, Booking, Payment } from './src/types/models';

let server: Server;

async function runPaymentTests() {
  console.log('--- Starting Stripe Checkout & Payment Confirmation End-to-End Tests ---');
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
  };

  const mockEquipmentCollection = {
    findOne: async (filter: any) => {
      const targetId = filter.$or
        ? filter.$or.map((f: any) => f._id?.toString() || f.id).find(Boolean)
        : filter._id?.toString() || filter.id;

      if (targetId && equipmentDatabase.has(targetId)) {
        return equipmentDatabase.get(targetId) || null;
      }
      return null;
    },
  };

  const mockBookingsCollection = {
    find: (filter: any) => {
      let items = Array.from(bookingsDatabase.values());
      if (filter.$and) {
        const eqClause = filter.$and[0];
        const startClause = filter.$and[1];
        const endClause = filter.$and[2];

        items = items.filter((b) => {
          const eqMatch = eqClause.$or.some((c: any) => {
            const eid = c.equipmentId?.toString();
            return b.equipmentId?.toString() === eid;
          });
          if (!eqMatch) return false;

          if (startClause.startDate?.$lte && new Date(b.startDate) > new Date(startClause.startDate.$lte)) {
            return false;
          }
          if (endClause.endDate?.$gte && new Date(b.endDate) < new Date(endClause.endDate.$gte)) {
            return false;
          }

          const isPaid =
            ['confirmed', 'paid', 'completed'].includes(b.status) || b.paymentStatus === 'paid';
          if (!isPaid) return false;

          if (['cancelled', 'rejected'].includes(b.status)) return false;

          return true;
        });
      }
      return {
        toArray: async () => items,
      };
    },
    findOne: async (filter: any) => {
      if (filter.$or) {
        for (const clause of filter.$or) {
          const id = clause._id?.toString() || clause.stripeSessionId || clause.transactionId;
          for (const b of bookingsDatabase.values()) {
            if (b._id?.toString() === id || b.stripeSessionId === id || b.transactionId === id) {
              return b;
            }
          }
        }
      }
      return null;
    },
    insertOne: async (doc: any) => {
      const id = 'bkg_' + Math.random().toString(36).substring(2, 9);
      const saved = { ...doc, _id: id };
      bookingsDatabase.set(id, saved);
      return { insertedId: id };
    },
  };

  const mockPaymentsCollection = {
    findOne: async (filter: any) => {
      if (filter.$or) {
        for (const clause of filter.$or) {
          const target = clause.transactionId || clause.stripeSessionId;
          for (const p of paymentsDatabase.values()) {
            if (p.transactionId === target || p.stripeSessionId === target) {
              return p;
            }
          }
        }
      }
      return null;
    },
    insertOne: async (doc: any) => {
      const id = 'pay_' + Math.random().toString(36).substring(2, 9);
      const saved = { ...doc, _id: id };
      paymentsDatabase.set(id, saved);
      return { insertedId: id };
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

  // Setup mock Stripe sessions store
  const mockStripeSessions: Map<string, any> = new Map();

  const mockStripeClient = {
    checkout: {
      sessions: {
        create: async (params: any) => {
          const id = 'cs_test_' + Math.random().toString(36).substring(2, 10);
          const session = {
            id,
            url: `https://checkout.stripe.com/pay/${id}`,
            payment_status: 'unpaid',
            payment_intent: 'pi_test_' + Math.random().toString(36).substring(2, 10),
            amount_total: params.line_items.reduce(
              (acc: number, item: any) => acc + item.price_data.unit_amount * item.quantity,
              0
            ),
            currency: 'usd',
            metadata: params.metadata,
          };
          mockStripeSessions.set(id, session);
          return session;
        },
        retrieve: async (id: string) => {
          return mockStripeSessions.get(id) || null;
        },
      },
    },
  };

  setStripeClient(mockStripeClient);

  // Setup Jose JWKS mock
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = await exportJWK(publicKey);
  jwk.kid = 'test-payment-kid';
  jwk.alg = 'RS256';
  jwk.use = 'sig';

  const mockJWKS = createLocalJWKSet({ keys: [jwk] });
  setJWKS(mockJWKS);

  async function createToken(sub: string, email: string) {
    return await new SignJWT({ email })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-payment-kid' })
      .setSubject(sub)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(privateKey);
  }

  // Prepopulate test users
  const customerUser: User = {
    id: 'user_cust_pay',
    _id: 'user_cust_pay' as any,
    name: 'Customer Colin',
    email: 'colin@test.com',
    role: 'customer',
  };
  const ownerUser: User = {
    id: 'user_owner_pay',
    _id: 'user_owner_pay' as any,
    name: 'Owner Oscar',
    email: 'oscar@test.com',
    role: 'owner',
  };

  usersDatabase.set('user_cust_pay', customerUser);
  usersDatabase.set('user_owner_pay', ownerUser);

  const customerToken = await createToken('user_cust_pay', 'colin@test.com');
  const ownerToken = await createToken('user_owner_pay', 'oscar@test.com');

  // Prepopulate test equipment with quantity = 2
  const sampleEquipment: Equipment = {
    _id: 'eq_skid_1' as any,
    id: 'eq_skid_1',
    name: 'Bobcat Skid Steer S70',
    description: 'Compact skid steer loader',
    category: 'Earthmoving',
    location: 'Denver, CO',
    price: 200,
    rentalType: 'daily',
    quantity: 2,
    condition: 'Excellent',
    brand: 'Bobcat',
    model: 'S70',
    image: 'https://example.com/bobcat.jpg',
    terms: 'Standard terms',
    status: 'approved',
    ownerId: 'user_owner_pay',
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  };

  equipmentDatabase.set('eq_skid_1', sampleEquipment);

  const port = await new Promise<number>((resolve) => {
    server = app.listen(0, () => {
      resolve((server.address() as any).port);
    });
  });

  const baseUrl = `http://localhost:${port}`;

  try {
    // 1. POST /payments/checkout-session without auth -> 401
    const res1 = await fetch(`${baseUrl}/payments/checkout-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        equipmentId: 'eq_skid_1',
        startDate: '2026-07-01',
        endDate: '2026-07-03',
      }),
    });
    assert(res1.status === 401, 'POST /payments/checkout-session without auth returns 401');

    // 2. POST /payments/checkout-session with owner token -> 403
    const res2 = await fetch(`${baseUrl}/payments/checkout-session`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ownerToken}`,
      },
      body: JSON.stringify({
        equipmentId: 'eq_skid_1',
        startDate: '2026-07-01',
        endDate: '2026-07-03',
      }),
    });
    assert(res2.status === 403, 'POST /payments/checkout-session with owner token returns 403');

    // 3. POST /payments/checkout-session with missing fields -> 400
    const res3 = await fetch(`${baseUrl}/payments/checkout-session`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${customerToken}`,
      },
      body: JSON.stringify({ equipmentId: 'eq_skid_1' }),
    });
    assert(res3.status === 400, 'POST /payments/checkout-session without dates returns 400');

    // 4. POST /payments/checkout-session with requested quantity > total quantity -> 400
    const res4 = await fetch(`${baseUrl}/payments/checkout-session`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${customerToken}`,
      },
      body: JSON.stringify({
        equipmentId: 'eq_skid_1',
        startDate: '2026-07-01',
        endDate: '2026-07-04',
        quantity: 5, // total is 2
      }),
    });
    assert(res4.status === 400, 'Re-validation: requested quantity exceeding inventory returns 400');

    // 5. POST /payments/checkout-session with valid request -> 200, returns URL & sessionId
    const res5 = await fetch(`${baseUrl}/payments/checkout-session`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${customerToken}`,
      },
      body: JSON.stringify({
        equipmentId: 'eq_skid_1',
        startDate: '2026-07-01',
        endDate: '2026-07-04',
        quantity: 1, // 3 days @ $200 = $600
      }),
    });
    const data5 = await res5.json();
    assert(res5.status === 200, 'POST /payments/checkout-session returns 200');
    assert(typeof data5.url === 'string' && data5.url.startsWith('https://checkout.stripe.com/'), 'Returns valid Stripe checkout URL');
    assert(typeof data5.sessionId === 'string', 'Returns sessionId');
    assert(data5.total === 600, `Returns calculated total 600 (got ${data5.total})`);

    const createdSessionId = data5.sessionId;
    const sessionObj = mockStripeSessions.get(createdSessionId);
    assert(sessionObj.metadata.equipmentId === 'eq_skid_1', 'Stripe session metadata includes equipmentId');
    assert(sessionObj.metadata.userId === 'user_cust_pay', 'Stripe session metadata includes userId');
    assert(sessionObj.metadata.totalPrice === '600', 'Stripe session metadata includes totalPrice');

    // 6. GET /payments/confirm without session_id -> 400
    const res6 = await fetch(`${baseUrl}/payments/confirm`);
    assert(res6.status === 400, 'GET /payments/confirm without session_id returns 400');

    // 7. GET /payments/confirm when session is unpaid -> 400
    const res7 = await fetch(`${baseUrl}/payments/confirm?session_id=${createdSessionId}`);
    assert(res7.status === 400, 'GET /payments/confirm for unpaid session returns 400');

    // Simulate customer completing payment on Stripe
    sessionObj.payment_status = 'paid';

    // 8. GET /payments/confirm when session is paid -> creates booking & payment record
    const res8 = await fetch(`${baseUrl}/payments/confirm?session_id=${createdSessionId}`);
    const data8 = await res8.json();
    assert(res8.status === 200, 'GET /payments/confirm for paid session returns 200');
    assert(data8.success === true, 'Response indicates success');
    assert(data8.alreadyProcessed === false, 'Indicates not already processed (first time)');
    assert(data8.booking !== undefined, 'Booking object returned');
    assert(data8.booking.status === 'confirmed', 'Booking status is "confirmed"');
    assert(data8.booking.paymentStatus === 'paid', 'Booking paymentStatus is "paid"');
    assert(data8.booking.totalPrice === 600, 'Booking totalPrice is 600');
    assert(data8.payment !== undefined, 'Payment object returned');
    assert(data8.payment.transactionId === sessionObj.payment_intent, 'Payment transactionId recorded');
    assert(data8.payment.amount === 600, 'Payment amount is 600');
    assert(data8.payment.currency === 'USD', 'Payment currency is USD');
    assert(data8.payment.date !== undefined, 'Payment date is recorded');

    // Verify records exist in databases
    assert(bookingsDatabase.size === 1, '1 booking saved in database');
    assert(paymentsDatabase.size === 1, '1 payment record saved in database');

    // 9. IDEMPOTENCY TEST: Call GET /payments/confirm a second time with the SAME session_id
    const res9 = await fetch(`${baseUrl}/payments/confirm?session_id=${createdSessionId}`);
    const data9 = await res9.json();
    assert(res9.status === 200, 'Second confirm call returns 200');
    assert(data9.alreadyProcessed === true, 'Second confirm indicates alreadyProcessed: true');
    assert(data9.booking !== undefined, 'Returns existing booking');
    assert(data9.payment !== undefined, 'Returns existing payment');
    assert(bookingsDatabase.size === 1, 'Idempotency: No duplicate booking created (still 1)');
    assert(paymentsDatabase.size === 1, 'Idempotency: No duplicate payment created (still 1)');

    // 10. Re-validation test: Now that 1 item is booked for July 1-4, available is 1 (2 - 1 = 1)
    // Trying to book 2 items for the same dates should fail re-validation
    const res10 = await fetch(`${baseUrl}/payments/checkout-session`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${customerToken}`,
      },
      body: JSON.stringify({
        equipmentId: 'eq_skid_1',
        startDate: '2026-07-02',
        endDate: '2026-07-04',
        quantity: 2, // Only 1 is available now!
      }),
    });
    assert(res10.status === 400, 'Re-validation: fails when newly confirmed booking exhausts available inventory');

  } finally {
    server.close();
  }

  console.log(`\nStripe Payment Route Tests finished: ${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

runPaymentTests().catch((err) => {
  console.error('Fatal error during payment route tests:', err);
  if (server) server.close();
  process.exit(1);
});
