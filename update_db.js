const mysql = require('mysql2/promise');
require('dotenv').config();

async function updateDb() {
    const connection = await mysql.createConnection({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME
    });

    try {
        console.log('Connected to database.');

        // Add price column to licenses
        try {
            await connection.execute('ALTER TABLE licenses ADD COLUMN price DECIMAL(10, 2) DEFAULT 0');
            console.log('Added price column to licenses table.');
        } catch (e) {
            if (e.code === 'ER_DUP_FIELDNAME') {
                console.log('price column already exists in licenses.');
            } else {
                console.error('Error adding price column:', e);
            }
        }

    } catch (error) {
        console.error('Update DB error:', error);
    } finally {
        await connection.end();
    }
}

updateDb();
