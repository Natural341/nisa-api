const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');

// Auth Middleware (Basit kontrol)
// Gerçekte auth.js'den export edilen bir middleware kullanılmalı
const requireAuth = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ message: 'Yetkisiz erişim' });
    // Token verify işlemi burada yapılmalı, şimdilik basit geçiyoruz
    next();
};

// GET All Dealers
router.get('/', requireAuth, async (req, res) => {
    try {
        const [rows] = await req.db.execute(`
            SELECT d.*, 
            (SELECT COUNT(*) FROM licenses l WHERE l.dealer_id = d.id AND l.expires_at > NOW()) as active_licenses,
            (SELECT MAX(expires_at) FROM licenses l WHERE l.dealer_id = d.id) as latest_expiration
            FROM dealers d 
            ORDER BY created_at DESC
        `);
        res.json(rows);
    } catch (error) {
        console.error('Fetch dealers error:', error);
        res.status(500).json({ message: 'Veri çekme hatası' });
    }
});

// GET Single Dealer
router.get('/:id', requireAuth, async (req, res) => {
    try {
        const [rows] = await req.db.execute('SELECT * FROM dealers WHERE id = ?', [req.params.id]);
        if (rows.length === 0) return res.status(404).json({ message: 'Bayi bulunamadı' });
        res.json(rows[0]);
    } catch (error) {
        res.status(500).json({ message: 'Veri çekme hatası' });
    }
});

// CREATE Dealer
router.post('/', requireAuth, async (req, res) => {
    const { name, email, phone } = req.body;
    if (!name) return res.status(400).json({ message: 'İsim gerekli' });

    const id = uuidv4();
    try {
        await req.db.execute(
            'INSERT INTO dealers (id, name, email, phone) VALUES (?, ?, ?, ?)',
            [id, name, email, phone]
        );
        res.status(201).json({ id, name, email, phone, created_at: new Date() });
    } catch (error) {
        console.error('Create dealer error:', error);
        res.status(500).json({ message: 'Kayıt hatası' });
    }
});

// UPDATE Dealer
router.put('/:id', requireAuth, async (req, res) => {
    const { name, email, phone } = req.body;
    try {
        await req.db.execute(
            'UPDATE dealers SET name = ?, email = ?, phone = ? WHERE id = ?',
            [name, email, phone, req.params.id]
        );
        res.json({ success: true, message: 'Güncellendi' });
    } catch (error) {
        res.status(500).json({ message: 'Güncelleme hatası' });
    }
});

// DELETE Dealer
router.delete('/:id', requireAuth, async (req, res) => {
    try {
        await req.db.execute('DELETE FROM dealers WHERE id = ?', [req.params.id]);
        res.json({ success: true, message: 'Silindi' });
    } catch (error) {
        res.status(500).json({ message: 'Silme hatası' });
    }
});

module.exports = router;
