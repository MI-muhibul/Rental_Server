import { Request, Response, NextFunction } from 'express';
import { ObjectId } from 'mongodb';
import { pathToFileURL } from 'url';
import env from '../config';
import * as dbConfig from '../config/db';
import { User } from '../types/models';

export interface VerifiedAuthPayload {
  sub?: string;
  id?: string;
  email?: string;
  name?: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: User;
      authPayload?: VerifiedAuthPayload;
    }
  }
}

let customJWKSet: any = null;
let cachedJWKS: any = null;
let cachedUrl: string | null = null;

// Preserve native ESM import() under TypeScript CommonJS compilation AND keep static require.resolve('jose') for Vercel NFT bundling
const importJose = () => {
  const joseEntry = require.resolve('jose');
  return new Function('p', 'return import(p)')(pathToFileURL(joseEntry).href) as Promise<
    typeof import('jose')
  >;
};

/**
 * Get or initialize the remote JWKS key set for verifying Better Auth JWTs.
 * Uses client's JWKS URL (e.g., http://localhost:3000/api/auth/jwks).
 */
export const getJWKS = async (customUrl?: string) => {
  if (customJWKSet) {
    return customJWKSet;
  }
  const { createRemoteJWKSet } = await importJose();
  const url = customUrl || env.JWKS_URL || `${env.CLIENT_URL}/api/auth/jwks`;
  if (!cachedJWKS || cachedUrl !== url) {
    cachedJWKS = createRemoteJWKSet(new URL(url));
    cachedUrl = url;
  }
  return cachedJWKS;
};

/**
 * Helper to override or reset the JWKS set (useful for testing or dynamic config).
 */
export const setJWKS = (jwks: any) => {
  customJWKSet = jwks;
};

/**
 * Extracts and verifies the Better Auth JWT from Authorization header or cookies.
 */
const extractAndVerifyJwt = async (req: Request): Promise<Record<string, any>> => {
  let token: string | undefined;
  const authHeader = req.headers.authorization;

  if (authHeader) {
    if (authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7).trim();
    } else {
      token = authHeader.trim();
    }
  } else if ((req as any).cookies) {
    token =
      (req as any).cookies['better-auth.session_token'] ||
      (req as any).cookies['session_token'] ||
      (req as any).cookies['token'];
  }

  if (!token && req.headers.cookie) {
    const cookies = Object.fromEntries(
      req.headers.cookie.split(';').map((c) => {
        const [k, ...v] = c.trim().split('=');
        return [k, decodeURIComponent(v.join('='))];
      })
    );
    token = cookies['better-auth.session_token'] || cookies['session_token'] || cookies['token'];
  }

  if (!token) {
    throw Object.assign(new Error('Unauthorized: No token provided'), { statusCode: 401 });
  }

  const { jwtVerify } = await importJose();
  const JWKS = await getJWKS();
  const { payload } = await jwtVerify(token, JWKS);
  return payload as Record<string, any>;
};

/**
 * Middleware to verify a Better Auth JWT without requiring an existing record
 * in the backend `users` collection (used for POST /users initial sync/upsert).
 */
export const verifyJwtOnly = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const payload = await extractAndVerifyJwt(req);
    const userId = (payload.sub || payload.id || payload.userId) as string | undefined;
    const email = payload.email as string | undefined;

    if (!userId && !email) {
      res.status(401).json({ error: 'Unauthorized: Invalid token payload' });
      return;
    }

    req.authPayload = {
      sub: userId,
      id: userId,
      email,
      name: payload.name as string | undefined,
    };

    next();
  } catch (error: any) {
    const msg = error?.message || 'Token verification failed';
    res.status(401).json({
      error: msg.startsWith('Unauthorized:') ? msg : 'Unauthorized: Invalid or expired token',
      message: msg,
    });
    return;
  }
};

/**
 * Middleware to verify JWT issued by Better Auth via client's JWKS endpoint
 * and load user's role from the users collection in MongoDB.
 */
export const verifyToken = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const payload = await extractAndVerifyJwt(req);

    const userId = (payload.sub || payload.id || (payload as any).userId) as string | undefined;
    const email = payload.email as string | undefined;

    if (!userId && !email) {
      res.status(401).json({ error: 'Unauthorized: Invalid token payload' });
      return;
    }

    req.authPayload = {
      sub: userId,
      id: userId,
      email,
      name: payload.name as string | undefined,
    };

    const { users } = await dbConfig.getCollections();
    let user: User | null = null;

    if (userId) {
      if (ObjectId.isValid(userId) && userId.length === 24) {
        user = await users.findOne({ _id: new ObjectId(userId) });
      }
      if (!user) {
        user = await users.findOne({ _id: userId as any });
      }
      if (!user) {
        user = await users.findOne({ id: userId } as any);
      }
    }

    if (!user && email) {
      user = await users.findOne({ email: email.toLowerCase().trim() });
    }

    if (!user) {
      res.status(401).json({ error: 'Unauthorized: User not found in database' });
      return;
    }

    req.user = {
      ...user,
      role: user.role || 'customer',
    };

    next();
  } catch (error: any) {
    if (error?.statusCode === 401 && error?.message) {
      res.status(401).json({ error: error.message });
      return;
    }
    res.status(401).json({
      error: 'Unauthorized: Invalid or expired token',
      message: error?.message || 'Token verification failed',
    });
    return;
  }
};

/**
 * Middleware ensuring authenticated user has 'renter' or 'customer' role.
 * Returns 403 with a clear message if access is denied.
 */
export const verifyRenter = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized: Authentication required' });
    return;
  }

  const role = (req.user.role || '').toLowerCase();
  if (role !== 'renter' && role !== 'customer' && role !== 'admin') {
    res.status(403).json({
      error: 'Forbidden: Access restricted to renters (customers)',
    });
    return;
  }

  next();
};

/**
 * Middleware ensuring authenticated user has 'owner' role.
 * Returns 403 with a clear message if access is denied.
 */
export const verifyOwner = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized: Authentication required' });
    return;
  }

  const role = (req.user.role || '').toLowerCase();
  if (role !== 'owner' && role !== 'admin') {
    res.status(403).json({
      error: 'Forbidden: Access restricted to equipment owners',
    });
    return;
  }

  next();
};

/**
 * Middleware ensuring authenticated user has 'admin' role.
 * Returns 403 with a clear message if access is denied.
 */
export const verifyAdmin = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized: Authentication required' });
    return;
  }

  if (req.user.email?.toLowerCase() === 'admin@heavyrent.com') {
    req.user.role = 'admin';
    next();
    return;
  }

  const role = (req.user.role || '').toLowerCase();
  if (role !== 'admin') {
    res.status(403).json({
      error: 'Forbidden: Access restricted to administrators',
    });
    return;
  }

  next();
};
