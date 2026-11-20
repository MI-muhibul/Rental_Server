import Stripe from 'stripe';
import env from './index';

let customStripeClient: any = null;
let stripeInstance: Stripe | null = null;

/**
 * Returns a configured Stripe client instance or custom mock client.
 */
export const getStripeClient = (): Stripe => {
  if (customStripeClient) {
    return customStripeClient;
  }

  if (!stripeInstance) {
    const key = env.STRIPE_SECRET_KEY || 'sk_test_placeholder_key';
    stripeInstance = new Stripe(key, {
      apiVersion: '2025-02-24.acacia' as any,
    });
  }

  return stripeInstance;
};

/**
 * Sets a mock or custom Stripe client (used for unit/integration testing).
 */
export const setStripeClient = (client: any) => {
  customStripeClient = client;
};

export default getStripeClient;
