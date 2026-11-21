import nodemailer, { Transporter } from 'nodemailer';
import env from '../config';

let customTransporter: any = null;
let defaultTransporter: Transporter | null = null;

/**
 * Injects a custom/mock transporter for testing or alternative providers.
 */
export const setCustomTransporter = (transporter: any) => {
  customTransporter = transporter;
};

/**
 * Returns the configured nodemailer transporter using SMTP settings from env.
 */
export const getTransporter = (): Transporter => {
  if (customTransporter) {
    return customTransporter;
  }

  if (!defaultTransporter) {
    const host = process.env.SMTP_HOST || 'smtp.gmail.com';
    const port = parseInt(process.env.SMTP_PORT || '587', 10);
    const user = env.SMTP_USER;
    const pass = env.SMTP_PASS;

    defaultTransporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: user && pass ? { user, pass } : undefined,
    });
  }

  return defaultTransporter;
};

export interface CompletionEmailParams {
  bookingId: string;
  renterEmail?: string;
  renterName?: string;
  ownerEmail?: string;
  ownerName?: string;
  equipmentName: string;
  startDate: Date | string;
  endDate: Date | string;
}

/**
 * Sends rental completion notification emails to both the renter and owner.
 * Any email failures are caught and logged gracefully so the cron job never crashes.
 */
export const sendRentalCompletionEmails = async (
  params: CompletionEmailParams
): Promise<{ renterSent: boolean; ownerSent: boolean; errors: string[] }> => {
  const result = { renterSent: false, ownerSent: false, errors: [] as string[] };
  const transporter = getTransporter();
  const sender = env.SMTP_USER || 'no-reply@equipment-rental.com';

  const formattedEnd = new Date(params.endDate).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  // 1. Email to the renter
  if (params.renterEmail) {
    try {
      await transporter.sendMail({
        from: sender,
        to: params.renterEmail,
        subject: `Rental Completed: ${params.equipmentName}`,
        text: `Hello ${params.renterName || 'Customer'},\n\nYour rental for "${params.equipmentName}" (Booking #${params.bookingId}) has completed as the rental end date (${formattedEnd}) has passed.\n\nThank you for choosing Equipment Rental!\n\nBest regards,\nEquipment Rental Team`,
        html: `<p>Hello <strong>${params.renterName || 'Customer'}</strong>,</p><p>Your rental for <strong>${params.equipmentName}</strong> (Booking #${params.bookingId}) has completed as the rental end date (<strong>${formattedEnd}</strong>) has passed.</p><p>Thank you for choosing Equipment Rental!</p><p>Best regards,<br>Equipment Rental Team</p>`,
      });
      result.renterSent = true;
    } catch (err: any) {
      const msg = `Failed to send completion email to renter (${params.renterEmail}): ${err?.message || err}`;
      console.error(`[Email Service Error] ${msg}`);
      result.errors.push(msg);
    }
  }

  // 2. Email to the owner
  if (params.ownerEmail) {
    try {
      await transporter.sendMail({
        from: sender,
        to: params.ownerEmail,
        subject: `Rental Period Ended: ${params.equipmentName}`,
        text: `Hello ${params.ownerName || 'Equipment Owner'},\n\nThe rental period for your equipment "${params.equipmentName}" (Booking #${params.bookingId}) has ended as of ${formattedEnd}.\n\nThe booking status has automatically been updated to "completed".\n\nBest regards,\nEquipment Rental Team`,
        html: `<p>Hello <strong>${params.ownerName || 'Equipment Owner'}</strong>,</p><p>The rental period for your equipment <strong>${params.equipmentName}</strong> (Booking #${params.bookingId}) has ended as of <strong>${formattedEnd}</strong>.</p><p>The booking status has automatically been updated to <strong>completed</strong>.</p><p>Best regards,<br>Equipment Rental Team</p>`,
      });
      result.ownerSent = true;
    } catch (err: any) {
      const msg = `Failed to send completion email to owner (${params.ownerEmail}): ${err?.message || err}`;
      console.error(`[Email Service Error] ${msg}`);
      result.errors.push(msg);
    }
  }

  return result;
};
