import { RentalType } from '../types/models';

export interface DurationResult {
  duration: number;
  days: number;
  unit: 'days' | 'weeks' | 'months';
}

export interface QuoteCalculationResult extends DurationResult {
  price: number;
  quantity: number;
  total: number;
}

/**
 * Computes the duration in days, weeks, or months based on rentalType.
 * Minimum duration is 1 unit.
 */
export const calculateDuration = (
  startDate: Date | string,
  endDate: Date | string,
  rentalType: RentalType | string = 'daily'
): DurationResult => {
  const start = new Date(startDate);
  const end = new Date(endDate);

  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    throw new Error('Invalid startDate or endDate provided');
  }

  if (end.getTime() < start.getTime()) {
    throw new Error('endDate cannot be earlier than startDate');
  }

  const diffMs = end.getTime() - start.getTime();
  // Minimum 1 day for same-day or partial-day rentals
  const diffDays = Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));

  const normalizedRentalType = (rentalType || 'daily').toLowerCase().trim();

  let duration: number;
  let unit: 'days' | 'weeks' | 'months';

  switch (normalizedRentalType) {
    case 'weekly':
      unit = 'weeks';
      duration = Math.max(1, Math.ceil(diffDays / 7));
      break;
    case 'monthly':
      unit = 'months';
      duration = Math.max(1, Math.ceil(diffDays / 30));
      break;
    case 'daily':
    default:
      unit = 'days';
      duration = diffDays;
      break;
  }

  return { duration, days: diffDays, unit };
};

/**
 * Computes total = price × duration × quantity based on rentalType units.
 *
 * @param price - Unit price per rentalType period
 * @param duration - Number of periods (days, weeks, or months)
 * @param quantity - Number of units rented
 * @returns Total price rounded to two decimals
 */
export const computeRentalTotal = (
  price: number,
  duration: number,
  quantity: number
): number => {
  if (price < 0 || duration < 0 || quantity < 0) {
    throw new Error('price, duration, and quantity must be non-negative');
  }
  return Number((price * duration * quantity).toFixed(2));
};

/**
 * Helper combining duration resolution and total calculation.
 * Computes total = price × duration × quantity based on rentalType.
 */
export const calculateQuoteTotal = (
  price: number,
  startDate: Date | string,
  endDate: Date | string,
  rentalType: RentalType | string = 'daily',
  quantity: number = 1
): QuoteCalculationResult => {
  const { duration, days, unit } = calculateDuration(startDate, endDate, rentalType);
  const total = computeRentalTotal(price, duration, quantity);

  return {
    price,
    quantity,
    days,
    duration,
    unit,
    total,
  };
};
