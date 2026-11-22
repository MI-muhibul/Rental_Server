import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';
dotenv.config();

async function inspectDb() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/equipment_rental';
  console.log('Target MongoDB URI:', uri);
  try {
    const client = new MongoClient(uri, { serverSelectionTimeoutMS: 3000 });
    await client.connect();
    console.log('Status: Connected successfully!\n');

    const adminDb = client.db().admin();
    const dbsList = await adminDb.listDatabases();
    console.log('--- Available Databases on Server ---');
    dbsList.databases.forEach((d) => {
      console.log(` • ${d.name} (${Math.round((d.sizeOnDisk || 0) / 1024)} KB)`);
    });

    const db = client.db();
    console.log(`\n--- Active Database: [${db.databaseName}] ---`);
    const collections = await db.listCollections().toArray();

    if (collections.length === 0) {
      console.log('No collections found in this database yet.');
    } else {
      console.log(`Collections (${collections.length}):`);
      for (const colInfo of collections) {
        const col = db.collection(colInfo.name);
        const count = await col.countDocuments();
        console.log(`\n📁 Collection: "${colInfo.name}" (${count} documents)`);

        if (count > 0) {
          const samples = await col.find({}).limit(3).toArray();
          console.log(`   Sample document(s):`);
          console.log(JSON.stringify(samples, null, 2));
        }
      }
    }

    await client.close();
  } catch (err: any) {
    console.error('\n⚠️ Could not connect to MongoDB at ' + uri);
    console.error('Reason:', err.message);
  }
}

inspectDb();
