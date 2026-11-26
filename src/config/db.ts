import { MongoClient, Db, Collection, IndexSpecification } from 'mongodb';
import env from './index';
import {
  User,
  Equipment,
  Booking,
  Payment,
  Favorite,
  Review,
} from '../types/models';

export const COLLECTIONS = {
  USERS: 'users',
  EQUIPMENT: 'equipment',
  BOOKINGS: 'bookings',
  PAYMENTS: 'payments',
  FAVORITES: 'favorites',
  REVIEWS: 'reviews',
} as const;

declare global {
  // eslint-disable-next-line no-var
  var _mongoClientPromise: Promise<MongoClient> | undefined;
}

let clientPromise: Promise<MongoClient>;

export const getClientPromise = (): Promise<MongoClient> => {
  const uri = env.MONGODB_URI;

  if (!uri) {
    throw new Error('Please define MONGODB_URI in your environment variables (.env)');
  }

  // Preserve cached MongoClient promise across warm Vercel serverless invocations and dev HMR
  if (!global._mongoClientPromise) {
    const client = new MongoClient(uri, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 10000,
    });
    global._mongoClientPromise = client.connect().catch((err) => {
      global._mongoClientPromise = undefined;
      throw err;
    });
  }
  clientPromise = global._mongoClientPromise;

  return clientPromise;
};

export const getClient = async (): Promise<MongoClient> => {
  return getClientPromise();
};

export const getDb = async (dbName?: string): Promise<Db> => {
  const client = await getClient();
  if (dbName) {
    return client.db(dbName);
  }
  const uriDbName = client.options?.dbName;
  return client.db(uriDbName && uriDbName !== 'test' ? uriDbName : 'equipment_rental');
};

export interface DatabaseCollections {
  users: Collection<User>;
  equipment: Collection<Equipment>;
  bookings: Collection<Booking>;
  payments: Collection<Payment>;
  favorites: Collection<Favorite>;
  reviews: Collection<Review>;
}

let customCollectionsGetter: ((dbName?: string) => Promise<DatabaseCollections>) | null = null;

export const setCollectionsGetter = (
  getter: ((dbName?: string) => Promise<DatabaseCollections>) | null
) => {
  customCollectionsGetter = getter;
};

export const getCollections = async (dbName?: string): Promise<DatabaseCollections> => {
  if (customCollectionsGetter) {
    return customCollectionsGetter(dbName);
  }
  const db = await getDb(dbName);
  return {
    users: db.collection<User>(COLLECTIONS.USERS),
    equipment: db.collection<Equipment>(COLLECTIONS.EQUIPMENT),
    bookings: db.collection<Booking>(COLLECTIONS.BOOKINGS),
    payments: db.collection<Payment>(COLLECTIONS.PAYMENTS),
    favorites: db.collection<Favorite>(COLLECTIONS.FAVORITES),
    reviews: db.collection<Review>(COLLECTIONS.REVIEWS),
  };
};

// Index initialization
let indexesInitialized = false;

export const initIndexes = async (targetDb?: Db): Promise<void> => {
  const db = targetDb || (await getDb());

  try {
    const usersCollection = db.collection<User>(COLLECTIONS.USERS);
    const equipmentCollection = db.collection<Equipment>(COLLECTIONS.EQUIPMENT);

    // 1. users.email unique index
    await usersCollection.createIndex(
      { email: 1 },
      { unique: true, name: 'users_email_unique_idx' }
    );

    // 2. equipment.status index
    await equipmentCollection.createIndex(
      { status: 1 },
      { name: 'equipment_status_idx' }
    );

    // 3. equipment.category index
    await equipmentCollection.createIndex(
      { category: 1 },
      { name: 'equipment_category_idx' }
    );

    // 4. text index on equipment name and location
    const textIndexSpec: IndexSpecification = {
      name: 'text',
      location: 'text',
    };
    await equipmentCollection.createIndex(textIndexSpec, {
      name: 'equipment_name_location_text_idx',
      weights: {
        name: 3,
        location: 1,
      },
    });

    // 5. favorites unique index on (userId, equipmentId)
    const favoritesCollection = db.collection<Favorite>(COLLECTIONS.FAVORITES);
    await favoritesCollection.createIndex(
      { userId: 1, equipmentId: 1 },
      { unique: true, name: 'favorites_user_equipment_unique_idx' }
    );

    indexesInitialized = true;
    console.log('MongoDB indexes ensured successfully.');
  } catch (error) {
    console.error('Failed to create MongoDB indexes:', error);
    throw error;
  }
};

export const ensureIndexesOnce = async (db?: Db): Promise<void> => {
  if (indexesInitialized) return;
  await initIndexes(db);
};

export default getClientPromise;
