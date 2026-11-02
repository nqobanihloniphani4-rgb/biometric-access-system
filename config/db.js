const { Pool } = require('pg');
require('dotenv').config();

// Automatically detect if your DATABASE_URL points to a local instance
const connectionString = process.env.DATABASE_URL || '';
const isLocal = connectionString.includes('localhost') || connectionString.includes('127.0.0.1');

const pool = new Pool({
    connectionString: connectionString,
    // Only use SSL if it's NOT a local database connection
    ssl: isLocal ? false : {
        rejectUnauthorized: false
    }
});

pool.on('connect', () => {
    console.log('Connected to PostgreSQL database');
});

pool.on('error', (err) => {
    console.error('Unexpected error on idle database client', err);
});

module.exports = pool;