import app from './src/app';
import { Server } from 'http';
import * as dbConfig from './src/config/db';
import { Equipment } from './src/types/models';

let server: Server;

async function runPublicEquipmentTests() {
  console.log('--- Starting Public Equipment Routes End-to-End Tests ---');
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, msg: string) {
    if (condition) {
      console.log(`[PASS] ${msg}`);
      passed++;
    } else {
      console.error(`[FAIL] ${msg}`);
      failed++;
    }
  }

  const equipmentDatabase: Map<string, Equipment> = new Map();

  // Create test items with various properties
  const testItems: Equipment[] = [
    {
      _id: 'eq_app_1' as any,
      id: 'eq_app_1',
      name: 'Diesel Generator 50kW',
      description: 'Reliable industrial diesel generator',
      category: 'Power Tools',
      location: 'Austin, TX',
      price: 150,
      rentalType: 'daily',
      quantity: 3,
      condition: 'Excellent',
      brand: 'Generac',
      model: 'GD-50',
      image: 'https://example.com/gen50.jpg',
      terms: 'Standard terms',
      status: 'approved',
      ownerId: 'owner_1',
      createdAt: new Date('2026-01-01T10:00:00Z'),
      updatedAt: new Date('2026-01-01T10:00:00Z'),
    },
    {
      _id: 'eq_app_2' as any,
      id: 'eq_app_2',
      name: 'Compact Mini Excavator',
      description: 'Kubota mini excavator for tight spaces',
      category: 'Heavy Machinery',
      location: 'Dallas, TX',
      price: 350,
      rentalType: 'daily',
      quantity: 1,
      condition: 'Good',
      brand: 'Kubota',
      model: 'KX040',
      image: 'https://example.com/kx40.jpg',
      terms: 'Operator license',
      status: 'available',
      ownerId: 'owner_1',
      createdAt: new Date('2026-01-02T10:00:00Z'),
      updatedAt: new Date('2026-01-02T10:00:00Z'),
    },
    {
      _id: 'eq_app_3' as any,
      id: 'eq_app_3',
      name: 'Rotary Hammer Drill',
      description: 'Heavy duty SDS-Plus hammer drill',
      category: 'Power Tools',
      location: 'Houston, TX',
      price: 45,
      rentalType: 'daily',
      quantity: 5,
      condition: 'New',
      brand: 'Bosch',
      model: 'RH328',
      image: 'https://example.com/bosch.jpg',
      terms: 'Deposit required',
      status: 'approved',
      ownerId: 'owner_2',
      createdAt: new Date('2026-01-03T10:00:00Z'),
      updatedAt: new Date('2026-01-03T10:00:00Z'),
    },
    {
      _id: 'eq_app_4' as any,
      id: 'eq_app_4',
      name: 'Scissor Lift 26ft',
      description: 'Electric slab scissor lift for indoor maintenance',
      category: 'Access Equipment',
      location: 'Austin, TX',
      price: 220,
      rentalType: 'weekly',
      quantity: 2,
      condition: 'Good',
      brand: 'Genie',
      model: 'GS-2632',
      image: 'https://example.com/genie.jpg',
      terms: 'Harness required',
      status: 'approved',
      ownerId: 'owner_2',
      createdAt: new Date('2026-01-04T10:00:00Z'),
      updatedAt: new Date('2026-01-04T10:00:00Z'),
    },
    {
      _id: 'eq_app_5' as any,
      id: 'eq_app_5',
      name: 'Skid Steer Loader',
      description: 'High capacity wheel skid steer loader',
      category: 'Heavy Machinery',
      location: 'San Antonio, TX',
      price: 500,
      rentalType: 'monthly',
      quantity: 0, // Out of stock / unavailable
      condition: 'Fair',
      brand: 'Bobcat',
      model: 'S650',
      image: 'https://example.com/bobcat.jpg',
      terms: 'Insurance needed',
      status: 'approved',
      ownerId: 'owner_1',
      createdAt: new Date('2026-01-05T10:00:00Z'),
      updatedAt: new Date('2026-01-05T10:00:00Z'),
    },
    {
      _id: 'eq_app_6' as any,
      id: 'eq_app_6',
      name: 'Telescopic Boom Lift',
      description: '45ft rough terrain telescopic boom lift',
      category: 'Access Equipment',
      location: 'Dallas, TX',
      price: 650,
      rentalType: 'weekly',
      quantity: 1,
      condition: 'Excellent',
      brand: 'JLG',
      model: '450AJ',
      image: 'https://example.com/jlg.jpg',
      terms: 'Safety cert required',
      status: 'approved',
      ownerId: 'owner_2',
      createdAt: new Date('2026-01-06T10:00:00Z'),
      updatedAt: new Date('2026-01-06T10:00:00Z'),
    },
    {
      _id: 'eq_app_7' as any,
      id: 'eq_app_7',
      name: 'Air Compressor Portable',
      description: 'Gas powered portable air compressor 185 CFM',
      category: 'Power Tools',
      location: 'Austin, TX',
      price: 180,
      rentalType: 'daily',
      quantity: 2,
      condition: 'Good',
      brand: 'Doosan',
      model: 'P185',
      image: 'https://example.com/doosan.jpg',
      terms: 'Standard terms',
      status: 'approved',
      ownerId: 'owner_1',
      createdAt: new Date('2026-01-07T10:00:00Z'),
      updatedAt: new Date('2026-01-07T10:00:00Z'),
    },
    // Non-approved items: must NOT appear in public listing
    {
      _id: 'eq_pending_1' as any,
      id: 'eq_pending_1',
      name: 'Pending Concrete Mixer',
      description: 'Should not appear in public listing',
      category: 'Construction',
      location: 'Austin, TX',
      price: 80,
      rentalType: 'daily',
      quantity: 1,
      condition: 'New',
      brand: 'Toro',
      model: 'CM',
      image: 'https://example.com/mixer.jpg',
      terms: 'Terms',
      status: 'pending',
      ownerId: 'owner_1',
      createdAt: new Date('2026-01-08T10:00:00Z'),
      updatedAt: new Date('2026-01-08T10:00:00Z'),
    },
    {
      _id: 'eq_rejected_1' as any,
      id: 'eq_rejected_1',
      name: 'Rejected Forklift',
      description: 'Should not appear in public listing',
      category: 'Heavy Machinery',
      location: 'Dallas, TX',
      price: 200,
      rentalType: 'daily',
      quantity: 1,
      condition: 'Poor',
      brand: 'Toyota',
      model: 'FL',
      image: 'https://example.com/fl.jpg',
      terms: 'Terms',
      status: 'rejected',
      ownerId: 'owner_2',
      createdAt: new Date('2026-01-09T10:00:00Z'),
      updatedAt: new Date('2026-01-09T10:00:00Z'),
    },
  ];

  for (const item of testItems) {
    equipmentDatabase.set(item.id || item._id?.toString() || '', item);
  }

  // Filter evaluation engine for in-memory tests
  function filterItems(query: any) {
    return Array.from(equipmentDatabase.values()).filter((item) => {
      // 1. status check
      if (query.status) {
        if (query.status.$in) {
          if (!query.status.$in.includes(item.status)) return false;
        } else if (item.status !== query.status) {
          return false;
        }
      }

      // 2. $or (search)
      if (query.$or) {
        const matches = query.$or.some((clause: any) => {
          if (clause.name?.$regex) {
            const re = new RegExp(clause.name.$regex, clause.name.$options || '');
            if (re.test(item.name)) return true;
          }
          if (clause.location?.$regex) {
            const re = new RegExp(clause.location.$regex, clause.location.$options || '');
            if (re.test(item.location)) return true;
          }
          return false;
        });
        if (!matches) return false;
      }

      // 3. category
      if (query.category) {
        if (query.category.$regex) {
          const re = new RegExp(query.category.$regex, query.category.$options || '');
          if (!re.test(item.category)) return false;
        } else if (item.category.toLowerCase() !== query.category.toLowerCase()) {
          return false;
        }
      }

      // 4. rentalType
      if (query.rentalType) {
        if (item.rentalType.toLowerCase() !== query.rentalType.toLowerCase()) return false;
      }

      // 5. price range
      if (query.price) {
        if (query.price.$gte !== undefined && item.price < query.price.$gte) return false;
        if (query.price.$lte !== undefined && item.price > query.price.$lte) return false;
      }

      // 6. $and (e.g. availability)
      if (query.$and) {
        for (const andClause of query.$and) {
          if (andClause.$or) {
            const matches = andClause.$or.some((sub: any) => {
              if (sub.status && item.status === sub.status) return true;
              if (sub.quantity?.$gt !== undefined && item.quantity > sub.quantity.$gt) return true;
              if (sub.quantity?.$lte !== undefined && item.quantity <= sub.quantity.$lte) return true;
              return false;
            });
            if (!matches) return false;
          }
        }
      }

      return true;
    });
  }

  const mockEquipmentCollection = {
    find: (query: any) => {
      const filtered = filterItems(query);
      return {
        sort: (sortOptions: any) => {
          let sorted = [...filtered];
          if (sortOptions.price === 1) {
            sorted.sort((a, b) => a.price - b.price);
          } else if (sortOptions.price === -1) {
            sorted.sort((a, b) => b.price - a.price);
          } else if (sortOptions.createdAt === -1) {
            sorted.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
          }
          return {
            skip: (skipCount: number) => ({
              limit: (limitCount: number) => ({
                toArray: async () => sorted.slice(skipCount, skipCount + limitCount),
              }),
            }),
            limit: (limitCount: number) => ({
              toArray: async () => sorted.slice(0, limitCount),
            }),
            toArray: async () => sorted,
          };
        },
      };
    },
    countDocuments: async (query: any) => {
      return filterItems(query).length;
    },
    findOne: async (filter: any) => {
      const targetId = filter.$or
        ? filter.$or.map((f: any) => f._id?.toString() || f.id).find(Boolean)
        : filter._id?.toString() || filter.id;

      for (const eq of equipmentDatabase.values()) {
        if (targetId && (eq._id?.toString() === targetId || eq.id === targetId)) {
          return eq;
        }
      }
      return null;
    },
  };

  dbConfig.setCollectionsGetter(async () => {
    return {
      users: {} as any,
      equipment: mockEquipmentCollection as any,
      bookings: {} as any,
      payments: {} as any,
      favorites: {} as any,
      reviews: {} as any,
    };
  });

  const port = await new Promise<number>((resolve) => {
    server = app.listen(0, () => {
      resolve((server.address() as any).port);
    });
  });

  const baseUrl = `http://localhost:${port}`;

  try {
    // 1. GET /equipment returns approved items only
    const res1 = await fetch(`${baseUrl}/equipment`);
    const data1 = await res1.json();
    assert(res1.status === 200, 'GET /equipment returns 200');
    assert(Array.isArray(data1.items), 'data.items is an array');
    assert(data1.total === 7, `Total approved items is 7 (got ${data1.total})`);
    assert(
      data1.items.every((it: any) => it.status === 'approved' || it.status === 'available'),
      'All returned items have status approved or available'
    );
    assert(
      !data1.items.some((it: any) => it.status === 'pending' || it.status === 'rejected'),
      'No pending or rejected items are returned'
    );
    assert(data1.totalPages !== undefined, 'data.totalPages is defined');

    // 2. Server-side search by name
    const res2 = await fetch(`${baseUrl}/equipment?search=Excavator`);
    const data2 = await res2.json();
    assert(res2.status === 200, 'Search by name returns 200');
    assert(data2.items.length === 1, 'Found 1 item matching "Excavator"');
    assert(data2.items[0].name.includes('Excavator'), 'Found correct Excavator item');

    // 3. Server-side search by location
    const res3 = await fetch(`${baseUrl}/equipment?search=Houston`);
    const data3 = await res3.json();
    assert(res3.status === 200, 'Search by location returns 200');
    assert(data3.items.length === 1, 'Found 1 item matching "Houston"');
    assert(data3.items[0].location.includes('Houston'), 'Found correct Houston item');

    // 4. Filter by category
    const res4 = await fetch(`${baseUrl}/equipment?category=Power%20Tools`);
    const data4 = await res4.json();
    assert(res4.status === 200, 'Filter by category returns 200');
    assert(data4.items.length === 3, `Found 3 Power Tools items (got ${data4.items.length})`);
    assert(
      data4.items.every((it: any) => it.category === 'Power Tools'),
      'All items belong to Power Tools'
    );

    // 5. Filter by rentalType
    const res5 = await fetch(`${baseUrl}/equipment?rentalType=weekly`);
    const data5 = await res5.json();
    assert(res5.status === 200, 'Filter by rentalType returns 200');
    assert(data5.items.length === 2, `Found 2 weekly items (got ${data5.items.length})`);
    assert(
      data5.items.every((it: any) => it.rentalType === 'weekly'),
      'All items have weekly rentalType'
    );

    // 6. Filter by min/max price
    const res6 = await fetch(`${baseUrl}/equipment?minPrice=100&maxPrice=300`);
    const data6 = await res6.json();
    assert(res6.status === 200, 'Filter by min/max price returns 200');
    assert(
      data6.items.every((it: any) => it.price >= 100 && it.price <= 300),
      'All items in price range [100, 300]'
    );
    assert(data6.items.length === 3, `Found 3 items in price range [100, 300] (got ${data6.items.length})`);

    // 7. Filter by availability (available items)
    const res7 = await fetch(`${baseUrl}/equipment?availability=true`);
    const data7 = await res7.json();
    assert(res7.status === 200, 'Filter by availability=true returns 200');
    assert(
      !data7.items.some((it: any) => it.id === 'eq_app_5'),
      'Unavailable item (quantity 0) excluded when availability=true'
    );
    assert(data7.items.length === 6, `Found 6 available items (got ${data7.items.length})`);

    // 8. Sorting: price_asc
    const res8 = await fetch(`${baseUrl}/equipment?sort=price_asc`);
    const data8 = await res8.json();
    assert(res8.status === 200, 'Sort price_asc returns 200');
    assert(data8.items[0].price <= data8.items[1].price, 'First item price <= second item price');
    assert(data8.items[0].price === 45, 'Cheapest item is 45');

    // 9. Sorting: price_desc
    const res9 = await fetch(`${baseUrl}/equipment?sort=price_desc`);
    const data9 = await res9.json();
    assert(res9.status === 200, 'Sort price_desc returns 200');
    assert(data9.items[0].price >= data9.items[1].price, 'First item price >= second item price');
    assert(data9.items[0].price === 650, 'Most expensive item is 650');

    // 10. Pagination: limit and page
    const res10 = await fetch(`${baseUrl}/equipment?page=2&limit=3`);
    const data10 = await res10.json();
    assert(res10.status === 200, 'Pagination page 2 returns 200');
    assert(data10.items.length === 3, 'Page 2 contains 3 items');
    assert(data10.total === 7, 'Total items is 7');
    assert(data10.totalPages === 3, 'Total pages is 3');

    // 11. GET /equipment/featured (6 approved items using limit)
    const res11 = await fetch(`${baseUrl}/equipment/featured`);
    const data11 = await res11.json();
    assert(res11.status === 200, 'GET /equipment/featured returns 200');
    assert(Array.isArray(data11.items), 'Featured items is an array');
    assert(data11.items.length === 6, `Featured returns exactly 6 items (got ${data11.items.length})`);
    assert(
      data11.items.every((it: any) => it.status === 'approved' || it.status === 'available'),
      'All featured items are approved'
    );

    // 12. GET /equipment/:id
    const res12 = await fetch(`${baseUrl}/equipment/eq_app_1`);
    const data12 = await res12.json();
    assert(res12.status === 200, 'GET /equipment/:id for existing item returns 200');
    assert(data12.equipment.name === 'Diesel Generator 50kW', 'Retrieved item has correct name');

    // 13. GET /equipment/:id for non-existent item -> 404
    const res13 = await fetch(`${baseUrl}/equipment/non_existent_id`);
    assert(res13.status === 404, 'GET /equipment/:id for non-existent item returns 404');

  } finally {
    server.close();
  }

  console.log(`\nPublic Equipment Route Tests finished: ${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

runPublicEquipmentTests().catch((err) => {
  console.error('Fatal error during public equipment route tests:', err);
  if (server) server.close();
  process.exit(1);
});
