const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const fs = require('fs');
const path = require('path');

async function seed() {
    // Enable multiple statements for schema execution
    const connection = await mysql.createConnection({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        multipleStatements: true
    });

    try {
        console.log('Connected to database.');

        // Read and Execute Schema
        const schemaPath = path.join(__dirname, 'schema.sql');
        const schemaSql = fs.readFileSync(schemaPath, 'utf8');
        console.log('Executing schema...');
        await connection.query(schemaSql);
        console.log('Schema executed successfully.');

        // Check if admin exists
        const [rows] = await connection.execute('SELECT * FROM admin_users WHERE username = ?', ['admin']);

        if (rows.length > 0) {
            console.log('Admin user already exists.');
        } else {
            // Admin şifresi environment variable'dan alınmalı
            const adminPassword = process.env.ADMIN_PASSWORD;
            if (!adminPassword) {
                console.error('ERROR: ADMIN_PASSWORD environment variable is required for seeding.');
                console.error('Please set ADMIN_PASSWORD in your .env file.');
                process.exit(1);
            }

            const passwordHash = await bcrypt.hash(adminPassword, 10);
            const id = uuidv4();

            await connection.execute(
                'INSERT INTO admin_users (id, username, password_hash, display_name) VALUES (?, ?, ?, ?)',
                [id, 'admin', passwordHash, 'System Owner']
            );
            console.log('Admin user created successfully.');
        }

    } catch (error) {
        console.error('Seed error:', error);
    } finally {
        await connection.end();
    }
}

seed();
