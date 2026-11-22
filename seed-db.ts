import dotenv from 'dotenv';
dotenv.config();

import { getDb, getCollections, initIndexes } from './src/config/db';

async function seed() {
  console.log('--- Initializing MongoDB Atlas Database ---');
  const db = await getDb();
  console.log(`Connected to database: ${db.databaseName}`);

  // 1. Initialize Indexes
  console.log('Creating database indexes...');
  await initIndexes(db);
  console.log('Indexes created successfully!');

  const { equipment, users } = await getCollections();

  // 2. Seed Initial Fleet if empty
  const eqCount = await equipment.countDocuments();
  console.log(`Current equipment count in Atlas: ${eqCount}`);

  if (eqCount === 0) {
    console.log('Seeding initial approved fleet assets...');
    const fleetAssets = [
      {
        name: 'Caterpillar 320 Hydraulic Excavator',
        description: '20-Ton operating weight excavator with 0.9m³ heavy-duty digging bucket and auxiliary hydraulics.',
        category: 'Construction',
        rentalType: 'daily',
        price: 450,
        pricePerDay: 450,
        quantity: 3,
        location: 'Dallas Central Yard, TX',
        image: 'https://images.unsplash.com/photo-1578328819058-b69f3a3b0f6b?auto=format&fit=crop&w=800&q=80',
        brand: 'Caterpillar',
        model: '320 GC',
        condition: 'Heavy Industrial • Grade A',
        terms: 'Operator certification required. Standard insurance liability coverage applies.',
        status: 'approved',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        name: 'Komatsu WA380-8 Wheel Loader',
        description: '191 HP turbocharged wheel loader with 3.3m³ high-capacity material handling bucket.',
        category: 'Construction',
        rentalType: 'daily',
        price: 380,
        pricePerDay: 380,
        quantity: 2,
        location: 'Houston Heavy Hub, TX',
        image: 'https://images.unsplash.com/photo-1581094288338-2314dddb7ece?auto=format&fit=crop&w=800&q=80',
        brand: 'Komatsu',
        model: 'WA380-8',
        condition: 'Heavy Industrial • Grade A',
        terms: 'Site pre-inspection required prior to dispatch.',
        status: 'approved',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        name: 'Dynapac CA2500 Soil Compactor',
        description: 'High-frequency vibratory soil compactor engineered for heavy roadbed and foundation preparation.',
        category: 'Construction',
        rentalType: 'daily',
        price: 240,
        pricePerDay: 240,
        quantity: 4,
        location: 'Austin Highway Depot, TX',
        image: 'https://images.unsplash.com/photo-1504307651254-35680f356dfd?auto=format&fit=crop&w=800&q=80',
        brand: 'Dynapac',
        model: 'CA2500',
        condition: 'Heavy Industrial • Grade A',
        terms: 'Daily hour meter log required.',
        status: 'approved',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        name: 'Sony FX9 Full-Frame Cinema Package',
        description: '6K Full-Frame cinema camera rig with dual native ISO, 28-135mm zoom and V-mount power module.',
        category: 'Photography',
        rentalType: 'daily',
        price: 320,
        pricePerDay: 320,
        quantity: 2,
        location: 'Dallas Studio Bay, TX',
        image: 'https://images.unsplash.com/photo-1516035069371-29a1b244cc32?auto=format&fit=crop&w=800&q=80',
        brand: 'Sony',
        model: 'FX9',
        condition: 'Production Ready • Grade A',
        terms: 'Equipment insurance mandatory.',
        status: 'approved',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        name: 'Peterbilt 389 Heavy Haul Lowboy',
        description: '55-Ton capacity detachable gooseneck tri-axle lowboy trailer for heavy machinery transport.',
        category: 'Vehicles & Transportation',
        rentalType: 'daily',
        price: 650,
        pricePerDay: 650,
        quantity: 2,
        location: 'San Antonio Logistics Yard, TX',
        image: 'https://images.unsplash.com/photo-1601584115197-04ecc0da31d7?auto=format&fit=crop&w=800&q=80',
        brand: 'Peterbilt',
        model: '389 Lowboy',
        condition: 'Commercial Heavy Haul',
        terms: 'CDL Class A required for driver.',
        status: 'approved',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        name: 'John Deere 8R 370 Row Crop Tractor',
        description: '370 HP intelligent agricultural powerhouse with dual tires, ILS front suspension and AutoTrac.',
        category: 'Agriculture',
        rentalType: 'daily',
        price: 490,
        pricePerDay: 490,
        quantity: 2,
        location: 'Lubbock Agricultural Station, TX',
        image: 'https://images.unsplash.com/photo-1592982537447-7440770cbfc9?auto=format&fit=crop&w=800&q=80',
        brand: 'John Deere',
        model: '8R 370',
        condition: 'Field Certified',
        terms: 'Fuel policy: return full.',
        status: 'approved',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        name: 'Cummins QSK23 500kVA Mobile Generator',
        description: '400kW prime diesel generator mounted on sound-attenuated tandem highway trailer.',
        category: 'Electronics',
        rentalType: 'weekly',
        price: 1850,
        pricePerDay: 300,
        quantity: 3,
        location: 'Houston Energy Depot, TX',
        image: 'https://images.unsplash.com/photo-1581092335397-9583fe92d232?auto=format&fit=crop&w=800&q=80',
        brand: 'Cummins',
        model: 'QSK23',
        condition: 'Heavy Industrial • Sound Attenuated',
        terms: 'Load test report provided on delivery.',
        status: 'approved',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        name: 'Modular Concert Staging & Roof Truss System',
        description: '40x40 modular aluminum stage with weather canopy, safety rails, and integrated rigging towers.',
        category: 'Event',
        rentalType: 'weekly',
        price: 2400,
        pricePerDay: 400,
        quantity: 1,
        location: 'Austin Event Warehouse, TX',
        image: 'https://images.unsplash.com/photo-1501281668745-f7f57925c3b4?auto=format&fit=crop&w=800&q=80',
        brand: 'Prolyte',
        model: 'M40 Truss',
        condition: 'Certified Rigging',
        terms: 'Professional rigging crew required.',
        status: 'approved',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        name: 'Bobcat T770 Compact Track Loader',
        description: '92 HP vertical lift path compact track loader suited for aggressive grading in tight job sites.',
        category: 'Construction',
        rentalType: 'daily',
        price: 290,
        pricePerDay: 290,
        quantity: 5,
        location: 'Fort Worth Yard, TX',
        image: 'https://images.unsplash.com/photo-1541888946425-d0fbb186c5f7?auto=format&fit=crop&w=800&q=80',
        brand: 'Bobcat',
        model: 'T770',
        condition: 'Heavy Industrial • Grade A',
        terms: 'Daily track tension inspection required.',
        status: 'approved',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    await equipment.insertMany(fleetAssets as any);
    console.log(`Successfully seeded ${fleetAssets.length} heavy equipment assets into MongoDB Atlas!`);
  } else {
    console.log('Equipment collection already contains records. Skipping seed.');
  }

  console.log('\n--- MongoDB Atlas initialization complete! ---');
  process.exit(0);
}

seed().catch((err) => {
  console.error('Seed error:', err);
  process.exit(1);
});
