const express = require('express');
const router = express.Router();

// Auth Middleware
const requireAuth = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ message: 'Yetkisiz erişim' });
    next();
};

// GET Dashboard Stats
router.get('/stats', requireAuth, async (req, res) => {
    try {
        const db = req.db;

        const [dealers] = await db.execute('SELECT COUNT(*) as count FROM dealers');
        const [activeLicenses] = await db.execute('SELECT COUNT(*) as count FROM licenses WHERE is_active = 1');
        const [todayBackups] = await db.execute('SELECT COUNT(*) as count FROM cloud_backups WHERE created_at >= CURDATE()');

        // Mock revenue logic (or aggregate from sales table if exists)
        const [revenue] = await db.execute('SELECT SUM(price) as total FROM licenses');
        const totalRevenue = revenue[0].total || 0;

        res.json({
            totalDealers: dealers[0].count,
            activeLicenses: activeLicenses[0].count,
            recentBackups: todayBackups[0].count,
            totalRevenue // Placeholder
        });

    } catch (error) {
        console.error('Stats error:', error);
        res.status(500).json({ message: 'İstatistik hatası' });
    }
});

// GET Activity Logs
router.get('/activity', requireAuth, async (req, res) => {
    try {
        // Fetch last 10 activities, join with dealers to get names
        const [rows] = await req.db.execute(`
            SELECT l.id, l.action_type as action, l.description, l.created_at as timestamp, d.name as dealerName
            FROM remote_activity_log l
            LEFT JOIN dealers d ON l.dealer_id = d.id
            ORDER BY l.created_at DESC
            LIMIT 10
        `);

        // Format for frontend
        const formatted = rows.map(row => ({
            id: row.id,
            action: row.action,
            description: `${row.dealerName ? row.dealerName + ': ' : ''}${row.description}`,
            timestamp: row.timestamp,
            type: determineType(row.action)
        }));

        res.json(formatted);

    } catch (error) {
        console.error('Activity error:', error);
        res.status(500).json({ message: 'Log hatası' });
    }
});

function determineType(action) {
    if (action.includes('ERROR') || action.includes('VIOLATION')) return 'error';
    if (action.includes('WARNING')) return 'warning';
    if (action.includes('SUCCESS') || action.includes('ACTIVATED')) return 'success';
    return 'info';
}

module.exports = router;
