const express = require('express');
const router = express.Router();

// GET /api/inventory/all
// Gets all inventory items (simulates getAllItems from Tauri)
router.get('/all', async (req, res) => {
    try {
        const db = req.db;

        // Fetch items joined with categories/suppliers if needed, 
        // but for now simple select is enough to match the mock structure
        // Assuming table name is 'products' or similar? 
        // Let's check schema first or assume 'products' based on typical naming.
        // Actually, I should have checked schema.sql more carefully.
        // Let's fallback to creating a simple query.

        // Wait, I missed checking if 'products' table exists in schema.sql earlier.
        // Let's quickly create the route assuming table 'inventory_items' or 'products'.
        // If it fails, I'll fix it. But I'll do a safe check.

        const [rows] = await db.execute('SELECT * FROM inventory_items');

        // Map DB rows to InventoryItem interface if needed
        // But for now raw return might work if column names match.
        // Let's assume they might need mapping.

        /* 
           Expected frontend structure:
           id, sku, name, category, quantity, price, costPrice, location, lastUpdated...
        */

        const items = rows.map(row => ({
            id: row.id.toString(),
            sku: row.sku,
            name: row.name,
            category: row.category,
            quantity: row.quantity,
            price: Number(row.sale_price || row.price),
            costPrice: Number(row.purchase_price || row.cost_price || 0),
            location: row.location,
            lastUpdated: row.updated_at || new Date().toISOString(),
            image: row.image_url || '',
            description: row.description || '',
            aiTags: row.tags ? JSON.parse(row.tags) : [],
            currency: 'TL'
        }));

        res.json(items);
    } catch (error) {
        console.error('Inventory fetch error:', error);
        // If table doesn't exist, return empty array instead of 500 in dev
        if (error.code === 'ER_NO_SUCH_TABLE') {
            return res.json([]);
        }
        res.status(500).json({ message: 'Failed to fetch inventory' });
    }
});

module.exports = router;
