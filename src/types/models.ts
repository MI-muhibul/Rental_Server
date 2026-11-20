import { ObjectId } from 'mongodb';

export type UserRole = 'customer' | 'owner' | 'admin' | 'renter' | string;

export interface User {
  _id?: ObjectId | string;
  id?: string;
  name: string;
  email: string;
  password?: string;
  role?: UserRole;
  avatar?: string;
  photo?: string;
  phone?: string;
  address?: string;
  createdAt?: Date;
  updatedAt?: Date;
  [key: string]: any;
}

export type RentalType = 'daily' | 'weekly' | 'monthly';
export type EquipmentStatus =
  | 'pending'
  | 'approved'
  | 'available'
  | 'rented'
  | 'maintenance'
  | 'rejected';

export interface Equipment {
  _id?: ObjectId | string;
  name: string;
  description: string;
  category: string;
  location: string;
  price: number;
  pricePerDay?: number;
  rentalType: RentalType;
  quantity: number;
  condition: string;
  brand: string;
  model: string;
  image: string;
  images?: string[];
  terms: string;
  status: EquipmentStatus;
  ownerId: ObjectId | string;
  owner?: {
    id: string;
    name?: string;
    email: string;
  };
  createdAt: Date;
  updatedAt: Date;
  [key: string]: any;
}

export interface Booking {
  _id?: ObjectId | string;
  equipmentId: ObjectId | string;
  userId: ObjectId | string;
  startDate: Date;
  endDate: Date;
  totalPrice?: number;
  total?: number;
  quantity?: number;
  duration?: number;
  rentalType?: RentalType;
  status: 'pending' | 'confirmed' | 'cancelled' | 'completed' | 'paid' | string;
  paymentStatus?: 'pending' | 'paid' | 'failed' | string;
  createdAt: Date;
  updatedAt: Date;
  [key: string]: any;
}

export interface Payment {
  _id?: ObjectId;
  bookingId: ObjectId | string;
  userId: ObjectId | string;
  amount: number;
  currency: string;
  stripePaymentIntentId?: string;
  status: 'pending' | 'succeeded' | 'failed';
  createdAt: Date;
}

export interface Favorite {
  _id?: ObjectId | string;
  userId: ObjectId | string;
  equipmentId: ObjectId | string;
  equipment?: Equipment | null;
  createdAt: Date;
}

export interface Review {
  _id?: ObjectId;
  equipmentId: ObjectId | string;
  userId: ObjectId | string;
  rating: number;
  comment: string;
  createdAt: Date;
}
