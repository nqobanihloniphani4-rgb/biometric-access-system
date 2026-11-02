const bcrypt = require('bcrypt');
const pool = require('./config/db'); // Updated to match your server's config path

async function seedAdmin() {
    try {
        const hashedPassword = await bcrypt.hash('ChangeMe123!', 10);
        
        // PostgreSQL parameterised query format
        const query = `
            INSERT INTO users (username, email, password_hash, role) 
            VALUES ($1, $2, $3, 'admin')
            ON CONFLICT (username) DO NOTHING;
        `;
        
        await pool.query(query, ['admin', 'client@company.com', hashedPassword]);
        
        console.log('✅ Default admin account seeded successfully!');
        process.exit(0);
    } catch (err) {
        console.error('❌ Error seeding admin user:', err.message);
        process.exit(1);
    }
}

seedAdmin();