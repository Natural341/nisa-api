const express = require('express');
const router = express.Router();

// Helper to get remote IP
const getIp = (req) => req.headers['x-forwarded-for'] || req.socket.remoteAddress;

// Middleware: Lisans ve Bayi Doğrulama
// Yedekleme yapabilmek için geçerli bir lisans anahtarı ve bayi ID'si şart.
const requireLicense = async (req, res, next) => {
    // Check body first, then headers (headers are lowercase in Express)
    const license_key = req.body.license_key || req.headers['x-license-key'];
    const dealer_id = req.body.dealer_id || req.headers['x-dealer-id'];
    const db = req.db;

    if (!license_key || !dealer_id) {
        return res.status(401).json({ success: false, message: 'Lisans bilgisi eksik' });
    }

    try {
        const [rows] = await db.execute(
            `SELECT * FROM licenses WHERE license_key = ? AND dealer_id = ? AND is_active = 1`,
            [license_key, dealer_id]
        );

        if (rows.length === 0) {
            return res.status(403).json({ success: false, message: 'Yetkisiz erişim: Lisans geçersiz' });
        }

        req.license = rows[0];
        // Inject into body for downstream handlers if they rely on it (optional but safe)
        if (!req.body.dealer_id) req.body.dealer_id = dealer_id;

        next();
    } catch (error) {
        console.error('Auth middleware error:', error);
        res.status(500).json({ success: false, message: 'Sunucu hatası' });
    }
};

// 0. List Backups (Admin only)
router.get('/list', async (req, res) => {
    try {
        const [rows] = await req.db.execute(`
            SELECT b.id, b.dealer_id, b.size_bytes, b.created_at, d.name as dealer_name
            FROM cloud_backups b
            LEFT JOIN dealers d ON b.dealer_id = d.id
            ORDER BY b.created_at DESC
        `);

        // Format
        const formatted = rows.map(row => ({
            id: row.id,
            dealerId: row.dealer_id,
            dealerName: row.dealer_name,
            fileName: `backup_${new Date(row.created_at).toISOString().split('T')[0]}.json`,
            fileSize: `${(row.size_bytes / 1024).toFixed(2)} KB`,
            uploadedAt: row.created_at
        }));

        res.json(formatted);

    } catch (error) {
        console.error('List backups error:', error);
        res.status(500).json({ message: 'Listeleme hatası' });
    }
});

// 1. Upload Backup (Yedek Gönder)
router.post('/backup', requireLicense, async (req, res) => {
    const { dealer_id, backup_data } = req.body; // backup_data: Base64 encoded or JSON string
    const db = req.db;

    if (!backup_data) {
        return res.status(400).json({ success: false, message: 'Yedek verisi yok' });
    }

    // Boyut hesapla (yaklaşık)
    const sizeBytes = Buffer.byteLength(backup_data, 'utf8');

    try {
        // Önceki yedekleri sil (İstersen son 5 yedeği tutacak şekilde geliştirebiliriz)
        // Şimdilik sadece son yedeği tutuyoruz (Storage tasarrufu için)
        await db.execute('DELETE FROM cloud_backups WHERE dealer_id = ?', [dealer_id]);

        // Yeni yedeği kaydet
        const [result] = await db.execute(
            `INSERT INTO cloud_backups (dealer_id, backup_data, size_bytes) VALUES (?, ?, ?)`,
            [dealer_id, backup_data, sizeBytes]
        );

        await logActivity(db, dealer_id, 'BACKUP_UPLOAD', `Boyut: ${(sizeBytes / 1024).toFixed(2)} KB`, getIp(req));

        res.json({
            success: true,
            message: 'Yedek başarıyla yüklendi',
            backup_id: result.insertId,
            timestamp: new Date()
        });

    } catch (error) {
        console.error('Backup error:', error);
        res.status(500).json({ success: false, message: 'Yedekleme sırasında hata oluştu' });
    }
});

