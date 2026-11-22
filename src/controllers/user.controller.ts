import { Request, Response } from 'express';
import { ObjectId } from 'mongodb';
import * as dbConfig from '../config/db';
import { User, UserRole } from '../types/models';

const ALLOWED_ROLES: UserRole[] = ['customer', 'owner', 'admin'];

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

/**
 * POST /users
 * Upsert on register or Google login. Default role: "customer".
 */
export const upsertUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, name, photo, avatar, phone, address, id } = req.body;

    if (!email || typeof email !== 'string') {
      res.status(400).json({ error: 'Valid email is required' });
      return;
    }

    const normalizedEmail = email.toLowerCase().trim();
    const { users } = await dbConfig.getCollections();
    const now = new Date();

    const picture = photo || avatar || undefined;

    const setFields: Partial<User> = {
      updatedAt: now,
    };

    if (name) setFields.name = name;
    if (picture) {
      setFields.photo = picture;
      setFields.avatar = picture;
    }
    if (phone) setFields.phone = phone;
    if (address) setFields.address = address;
    if (id) setFields.id = id;
    if (normalizedEmail === 'admin@heavyrent.com') {
      setFields.role = 'admin';
    }

    const result = await users.findOneAndUpdate(
      { email: normalizedEmail },
      {
        $set: setFields,
        $setOnInsert: {
          email: normalizedEmail,
          role: 'customer',
          createdAt: now,
        },
      },
      {
        upsert: true,
        returnDocument: 'after',
      }
    );

    res.status(200).json({
      message: 'User upserted successfully',
      user: result,
    });
  } catch (error: any) {
    console.error('Error in upsertUser:', error);
    res.status(500).json({ error: 'Internal Server Error', message: error?.message });
  }
};

/**
 * GET /users/me
 * Get current authenticated user profile.
 */
export const getMe = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { users } = await dbConfig.getCollections();
    const userId = req.user._id?.toString() || req.user.id;
    let currentUser: User | null = null;

    if (userId) {
      currentUser = await users.findOne(getUserFilter(userId));
    } else if (req.user.email) {
      currentUser = await users.findOne({ email: req.user.email });
    }

    if (!currentUser) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    res.status(200).json({ user: currentUser });
  } catch (error: any) {
    console.error('Error in getMe:', error);
    res.status(500).json({ error: 'Internal Server Error', message: error?.message });
  }
};

/**
 * PATCH /users/me
 * Update authenticated user's name, photo, phone, address.
 */
export const updateMe = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { name, photo, avatar, phone, address } = req.body;
    const picture = photo || avatar;

    const updateFields: Partial<User> = {
      updatedAt: new Date(),
    };

    if (name !== undefined) updateFields.name = name;
    if (picture !== undefined) {
      updateFields.photo = picture;
      updateFields.avatar = picture;
    }
    if (phone !== undefined) updateFields.phone = phone;
    if (address !== undefined) updateFields.address = address;

    const { users } = await dbConfig.getCollections();
    const userId = req.user._id?.toString() || req.user.id;

    let filter: any;
    if (userId) {
      filter = getUserFilter(userId);
    } else {
      filter = { email: req.user.email };
    }

    const updatedUser = await users.findOneAndUpdate(
      filter,
      { $set: updateFields },
      { returnDocument: 'after' }
    );

    if (!updatedUser) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    res.status(200).json({
      message: 'Profile updated successfully',
      user: updatedUser,
    });
  } catch (error: any) {
    console.error('Error in updateMe:', error);
    res.status(500).json({ error: 'Internal Server Error', message: error?.message });
  }
};

/**
 * GET /users
 * Admin only: list all users.
 */
export const getAllUsers = async (req: Request, res: Response): Promise<void> => {
  try {
    const { users } = await dbConfig.getCollections();
    const { role, search, page, limit } = req.query;

    const query: any = {};
    if (role && typeof role === 'string') {
      query.role = role.toLowerCase();
    }
    if (search && typeof search === 'string') {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
      ];
    }

    const pageNum = parseInt(page as string, 10) || 1;
    const limitNum = parseInt(limit as string, 10) || 50;
    const skip = (pageNum - 1) * limitNum;

    const [userList, total] = await Promise.all([
      users.find(query).skip(skip).limit(limitNum).sort({ createdAt: -1 }).toArray(),
      users.countDocuments(query),
    ]);

    res.status(200).json({
      users: userList,
      total,
      page: pageNum,
      totalPages: Math.ceil(total / limitNum) || 1,
    });
  } catch (error: any) {
    console.error('Error in getAllUsers:', error);
    res.status(500).json({ error: 'Internal Server Error', message: error?.message });
  }
};

/**
 * PATCH /users/:id/role
 * Admin only: update user role (validates customer/owner/admin).
 */
export const updateUserRole = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = (Array.isArray(req.params.id) ? req.params.id[0] : req.params.id) as string;
    const { role } = req.body;

    if (!id) {
      res.status(400).json({ error: 'User ID is required' });
      return;
    }

    if (!role || typeof role !== 'string') {
      res.status(400).json({
        error: `Role is required. Allowed roles are: ${ALLOWED_ROLES.join(', ')}`,
      });
      return;
    }

    const normalizedRole = role.toLowerCase().trim() as UserRole;
    if (!ALLOWED_ROLES.includes(normalizedRole)) {
      res.status(400).json({
        error: `Invalid role "${role}". Allowed roles are: ${ALLOWED_ROLES.join(', ')}`,
      });
      return;
    }

    const { users } = await dbConfig.getCollections();
    const updatedUser = await users.findOneAndUpdate(
      getUserFilter(id),
      {
        $set: {
          role: normalizedRole,
          updatedAt: new Date(),
        },
      },
      { returnDocument: 'after' }
    );

    if (!updatedUser) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    res.status(200).json({
      message: 'User role updated successfully',
      user: updatedUser,
    });
  } catch (error: any) {
    console.error('Error in updateUserRole:', error);
    res.status(500).json({ error: 'Internal Server Error', message: error?.message });
  }
};

/**
 * DELETE /users/:id
 * Admin only: delete a user.
 */
export const deleteUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = (Array.isArray(req.params.id) ? req.params.id[0] : req.params.id) as string;

    if (!id) {
      res.status(400).json({ error: 'User ID is required' });
      return;
    }

    // Prevent admin from deleting themselves
    const currentUserId = req.user?._id?.toString() || req.user?.id;
    if (currentUserId && (currentUserId === id || currentUserId === id.toString())) {
      res.status(400).json({ error: 'Admin cannot delete their own account' });
      return;
    }

    const { users } = await dbConfig.getCollections();
    const result = await users.deleteOne(getUserFilter(id));

    if (result.deletedCount === 0) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    res.status(200).json({
      message: 'User deleted successfully',
      deletedId: id,
    });
  } catch (error: any) {
    console.error('Error in deleteUser:', error);
    res.status(500).json({ error: 'Internal Server Error', message: error?.message });
  }
};
