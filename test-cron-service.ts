import * as dbConfig from './src/config/db';
import { setCustomTransporter } from './src/services/email.service';
import { processCompletedBookings } from './src/services/cron.service';
import { User, Equipment, Booking } from './src/types/models';

async function runCronServiceTests() {
  console.log('--- Starting Daily Cron Job & Email Notification Tests ---');
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

  const sentEmails: any[] = [];
  let shouldTransporterFail = false;

  const mockTransporter = {
    sendMail: async (mailOptions: any) => {
      if (shouldTransporterFail) {
        throw new Error('Simulated SMTP connection failure: ETIMEDOUT');
      }
      sentEmails.push(mailOptions);
      return { messageId: 'msg_' + Math.random().toString(36).substring(2, 9) };
    },
  };

  setCustomTransporter(mockTransporter);

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

      for (const eq of equipmentDatabase.values()) {
        if (targetId && (eq._id?.toString() === targetId || eq.id === targetId)) return eq;
      }
      return null;
    },
  };

  const mockBookingsCollection = {
    find: (filter: any) => {
      let items = Array.from(bookingsDatabase.values());

      if (filter.$and) {
        for (const clause of filter.$and) {
          if (clause.endDate?.$lt) {
            items = items.filter((b) => new Date(b.endDate).getTime() < new Date(clause.endDate.$lt).getTime());
          }
          if (clause.status?.$in) {
            items = items.filter((b) => clause.status.$in.includes(b.status));
          }
          if (clause.status?.$ne) {
            items = items.filter((b) => b.status !== clause.status.$ne);
          }
        }
      }

      return {
        toArray: async () => items,
      };
    },
    updateOne: async (filter: any, update: any) => {
      const targetId = filter._id?.toString() || filter.id;
      const b = bookingsDatabase.get(targetId);
      if (b) {
        const updated = {
          ...b,
          ...update.$set,
        };
        bookingsDatabase.set(targetId, updated);
        return { modifiedCount: 1 };
      }
      return { modifiedCount: 0 };
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

  // Prepopulate test users
  const renter1: User = {
    id: 'user_renter_1',
    _id: 'user_renter_1' as any,
    name: 'Riley Renter',
    email: 'renter@test.com',
    role: 'customer',
  };
  const owner1: User = {
    id: 'user_owner_1',
    _id: 'user_owner_1' as any,
    name: 'Owen Owner',
    email: 'owner@test.com',
    role: 'owner',
  };

  usersDatabase.set('user_renter_1', renter1);
  usersDatabase.set('user_owner_1', owner1);

  // Prepopulate test equipment
  const equipment1: Equipment = {
    _id: 'eq_cron_1' as any,
    id: 'eq_cron_1',
    name: 'Heavy Duty Skid Steer',
    description: 'Track loader',
    category: 'Earthmoving',
    location: 'Denver, CO',
    price: 250,
    rentalType: 'daily',
    quantity: 1,
    condition: 'Good',
    brand: 'Bobcat',
    model: 'T770',
    image: 'https://example.com/skid.jpg',
    terms: 'Standard terms',
    status: 'approved',
    ownerId: 'user_owner_1',
    owner: {
      id: 'user_owner_1',
      name: 'Owen Owner',
      email: 'owner@test.com',
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  equipmentDatabase.set('eq_cron_1', equipment1);

  // Booking 1: EXPIRED booking (endDate was 2 days ago)
  const expiredBooking: Booking = {
    _id: 'bkg_expired_1',
    id: 'bkg_expired_1',
    equipmentId: 'eq_cron_1',
    userId: 'user_renter_1',
    startDate: new Date('2026-06-01T00:00:00Z'),
    endDate: new Date('2026-06-05T00:00:00Z'), // Past
    totalPrice: 1000,
    status: 'confirmed', // Should become "completed"
    bookingStatus: 'confirmed',
    paymentStatus: 'paid',
    createdAt: new Date('2026-05-20'),
    updatedAt: new Date('2026-05-20'),
  };

  // Booking 2: ACTIVE booking (endDate is in the future)
  const activeBooking: Booking = {
    _id: 'bkg_active_2',
    id: 'bkg_active_2',
    equipmentId: 'eq_cron_1',
    userId: 'user_renter_1',
    startDate: new Date('2026-06-01T00:00:00Z'),
    endDate: new Date('2026-06-25T00:00:00Z'), // Future
    totalPrice: 1000,
    status: 'confirmed', // Should remain "confirmed"
    bookingStatus: 'confirmed',
    paymentStatus: 'paid',
    createdAt: new Date('2026-05-20'),
    updatedAt: new Date('2026-05-20'),
  };

  bookingsDatabase.set('bkg_expired_1', expiredBooking);
  bookingsDatabase.set('bkg_active_2', activeBooking);

  const testNow = new Date('2026-06-10T00:00:00Z');

  try {
    // Test 1: Normal processing with working email transporter
    console.log('\n[Scenario 1: Expired Booking Completion & Successful Emails]');
    const result1 = await processCompletedBookings(testNow);

    assert(result1.totalProcessed === 1, 'Exactly 1 expired booking processed');
    assert(result1.completedIds.includes('bkg_expired_1'), 'Expired booking id recorded in completedIds');

    const updatedBkg1 = bookingsDatabase.get('bkg_expired_1');
    assert(updatedBkg1?.status === 'completed', 'Expired booking status set to "completed"');
    assert(updatedBkg1?.bookingStatus === 'completed', 'Expired booking bookingStatus set to "completed"');

    const untouchedBkg2 = bookingsDatabase.get('bkg_active_2');
    assert(untouchedBkg2?.status === 'confirmed', 'Future active booking remains "confirmed"');

    // Verify emails sent
    assert(sentEmails.length === 2, `2 emails sent (1 to renter, 1 to owner). Got: ${sentEmails.length}`);
    const renterEmail = sentEmails.find((e) => e.to === 'renter@test.com');
    const ownerEmail = sentEmails.find((e) => e.to === 'owner@test.com');

    assert(renterEmail !== undefined, 'Email sent to renter@test.com');
    assert(renterEmail?.subject.includes('Heavy Duty Skid Steer'), 'Renter email subject includes equipment name');
    assert(renterEmail?.text.includes('bkg_expired_1'), 'Renter email text includes booking ID');

    assert(ownerEmail !== undefined, 'Email sent to owner@test.com');
    assert(ownerEmail?.subject.includes('Heavy Duty Skid Steer'), 'Owner email subject includes equipment name');
    assert(ownerEmail?.text.includes('bkg_expired_1'), 'Owner email text includes booking ID');

    // Test 2: Idempotency (running again when no bookings are expired and uncompleted)
    console.log('\n[Scenario 2: Idempotency on Already Completed Bookings]');
    sentEmails.length = 0;
    const result2 = await processCompletedBookings(testNow);
    assert(result2.totalProcessed === 0, 'No bookings processed on second run (already completed)');
    assert(sentEmails.length === 0, 'No emails sent on second run');

    // Test 3: Resilience - Email failures MUST NOT crash the job
    console.log('\n[Scenario 3: Email Failures Must NOT Crash the Job]');
    // Reset a third booking to expired
    const expiredBooking3: Booking = {
      _id: 'bkg_expired_3',
      id: 'bkg_expired_3',
      equipmentId: 'eq_cron_1',
      userId: 'user_renter_1',
      startDate: new Date('2026-06-01T00:00:00Z'),
      endDate: new Date('2026-06-08T00:00:00Z'),
      totalPrice: 800,
      status: 'confirmed',
      bookingStatus: 'confirmed',
      paymentStatus: 'paid',
      createdAt: new Date('2026-05-20'),
      updatedAt: new Date('2026-05-20'),
    };
    bookingsDatabase.set('bkg_expired_3', expiredBooking3);

    // Turn on simulated transporter failure
    shouldTransporterFail = true;

    // Run processor: it should NOT throw an error despite SMTP failure!
    let threwException = false;
    let result3: any;
    try {
      result3 = await processCompletedBookings(testNow);
    } catch (err) {
      threwException = true;
    }

    assert(threwException === false, 'processCompletedBookings did NOT throw on email failure');
    assert(result3.totalProcessed === 1, 'Booking was still successfully marked as completed despite email error');

    const updatedBkg3 = bookingsDatabase.get('bkg_expired_3');
    assert(updatedBkg3?.status === 'completed', 'Booking status was updated to "completed"');
    assert(updatedBkg3?.bookingStatus === 'completed', 'Booking bookingStatus was updated to "completed"');
    assert(result3.emailResults[0]?.errors.length > 0, 'Email errors recorded in result without crashing');

  } catch (err: any) {
    console.error('Unexpected test error:', err);
    failed++;
  }

  console.log(`\nDaily Cron Job & Email Tests finished: ${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

runCronServiceTests().catch((err) => {
  console.error('Fatal error during cron tests:', err);
  process.exit(1);
});
