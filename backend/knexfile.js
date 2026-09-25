require('dotenv').config();

/**
 * Config de Knex, usada tanto por la CLI (migrate/seed) como por
 * src/config/database.js para crear el pool de conexión de la app.
 */
const base = {
  client: 'pg',
  connection: {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 5432,
    database: process.env.DB_NAME || 'school_saas',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  },
  pool: {
    min: Number(process.env.DB_POOL_MIN) || 2,
    max: Number(process.env.DB_POOL_MAX) || 10,
  },
  migrations: {
    directory: './migrations',
    tableName: 'knex_migrations',
    // Las migraciones están escritas en SQL plano (001_init.sql) porque el
    // esquema usa RLS, triggers y extensiones que son más claras en SQL
    // directo que en el DSL de Knex; se cargan vía knexfile.js custom loader
    // en config/database.js (runRawMigrations).
  },
  seeds: {
    directory: './seeders',
  },
};

module.exports = {
  development: base,
  test: {
    ...base,
    connection: { ...base.connection, database: process.env.DB_NAME_TEST || 'school_saas_test' },
  },
  production: {
    ...base,
    connection: {
      ...base.connection,
      ssl: { rejectUnauthorized: false },
    },
    pool: { min: 2, max: 20 },
  },
};
