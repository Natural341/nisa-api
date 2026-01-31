const express = require('express');
const router = express.Router();

// Helper to get remote IP
const getIp = (req) => req.headers['x-forwarded-for'] || req.socket.remoteAddress;

// 0. List Licenses (Admin only)
router.get('/', async (req, res) => {
    try {
        const { dealer_id } = req.query;
        let query = `SELECT l.*, d.name as dealer_name 
                     FROM licenses l 
                     LEFT JOIN dealers d ON l.dealer_id = d.id`;
        let params = [];

        if (dealer_id) {
            query += ` WHERE l.dealer_id = ?`;
            params.push(dealer_id);
        }

        query += ` ORDER BY l.created_at DESC`;

        const [rows] = await req.db.execute(query, params);

        // Map to frontend format
        const formatted = rows.map(row => ({
            id: row.id,
            key: row.license_key,
            dealerId: row.dealer_id,
            dealerName: row.dealer_name,
            macAddress: row.mac_address,
            status: row.is_active ? 'active' : 'revoked',
            expiryDate: row.expires_at,
            maxDevices: 1, // Default
            price: parseFloat(row.price || 0)
        }));

        res.json(formatted);
    } catch (error) {
        console.error('List licenses error:', error);
        res.status(500).json({ message: 'Listeleme hatası' });
    }
});

// 0. Generate License (Admin only)
// 0. Generate License (Admin only)
router.post('/generate', async (req, res) => {
    const { dealer_id, expiry_date, max_devices, price } = req.body;

    if (!dealer_id) return res.status(400).json({ message: 'Bayi seçilmeli' });

    try {
        // Generate Key: XXXX-YYYY-ZZZZ-WWWW
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let key = '';
        for (let i = 0; i < 4; i++) {
            let segment = '';
            for (let j = 0; j < 4; j++) segment += chars.charAt(Math.floor(Math.random() * chars.length));
            key += (i < 3 ? segment + '-' : segment);
        }

        await req.db.execute(
            `INSERT INTO licenses (license_key, dealer_id, expires_at, price) VALUES (?, ?, ?, ?)`,
            [key, dealer_id, expiry_date || null, price || 0]
        );

        res.json({
            success: true,
            key,
            dealer_id,
            expires_at: expiry_date,
            price: price || 0
        });

    } catch (error) {
        console.error('Generate license error:', error);
        res.status(500).json({ message: 'Oluşturma hatası' });
    }
});

// 2. Extend License (Admin only)
router.post('/extend', async (req, res) => {
    const { license_id, duration_type } = req.body; // duration_type: '1year', '1month' etc.

    if (!license_id) return res.status(400).json({ message: 'Lisans ID gerekli' });

    try {
        // Get current license
        const [rows] = await req.db.execute('SELECT * FROM licenses WHERE id = ?', [license_id]);
        if (rows.length === 0) return res.status(404).json({ message: 'Lisans bulunamadı' });

        const license = rows[0];
        let newExpiry = new Date(license.expires_at);

        // If already expired, start from now
        if (newExpiry < new Date()) {
            newExpiry = new Date();
        }

        // Add duration
        if (duration_type === '1year') {
            newExpiry.setFullYear(newExpiry.getFullYear() + 1);
        } else if (duration_type === '6months') {
            newExpiry.setMonth(newExpiry.getMonth() + 6);
        } else if (duration_type === '1month') {
            newExpiry.setMonth(newExpiry.getMonth() + 1);
        } else {
            // Default 1 year if unknown
            newExpiry.setFullYear(newExpiry.getFullYear() + 1);
        }

        await req.db.execute(
            'UPDATE licenses SET expires_at = ? WHERE id = ?',
            [newExpiry, license_id]
        );

        res.json({ success: true, new_expiry: newExpiry });

    } catch (error) {
        console.error('License extend error:', error);
        res.status(500).json({ message: 'Uzatma hatası' });
    }
});