// 2. Download Backup (Geri Yükle) - Supports POST (Web) and GET (Rust)
const handleRestore = async (req, res) => {
    const dealer_id = req.body.dealer_id || req.headers['x-dealer-id'];
    const db = req.db;

    try {
        const [rows] = await db.execute(
            `SELECT backup_data, created_at, size_bytes FROM cloud_backups WHERE dealer_id = ? ORDER BY created_at DESC LIMIT 1`,
            [dealer_id]
        );

        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Hiç yedek bulunamadı' });
        }

        const backup = rows[0];

        // If GET request (Rust), return raw bytes (or base64 if that's what Rust expects).
        // Rust expects `response.bytes()`, but `backup_data` in DB is Base64 string (LONGTEXT).
        // Rust `restore_from_cloud_with_conn` does:
        // `let bytes = response.bytes()`
        // `std::fs::write(&temp_path, &bytes)`
        // `Connection::open(&temp_path)`
        // This implies Rust expects the response body to be the SQLITE BINARY FILE.
        // BUT my `backup_to_cloud` stores it as BASE64 encoded string in `backup_data`.
        // So I need to decode it back to binary buffer before sending if Rust expects binary.
        // Let's re-read Rust:
        // `let bytes = response.bytes()` -> gets body as bytes.
        // `std::fs::write` -> writes those bytes.
        // `Connection::open` -> treats file as SQLite DB.
        // If I send JSON `{ backup_data: "base64..." }`, Rust will write that JSON to file and try to open it as SQLite => FAIL.
        // So for GET (Rust), I must return RAW BUFFER.

        // However, `backup_to_cloud` in Rust sends Base64 encoded.
        // Backend stores Base64 string.
        // So I need to decode Base64 -> Buffer.

        if (req.method === 'GET') {
            const buffer = Buffer.from(backup.backup_data, 'base64');
            res.setHeader('Content-Type', 'application/vnd.sqlite3');
            res.setHeader('Content-Disposition', 'attachment; filename="backup.db"');
            return res.send(buffer);
        }

        // For POST (Web interface maybe?), return JSON
        await logActivity(db, dealer_id, 'BACKUP_RESTORE', `Tarih: ${backup.created_at}`, getIp(req));

        res.json({
            success: true,
            backup_data: backup.backup_data,
            timestamp: backup.created_at,
            size_bytes: backup.size_bytes
        });

    } catch (error) {
        console.error('Restore error:', error);
        res.status(500).json({ success: false, message: 'Geri yükleme hatası' });
    }
};

router.post('/restore', requireLicense, handleRestore);
router.get('/restore', requireLicense, handleRestore);

// 3. Status Check (Son yedek ne zaman alındı?)
router.post('/status', requireLicense, async (req, res) => {
    const { dealer_id } = req.body;
    const db = req.db;

    try {
        const [rows] = await db.execute(
            `SELECT created_at, size_bytes FROM cloud_backups WHERE dealer_id = ? ORDER BY created_at DESC LIMIT 1`,
            [dealer_id]
        );

        if (rows.length > 0) {
            res.json({
                has_backup: true,
                last_backup_at: rows[0].created_at,
                backup_size_bytes: rows[0].size_bytes
            });
        } else {
            res.json({
                has_backup: false,
                last_backup_at: null
            });
        }

    } catch (error) {
        console.error('Status check error:', error);
        res.status(500).json({ success: false, message: 'Durum kontrolü hatası' });
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
        // Log hatası akışı bozmasın
        console.error('Logging failed', e);
    }
}

const jwt = require('jsonwebtoken');

// Admin Auth Middleware
const requireAuth = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ message: 'Yetkisiz erişim' });

    if (!process.env.JWT_SECRET) {
        console.error('FATAL: JWT_SECRET environment variable is required!');
        return res.status(500).json({ message: 'Server configuration error' });
    }

    const token = authHeader.split(' ')[1];
    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ message: 'Geçersiz token' });
        req.user = user;
        next();
    });
};

