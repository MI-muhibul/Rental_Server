import dotenv from 'dotenv';
import path from 'path';

dotenv.config();
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const clientUrl = process.env.CLIENT_URL || 'http://localhost:3000';

export const env = {
  PORT: process.env.PORT || 5000,
  MONGODB_URI: process.env.MONGODB_URI || '',
  CLIENT_URL: clientUrl,
  JWKS_URL: process.env.JWKS_URL || `${clientUrl}/api/auth/jwks`,
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY || '',
  SMTP_USER: process.env.SMTP_USER || '',
  SMTP_PASS: process.env.SMTP_PASS || '',
};

export * from './db';
export default env;
