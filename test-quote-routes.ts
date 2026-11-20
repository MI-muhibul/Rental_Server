import app from './src/app';
import { Server } from 'http';
import * as dbConfig from './src/config/db';
import { Equipment, Booking } from './src/types/models';
import {
  calculateDuration,
  computeRentalTotal,
  calculateQuoteTotal,
} from './src/utils/pricing';

let server: Server;

async function runQuoteTests() {
  console.log('--- Starting Helper & Booking Quote End-to-End Tests ---');
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

  // --- Part 1: Pricing Helper Tests ---
  console.log('\n[Unit Tests: Pricing Helper Functions]');

  // Test 1: Daily rental calculation (price 100, 3 days, qty 2 -> 600)
  const dailyQuote = calculateQuoteTotal(100, '2026-06-01', '2026-06-04', 'daily', 2);
  assert(dailyQuote.days === 3, 'Daily quote calculates 3 days');
  assert(dailyQuote.duration === 3, 'Daily quote duration is 3');
  assert(dailyQuote.unit === 'days', 'Daily quote unit is days');
  assert(dailyQuote.total === 600, `Daily total = 100 * 3 * 2 = 600 (got ${dailyQuote.total})`);

  // Test 2: Weekly rental calculation (price 500, 14 days -> 2 weeks, qty 1 -> 1000)
  const weeklyQuote = calculateQuoteTotal(500, '2026-06-01', '2026-06-15', 'weekly', 1);
  assert(weeklyQuote.days === 14, 'Weekly quote calculates 14 days');
  assert(weeklyQuote.duration === 2, 'Weekly quote duration is 2 weeks');
  assert(weeklyQuote.unit === 'weeks', 'Weekly quote unit is weeks');
  assert(weeklyQuote.total === 1000, `Weekly total = 500 * 2 * 1 = 1000 (got ${weeklyQuote.total})`);

  // Test 3: Partial week rounding up (10 days -> ceil(10/7) = 2 weeks)
  const partialWeekQuote = calculateQuoteTotal(500, '2026-06-01', '2026-06-11', 'weekly', 1);
  assert(partialWeekQuote.duration === 2, 'Partial 10 days rounds up to 2 weeks');
  assert(partialWeekQuote.total === 1000, 'Partial week total = 1000');

  // Test 4: Monthly rental calculation (price 1200, 45 days -> ceil(45/30) = 2 months, qty 1 -> 2400)
  const monthlyQuote = calculateQuoteTotal(1200, '2026-06-01', '2026-07-16', 'monthly', 1);
  assert(monthlyQuote.days === 45, 'Monthly quote calculates 45 days');
  assert(monthlyQuote.duration === 2, 'Monthly quote duration is 2 months');
  assert(monthlyQuote.unit === 'months', 'Monthly quote unit is months');
  assert(monthlyQuote.total === 2400, `Monthly total = 1200 * 2 * 1 = 2400 (got ${monthlyQuote.total})`);

  // Test 5: computeRentalTotal direct formula test
  const directTotal = computeRentalTotal(75, 4, 3);
  assert(directTotal === 900, `computeRentalTotal(75, 4, 3) = 900 (got ${directTotal})`);

  // --- Part 2: POST /bookings/quote Endpoint Tests ---
  console.log('\n[API Tests: POST /bookings/quote]');

  const equipmentDatabase: Map<string, Equipment> = new Map();
  const bookingsDatabase: Map<string, Booking> = new Map();

  // Seed sample equipment with total quantity = 3
  const sampleEquipment: Equipment = {
    _id: 'eq_forklift_1' as any,
    id: 'eq_forklift_1',
    name: 'Industrial Forklift 5000lb',
    description: 'Heavy duty propane warehouse forklift',
    category: 'Material Handling',
    location: 'Chicago, IL',
    price: 150,
    rentalType: 'daily',
    quantity: 3,
    condition: 'Excellent',
    brand: 'Toyota',
    model: '8FGU25',
    image: 'https://example.com/forklift.jpg',
    terms: 'Operator license required',
    status: 'approved',
    ownerId: 'owner_1',
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  };

  equipmentDatabase.set('eq_forklift_1', sampleEquipment);

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
        // Equipment clause
        const eqClause = filter.$and[0];
        const startClause = filter.$and[1]; // startDate: { $lte: reqEnd }
        const endClause = filter.$and[2]; // endDate: { $gte: reqStart }
        const paidClause = filter.$and[3];
        const excludeClause = filter.$and[4];

        items = items.filter((b) => {
          // 1. Equipment matching
          const eqMatch = eqClause.$or.some((c: any) => {
            const eid = c.equipmentId?.toString();
            return b.equipmentId?.toString() === eid;
          });
          if (!eqMatch) return false;

          // 2. Overlap condition: booking.startDate <= reqEnd AND booking.endDate >= reqStart
          if (startClause.startDate?.$lte && new Date(b.startDate) > new Date(startClause.startDate.$lte)) {
            return false;
          }
          if (endClause.endDate?.$gte && new Date(b.endDate) < new Date(endClause.endDate.$gte)) {
            return false;
          }

          // 3. Paid status matching
          const isPaid =
            ['confirmed', 'paid', 'completed'].includes(b.status) || b.paymentStatus === 'paid';
          if (!isPaid) return false;

          // 4. Exclude cancelled/rejected
          if (['cancelled', 'rejected'].includes(b.status)) return false;

          return true;
        });
      }

      return {
        toArray: async () => items,
      };
    },
  };

  dbConfig.setCollectionsGetter(async () => {
    return {
      users: {} as any,
      equipment: mockEquipmentCollection as any,
      bookings: mockBookingsCollection as any,
      payments: {} as any,
      favorites: {} as any,
      reviews: {} as any,
    };
  });

  const port = await new Promise<number>((resolve) => {
    server = app.listen(0, () => {
      resolve((server.address() as any).port);
    });
  });

  const baseUrl = `http://localhost:${port}`;

  try {
    // 6. POST /bookings/quote with missing equipmentId -> 400
    const res6 = await fetch(`${baseUrl}/bookings/quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        startDate: '2026-06-01',
        endDate: '2026-06-03',
      }),
    });
    assert(res6.status === 400, 'POST /bookings/quote without equipmentId returns 400');

    // 7. POST /bookings/quote with missing dates -> 400
    const res7 = await fetch(`${baseUrl}/bookings/quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        equipmentId: 'eq_forklift_1',
      }),
    });
    assert(res7.status === 400, 'POST /bookings/quote without dates returns 400');

    // 8. POST /bookings/quote with endDate earlier than startDate -> 400
    const res8 = await fetch(`${baseUrl}/bookings/quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        equipmentId: 'eq_forklift_1',
        startDate: '2026-06-10',
        endDate: '2026-06-05',
      }),
    });
    assert(res8.status === 400, 'POST /bookings/quote with endDate < startDate returns 400');

    // 9. POST /bookings/quote with non-existent equipment -> 404
    const res9 = await fetch(`${baseUrl}/bookings/quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        equipmentId: 'eq_unknown',
        startDate: '2026-06-01',
        endDate: '2026-06-04',
      }),
    });
    assert(res9.status === 404, 'POST /bookings/quote with unknown equipment returns 404');

    // 10. POST /bookings/quote when 100% available (total 3, requested 2, duration 3 days) -> 200
    // Price = 150/day * 3 days * 2 qty = 900
    const res10 = await fetch(`${baseUrl}/bookings/quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        equipmentId: 'eq_forklift_1',
        startDate: '2026-06-01',
        endDate: '2026-06-04',
        quantity: 2,
      }),
    });
    const data10 = await res10.json();
    assert(res10.status === 200, 'POST /bookings/quote returns 200 for available equipment');
    assert(data10.available === true, 'Availability is true');
    assert(data10.days === 3, 'Calculated days is 3');
    assert(data10.duration === 3, 'Calculated duration is 3');
    assert(data10.unit === 'days', 'Calculated unit is days');
    assert(data10.quantity === 2, 'Quantity is 2');
    assert(data10.total === 900, `Total price = 150 * 3 * 2 = 900 (got ${data10.total})`);
    assert(data10.availableQuantity === 3, 'Available quantity is 3');
    assert(data10.bookedQuantity === 0, 'Booked quantity is 0');

    // 11. Add an overlapping paid booking with quantity = 2 for June 2 to June 6
    const overlappingPaidBooking: Booking = {
      _id: 'bkg_1',
      equipmentId: 'eq_forklift_1',
      userId: 'user_other',
      startDate: new Date('2026-06-02'),
      endDate: new Date('2026-06-06'),
      quantity: 2,
      status: 'confirmed',
      paymentStatus: 'paid',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    bookingsDatabase.set('bkg_1', overlappingPaidBooking);

    // 12. Check availability for June 1 to June 4 requesting 2 items
    // Available = 3 - 2 = 1. Requested = 2 -> Should return 400 error!
    const res12 = await fetch(`${baseUrl}/bookings/quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        equipmentId: 'eq_forklift_1',
        startDate: '2026-06-01',
        endDate: '2026-06-04',
        quantity: 2,
      }),
    });
    const data12 = await res12.json();
    assert(res12.status === 400, 'POST /bookings/quote returns 400 when requested qty exceeds available');
    assert(data12.available === false, 'Availability is false');
    assert(data12.availableQuantity === 1, 'Reported available quantity is 1');
    assert(data12.bookedQuantity === 2, 'Reported booked quantity is 2');
    assert(data12.error.includes('exceeds available inventory'), 'Clear availability error message returned');

    // 13. Check availability for June 1 to June 4 requesting 1 item (should succeed!)
    // Price = 150/day * 3 days * 1 qty = 450
    const res13 = await fetch(`${baseUrl}/bookings/quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        equipmentId: 'eq_forklift_1',
        startDate: '2026-06-01',
        endDate: '2026-06-04',
        quantity: 1,
      }),
    });
    const data13 = await res13.json();
    assert(res13.status === 200, 'POST /bookings/quote succeeds for requested quantity = 1');
    assert(data13.available === true, 'Availability is true for qty = 1');
    assert(data13.total === 450, `Total price = 150 * 3 * 1 = 450 (got ${data13.total})`);
    assert(data13.availableQuantity === 1, 'Remaining available quantity is 1');

    // 14. Add a cancelled booking for the same dates with quantity = 1
    // A cancelled booking should NOT reduce available inventory
    const cancelledBooking: Booking = {
      _id: 'bkg_cancelled',
      equipmentId: 'eq_forklift_1',
      userId: 'user_cancel',
      startDate: new Date('2026-06-01'),
      endDate: new Date('2026-06-05'),
      quantity: 1,
      status: 'cancelled',
      paymentStatus: 'paid',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    bookingsDatabase.set('bkg_cancelled', cancelledBooking);

    // Verify still 1 available (cancelled booking ignored)
    const res14 = await fetch(`${baseUrl}/bookings/quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        equipmentId: 'eq_forklift_1',
        startDate: '2026-06-01',
        endDate: '2026-06-04',
        quantity: 1,
      }),
    });
    const data14 = await res14.json();
    assert(res14.status === 200, 'Cancelled booking is ignored in availability check');
    assert(data14.availableQuantity === 1, 'Available quantity remains 1');

    // 15. Check non-overlapping dates (June 10 to June 15)
    // Overlapping booking is June 2 to June 6, so all 3 items should be available!
    const res15 = await fetch(`${baseUrl}/bookings/quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        equipmentId: 'eq_forklift_1',
        startDate: '2026-06-10',
        endDate: '2026-06-15',
        quantity: 3,
      }),
    });
    const data15 = await res15.json();
    assert(res15.status === 200, 'Non-overlapping date range returns 200');
    assert(data15.availableQuantity === 3, 'All 3 items available for non-overlapping date range');
    assert(data15.bookedQuantity === 0, '0 booked items for non-overlapping dates');
    assert(data15.total === 150 * 5 * 3, `Total = 150 * 5 * 3 = 2250 (got ${data15.total})`);

  } finally {
    server.close();
  }

  console.log(`\nBooking Quote Tests finished: ${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

runQuoteTests().catch((err) => {
  console.error('Fatal error during booking quote tests:', err);
  if (server) server.close();
  process.exit(1);
});
