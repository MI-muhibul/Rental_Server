import cron, { ScheduledTask } from 'node-cron';
import { ObjectId } from 'mongodb';
import * as dbConfig from '../config/db';
import { sendRentalCompletionEmails } from './email.service';
import { Equipment, User } from '../types/models';

let activeCronTask: ScheduledTask | null = null;

const getEquipmentFilter = (id: string) => {
  if (ObjectId.isValid(id) && id.length === 24) {
    return {
      $or: [{ _id: new ObjectId(id) }, { _id: id as any }, { id: id as any }],
    };
  }
  return {
    $or: [{ _id: id as any }, { id: id as any }],
  };
};

const getUserFilter = (id: string) => {
  if (ObjectId.isValid(id) && id.length === 24) {
    return {
      $or: [{ _id: new ObjectId(id) }, { _id: id as any }, { id: id as any }],
    };
  }
  return {
    $or: [{ _id: id as any }, { id: id as any }],
  };
};

export interface ProcessCompletedResult {
  totalProcessed: number;
  completedIds: string[];
  emailResults: {
    bookingId: string;
    renterSent: boolean;
    ownerSent: boolean;
    errors: string[];
  }[];
}

/**
 * Core processor that finds all active bookings whose endDate has passed,
 * sets their bookingStatus and status to "completed", and sends notification
 * emails to the renter and owner.
 *
 * Guarantees that email failures never crash or stop the job.
 */
export const processCompletedBookings = async (
  customNow?: Date
): Promise<ProcessCompletedResult> => {
  const now = customNow || new Date();
  const result: ProcessCompletedResult = {
    totalProcessed: 0,
    completedIds: [],
    emailResults: [],
  };

  try {
    const { bookings, equipment, users } = await dbConfig.getCollections();

    // Query for bookings whose rental period has ended and are not yet completed
    const query = {
      $and: [
        { endDate: { $lt: now } },
        { status: { $in: ['confirmed', 'paid', 'active'] } },
        { status: { $ne: 'completed' } },
      ],
    };

    const expiredBookings = await bookings.find(query).toArray();

    for (const booking of expiredBookings) {
      const bookingIdStr = booking._id?.toString() || booking.id || '';

      try {
        // 1. Update booking status to "completed"
        const updateFilter = booking._id ? { _id: booking._id } : { id: bookingIdStr };
        await bookings.updateOne(updateFilter as any, {
          $set: {
            status: 'completed',
            bookingStatus: 'completed',
            updatedAt: now,
          },
        });

        result.completedIds.push(bookingIdStr);
        result.totalProcessed++;

        // 2. Lookup equipment details for name and owner info
        const eqId = booking.equipmentId?.toString() || '';
        let eqItem: Equipment | null = null;
        if (eqId) {
          eqItem = await equipment.findOne(getEquipmentFilter(eqId));
        }

        const equipmentName = eqItem?.name || booking.equipmentName || 'Rented Equipment';

        // 3. Lookup renter info
        const renterId = booking.userId?.toString() || '';
        let renterUser: User | null = null;
        if (renterId) {
          renterUser = await users.findOne(getUserFilter(renterId));
        }

        // 4. Lookup owner info
        let ownerEmail = eqItem?.owner?.email;
        let ownerName = eqItem?.owner?.name;

        if (!ownerEmail && eqItem?.ownerId) {
          const ownerUser = await users.findOne(getUserFilter(eqItem.ownerId.toString()));
          if (ownerUser) {
            ownerEmail = ownerUser.email;
            ownerName = ownerUser.name;
          }
        }

        // 5. Send completion emails (failures will NOT crash the job)
        try {
          const emailOutcome = await sendRentalCompletionEmails({
            bookingId: bookingIdStr,
            renterEmail: renterUser?.email,
            renterName: renterUser?.name,
            ownerEmail,
            ownerName,
            equipmentName,
            startDate: booking.startDate,
            endDate: booking.endDate,
          });

          result.emailResults.push({
            bookingId: bookingIdStr,
            ...emailOutcome,
          });
        } catch (emailErr: any) {
          // Extra safety net: email failure must never crash or propagate
          console.error(
            `[Cron Email Warning] Error sending emails for booking #${bookingIdStr}:`,
            emailErr?.message || emailErr
          );
          result.emailResults.push({
            bookingId: bookingIdStr,
            renterSent: false,
            ownerSent: false,
            errors: [emailErr?.message || 'Email failure'],
          });
        }
      } catch (bookingErr: any) {
        console.error(
          `[Cron Booking Error] Error updating booking #${bookingIdStr}:`,
          bookingErr?.message || bookingErr
        );
      }
    }

    if (result.totalProcessed > 0) {
      console.log(
        `[Cron Daily Job] Successfully marked ${result.totalProcessed} booking(s) as completed.`
      );
    }

    return result;
  } catch (error: any) {
    console.error('[Cron Job Error] Failed to process completed bookings:', error);
    return result;
  }
};

/**
 * Starts the daily node-cron schedule to mark expired bookings as completed.
 * Defaults to running daily at midnight ('0 0 * * *').
 */
export const startDailyCronJob = (cronExpression = '0 0 * * *'): ScheduledTask => {
  if (activeCronTask) {
    activeCronTask.stop();
  }

  activeCronTask = cron.schedule(cronExpression, async () => {
    console.log('[Cron Job] Running daily check for completed bookings...');
    await processCompletedBookings();
  });

  console.log(`[Cron Job] Daily booking completion cron scheduled (${cronExpression}).`);
  return activeCronTask;
};

/**
 * Stops the active daily cron task (useful during shutdown or testing).
 */
export const stopDailyCronJob = (): void => {
  if (activeCronTask) {
    activeCronTask.stop();
    activeCronTask = null;
    console.log('[Cron Job] Daily booking completion cron stopped.');
  }
};