// Admin: Upload Backup (Manual)
router.post('/admin/backup', requireAuth, async (req, res) => {
    const { dealer_id, backup_data } = req.body;
    const db = req.db;

    if (!dealer_id || !backup_data) {
        return res.status(400).json({ success: false, message: 'Eksik bilgi: dealer_id ve backup_data gereklidir.' });
    }

    const sizeBytes = Buffer.byteLength(backup_data, 'utf8'); // It's base64 string, but stored as text

    try {
        await db.execute('DELETE FROM cloud_backups WHERE dealer_id = ?', [dealer_id]);

        const [result] = await db.execute(
            `INSERT INTO cloud_backups (dealer_id, backup_data, size_bytes) VALUES (?, ?, ?)`,
            [dealer_id, backup_data, sizeBytes]
        );

        await logActivity(db, dealer_id, 'BACKUP_UPLOAD_ADMIN', `Boyut: ${(sizeBytes / 1024).toFixed(2)} KB (Manual)`, req.ip);

        res.json({
            success: true,
            message: 'Yedek başarıyla yüklendi (Admin)',
            backup_id: result.insertId,
            timestamp: new Date()
        });

    } catch (error) {
        console.error('Admin backup upload error:', error);
        res.status(500).json({ success: false, message: 'Yedekleme hatası' });
    }
});

router.post('/admin/restore', requireAuth, handleRestore);

// ============================================
// DELTA SYNC API - Transaction Based Sync
// ============================================

const { v4: uuidv4 } = require('uuid');

