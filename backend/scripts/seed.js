require('dotenv').config();
const { db } = require('../src/config/database');
const { seedModules } = require('../seeders/001_modules');
const { seedDemoTenant } = require('../seeders/002_demo_tenant');

async function main() {
  await seedModules(db);
  await seedDemoTenant(db);
}

main()
  .then(() => {
    console.log('Seed completo.');
    return db.destroy();
  })
  .catch(async (err) => {
    console.error('Error corriendo seeders:', err);
    await db.destroy();
    process.exit(1);
  });