// 1. Validate License (Program her açılışta buraya soracak)
router.post('/validate', async (req, res) => {
    const { license_key, mac_address } = req.body;
    const db = req.db;

    if (!license_key || !mac_address) {
        return res.status(400).json({ valid: false, message: 'Eksik bilgi' });
    }

    try {
        const [rows] = await db.execute(
            `SELECT l.*, d.name as dealer_name 
             FROM licenses l 
             LEFT JOIN dealers d ON l.dealer_id = d.id 
             WHERE l.license_key = ?`,
            [license_key]
        );

        if (rows.length === 0) {
            return res.json({ valid: false, message: 'Geçersiz lisans anahtarı' });
        }

        const license = rows[0];

        // Kontroller
        if (!license.is_active) {
            return res.json({ valid: false, message: 'Lisans pasif durumda' });
        }

        // Donanım Kilidi Kontrolü (Hardware Lock)
        // Eğer MAC adresi kayıtlıysa ve gelenle uyuşmuyorsa -> Çalıntı/Kopyalama girişimi
        if (license.mac_address && license.mac_address !== mac_address) {
            await logActivity(db, license.dealer_id, 'LICENSE_VIOLATION', `MAC uyuşmazlığı: Kayıtlı=${license.mac_address}, Gelen=${mac_address}`, getIp(req));
            return res.json({ valid: false, message: 'Bu lisans başka bir bilgisayara tanımlı!' });
        }

        // Süre Kontrolü
        if (license.expires_at && new Date(license.expires_at) < new Date()) {
            return res.json({ valid: false, message: 'Lisans süresi dolmuş' });
        }

        // Her şey yolunda
        res.json({
            valid: true,
            dealer_id: license.dealer_id,
            dealer_name: license.dealer_name,
            expires_at: license.expires_at
        });

    } catch (error) {
        console.error('License validation error:', error);
        res.status(500).json({ valid: false, message: 'Sunucu hatası' });
    }
});

// 2. Activate License (İlk kurulumda çalışır)
router.post('/activate', async (req, res) => {
    const { license_key, mac_address, device_name } = req.body;
    const db = req.db;

    if (!license_key || !mac_address) {
        return res.status(400).json({ success: false, message: 'Eksik bilgi' });
    }

    try {
        // Lisansı bul
        const [rows] = await db.execute(
            `SELECT l.*, d.name as dealer_name 
             FROM licenses l 
             LEFT JOIN dealers d ON l.dealer_id = d.id 
             WHERE l.license_key = ?`,
            [license_key]
        );

        if (rows.length === 0) {
            return res.json({ success: false, message: 'Geçersiz lisans anahtarı' });
        }

        const license = rows[0];

        // Zaten dolu mu?
        if (license.activated_at && license.mac_address) {
            // Eğer aynı bilgisayarsa tekrar aktive etmeye çalışıyorsa sorun yok (Format atmış olabilir)
            if (license.mac_address === mac_address) {
                return res.json({
                    success: true,
                    dealer_id: license.dealer_id,
                    dealer_name: license.dealer_name,
                    expires_at: license.expires_at,
                    message: 'Lisans zaten bu cihazda aktif.'
                });
            }
            return res.json({ success: false, message: 'Bu lisans zaten başka bir cihazda kullanılıyor.' });
        }

        // Aktivasyonu yap (Cihaza kilitle)
        await db.execute(
            `UPDATE licenses 
             SET mac_address = ?, device_name = ?, activated_at = NOW() 
             WHERE id = ?`,
            [mac_address, device_name || 'Bilinmeyen Cihaz', license.id]
        );

        await logActivity(db, license.dealer_id, 'LICENSE_ACTIVATED', `Cihaz: ${device_name}`, getIp(req));

        res.json({
            success: true,
            dealer_id: license.dealer_id,
            dealer_name: license.dealer_name,
            activated_at: new Date(),
            expires_at: license.expires_at
        });

    } catch (error) {
        console.error('License activation error:', error);
        res.status(500).json({ success: false, message: 'Sunucu hatası' });
    }
});

// Helper Function for Logs
async function logActivity(db, dealerId, type, desc, ip) {
    try {
        await db.execute(
            `INSERT INTO remote_activity_log (dealer_id, action_type, description, ip_address) VALUES (?, ?, ?, ?)`,
            [dealerId, type, desc, ip]
        );
    } catch (e) {
        console.error('Logging failed', e);
    }
}

module.exports = router;