// 4. Push Transactions (Cihaz -> Cloud)
// Cihaz kendi transaction'larını gönderir
router.post('/transactions/push', requireLicense, async (req, res) => {
    const { dealer_id, device_identifier, transactions } = req.body;
    const db = req.db;

    if (!device_identifier || !Array.isArray(transactions)) {
        return res.status(400).json({ success: false, message: 'Missing device_identifier or transactions array' });
    }

    try {
        let inserted = 0;
        let skipped = 0;

        for (const txn of transactions) {
            // Check if transaction already exists (idempotency)
            const [existing] = await db.execute(
                'SELECT id FROM sync_transactions WHERE id = ?',
                [txn.id]
            );

            if (existing.length > 0) {
                skipped++;
                continue;
            }

            // Insert transaction
            await db.execute(
                `INSERT INTO sync_transactions
                (id, dealer_id, device_identifier, action_type, item_sku, item_name, quantity_change, old_value, new_value, metadata, transaction_time)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    txn.id || uuidv4(),
                    dealer_id,
                    device_identifier,
                    txn.action_type,
                    txn.item_sku || null,
                    txn.item_name || null,
                    txn.quantity_change || 0,
                    txn.old_value || null,
                    txn.new_value || null,
                    txn.metadata ? JSON.stringify(txn.metadata) : null,
                    txn.transaction_time || new Date()
                ]
            );
            inserted++;
        }

        // Update device sync state
        await db.execute(
            `INSERT INTO sync_state (dealer_id, device_identifier, last_sent_at)
             VALUES (?, ?, NOW())
             ON DUPLICATE KEY UPDATE last_sent_at = NOW()`,
            [dealer_id, device_identifier]
        );

        // Update device status
        await db.execute(
            `INSERT INTO sync_devices (dealer_id, license_id, device_identifier, last_sync_at, last_ip, status)
             VALUES (?, ?, ?, NOW(), ?, 'online')
             ON DUPLICATE KEY UPDATE last_sync_at = NOW(), last_ip = ?, status = 'online'`,
            [dealer_id, req.license.id, device_identifier, getIp(req), getIp(req)]
        );

        await logActivity(db, dealer_id, 'SYNC_PUSH', `Device: ${device_identifier}, Inserted: ${inserted}, Skipped: ${skipped}`, getIp(req));

        res.json({
            success: true,
            inserted,
            skipped,
            timestamp: new Date()
        });

    } catch (error) {
        console.error('Push transactions error:', error);
        res.status(500).json({ success: false, message: 'Sync push failed' });
    }
});

// 5. Pull Transactions (Cloud -> Cihaz)
// Cihaz diğer cihazların transaction'larını alır
router.post('/transactions/pull', requireLicense, async (req, res) => {
    const { dealer_id, device_identifier, since } = req.body;
    const db = req.db;

    if (!device_identifier) {
        return res.status(400).json({ success: false, message: 'Missing device_identifier' });
    }

    try {
        // Get transactions from other devices since last pull
        let query = `
            SELECT id, device_identifier, action_type, item_sku, item_name,
                   quantity_change, old_value, new_value, metadata, transaction_time, synced_at
            FROM sync_transactions
            WHERE dealer_id = ?
            AND device_identifier != ?
        `;
        const params = [dealer_id, device_identifier];

        if (since) {
            query += ' AND synced_at > ?';
            params.push(since);
        }

        query += ' ORDER BY transaction_time ASC LIMIT 1000';

        const [transactions] = await db.execute(query, params);

        // Parse metadata JSON
        const formatted = transactions.map(txn => ({
            ...txn,
            metadata: txn.metadata ? JSON.parse(txn.metadata) : null
        }));

        // Update sync state
        if (transactions.length > 0) {
            await db.execute(
                `INSERT INTO sync_state (dealer_id, device_identifier, last_received_at)
                 VALUES (?, ?, NOW())
                 ON DUPLICATE KEY UPDATE last_received_at = NOW()`,
                [dealer_id, device_identifier]
            );
        }

        res.json({
            success: true,
            transactions: formatted,
            count: formatted.length,
            timestamp: new Date()
        });

    } catch (error) {
        console.error('Pull transactions error:', error);
        res.status(500).json({ success: false, message: 'Sync pull failed' });
    }
});

// 6. Device Heartbeat (Cihaz durumu güncelleme)
router.post('/devices/heartbeat', requireLicense, async (req, res) => {
    const { dealer_id, device_identifier, device_name, pending_count } = req.body;
    const db = req.db;

    if (!device_identifier) {
        return res.status(400).json({ success: false, message: 'Missing device_identifier' });
    }

    try {
        await db.execute(
            `INSERT INTO sync_devices (dealer_id, license_id, device_identifier, device_name, last_sync_at, last_ip, pending_transactions, status)
             VALUES (?, ?, ?, ?, NOW(), ?, ?, 'online')
             ON DUPLICATE KEY UPDATE
                device_name = COALESCE(?, device_name),
                last_sync_at = NOW(),
                last_ip = ?,
                pending_transactions = ?,
                status = 'online'`,
            [dealer_id, req.license.id, device_identifier, device_name, getIp(req), pending_count || 0, device_name, getIp(req), pending_count || 0]
        );

        res.json({ success: true, timestamp: new Date() });

    } catch (error) {
        console.error('Heartbeat error:', error);
        res.status(500).json({ success: false, message: 'Heartbeat failed' });
    }
});

// 7. Get Devices List (Admin Panel)
router.get('/devices', requireAuth, async (req, res) => {
    const { dealer_id } = req.query;
    const db = req.db;

    try {
        let query = `
            SELECT d.*, l.license_key, dl.name as dealer_name,
                   TIMESTAMPDIFF(MINUTE, d.last_sync_at, NOW()) as minutes_since_sync
            FROM sync_devices d
            LEFT JOIN licenses l ON d.license_id = l.id
            LEFT JOIN dealers dl ON d.dealer_id = dl.id
        `;
        const params = [];

        if (dealer_id) {
            query += ' WHERE d.dealer_id = ?';
            params.push(dealer_id);
        }

        query += ' ORDER BY d.last_sync_at DESC';

        const [devices] = await db.execute(query, params);

        // Calculate status based on last sync
        const formatted = devices.map(device => {
            let status = 'offline';
            if (device.minutes_since_sync !== null) {
                if (device.minutes_since_sync < 10) status = 'online';
                else if (device.minutes_since_sync < 60) status = 'idle';
                else status = 'offline';
            }

            return {
                id: device.id,
                dealerId: device.dealer_id,
                dealerName: device.dealer_name,
                licenseKey: device.license_key,
                deviceIdentifier: device.device_identifier,
                deviceName: device.device_name,
                lastSyncAt: device.last_sync_at,
                lastIp: device.last_ip,
                pendingTransactions: device.pending_transactions,
                status,
                minutesSinceSync: device.minutes_since_sync
            };
        });

        res.json(formatted);

    } catch (error) {
        console.error('Get devices error:', error);
        res.status(500).json({ message: 'Failed to get devices' });
    }
});

// 8. Get Transactions Log (Admin Panel)
router.get('/transactions', requireAuth, async (req, res) => {
    const { dealer_id, device_identifier, action_type, limit = 100, offset = 0 } = req.query;
    const db = req.db;

    try {
        let query = `
            SELECT t.*, dl.name as dealer_name
            FROM sync_transactions t
            LEFT JOIN dealers dl ON t.dealer_id = dl.id
            WHERE 1=1
        `;
        const params = [];

        if (dealer_id) {
            query += ' AND t.dealer_id = ?';
            params.push(dealer_id);
        }

        if (device_identifier) {
            query += ' AND t.device_identifier = ?';
            params.push(device_identifier);
        }

        if (action_type) {
            query += ' AND t.action_type = ?';
            params.push(action_type);
        }

        query += ' ORDER BY t.transaction_time DESC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), parseInt(offset));

        const [transactions] = await db.execute(query, params);

        // Get total count
        let countQuery = 'SELECT COUNT(*) as total FROM sync_transactions WHERE 1=1';
        const countParams = [];

        if (dealer_id) {
            countQuery += ' AND dealer_id = ?';
            countParams.push(dealer_id);
        }

        const [[{ total }]] = await db.execute(countQuery, countParams);

        const formatted = transactions.map(txn => ({
            id: txn.id,
            dealerId: txn.dealer_id,
            dealerName: txn.dealer_name,
            deviceIdentifier: txn.device_identifier,
            actionType: txn.action_type,
            itemSku: txn.item_sku,
            itemName: txn.item_name,
            quantityChange: txn.quantity_change,
            oldValue: txn.old_value,
            newValue: txn.new_value,
            metadata: txn.metadata ? JSON.parse(txn.metadata) : null,
            transactionTime: txn.transaction_time,
            syncedAt: txn.synced_at
        }));

        res.json({
            transactions: formatted,
            total,
            limit: parseInt(limit),
            offset: parseInt(offset)
        });

    } catch (error) {
        console.error('Get transactions error:', error);
        res.status(500).json({ message: 'Failed to get transactions' });
    }
});

// 9. Get Sync Stats (Admin Dashboard)
router.get('/stats', requireAuth, async (req, res) => {
    const { dealer_id } = req.query;
    const db = req.db;

    try {
        let dealerFilter = '';
        const params = [];

        if (dealer_id) {
            dealerFilter = ' WHERE dealer_id = ?';
            params.push(dealer_id);
        }

        // Total devices
        const [[{ totalDevices }]] = await db.execute(
            `SELECT COUNT(*) as totalDevices FROM sync_devices${dealerFilter}`,
            params
        );

        // Online devices (synced in last 10 minutes)
        const [[{ onlineDevices }]] = await db.execute(
            `SELECT COUNT(*) as onlineDevices FROM sync_devices
             WHERE last_sync_at > DATE_SUB(NOW(), INTERVAL 10 MINUTE)${dealer_id ? ' AND dealer_id = ?' : ''}`,
            dealer_id ? [dealer_id] : []
        );

        // Today's transactions
        const [[{ todayTransactions }]] = await db.execute(
            `SELECT COUNT(*) as todayTransactions FROM sync_transactions
             WHERE DATE(transaction_time) = CURDATE()${dealer_id ? ' AND dealer_id = ?' : ''}`,
            dealer_id ? [dealer_id] : []
        );

        // Today's sales
        const [[{ todaySales }]] = await db.execute(
            `SELECT COALESCE(SUM(ABS(quantity_change)), 0) as todaySales FROM sync_transactions
             WHERE DATE(transaction_time) = CURDATE() AND action_type = 'SALE'${dealer_id ? ' AND dealer_id = ?' : ''}`,
            dealer_id ? [dealer_id] : []
        );

        res.json({
            totalDevices,
            onlineDevices,
            offlineDevices: totalDevices - onlineDevices,
            todayTransactions,
            todaySales
        });

    } catch (error) {
        console.error('Get sync stats error:', error);
        res.status(500).json({ message: 'Failed to get stats' });
    }
});

module.exports = router;
