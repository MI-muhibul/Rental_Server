import dotenv from 'dotenv';
dotenv.config();
import { MongoClient } from 'mongodb';

async function elevate() {
  const uri = process.env.MONGODB_URI || 'mongodb+srv://admin_user:admin1234@cluster0.rp2anop.mongodb.net/equipment_rental?retryWrites=true&w=majority';
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db('equipment_rental');

  const r1 = await db.collection('user').updateOne(
    { email: 'admin@heavyrent.com' },
    { $set: { role: 'admin' } }
  );
  console.log('Better Auth user updated:', r1.modifiedCount);

  const r2 = await db.collection('users').updateOne(
    { email: 'admin@heavyrent.com' },
    {
      $set: {
        name: 'Superintendent Admin',
        email: 'admin@heavyrent.com',
        role: 'admin',
        updatedAt: new Date(),
      },
      $setOnInsert: {
        createdAt: new Date(),
      },
    },
    { upsert: true }
  );
  console.log('App users collection updated/upserted:', r2.modifiedCount || r2.upsertedCount);

  const u = await db.collection('user').findOne({ email: 'admin@heavyrent.com' });
  console.log('SUCCESS: Admin verified in database:', { email: u?.email, role: u?.role, name: u?.name });

  await client.close();
}

elevate().catch(console.error);
