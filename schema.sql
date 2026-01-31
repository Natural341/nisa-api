-- Nexus Inventory Management System - MySQL Schema for Remote API

-- 1. Admin Users Table (Senin için - Paneli yönetmek için)
CREATE TABLE IF NOT EXISTS admin_users (
    id VARCHAR(36) PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    display_name VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. Dealers Table (Yazılımı verdiğin dükkan sahipleri / müşteriler)
CREATE TABLE IF NOT EXISTS dealers (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(100) UNIQUE,
    phone VARCHAR(20),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. Licenses Table (Lisans anahtarları ve donanım kilidi)
CREATE TABLE IF NOT EXISTS licenses (
    id INT AUTO_INCREMENT PRIMARY KEY,
    license_key VARCHAR(50) UNIQUE NOT NULL,
    dealer_id VARCHAR(36),
    mac_address VARCHAR(50), -- Donanım kilidi (Hardware Lock)
    device_name VARCHAR(100),
    activated_at DATETIME,
    expires_at DATETIME, -- NULL ise süresiz
    price DECIMAL(10, 2) DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (dealer_id) REFERENCES dealers(id) ON DELETE SET NULL
);

-- 4. Cloud Backups Table (Senkronizasyon verileri)
CREATE TABLE IF NOT EXISTS cloud_backups (
    id INT AUTO_INCREMENT PRIMARY KEY,
    dealer_id VARCHAR(36) NOT NULL,
    backup_data LONGTEXT NOT NULL, -- JSON formatında tüm veritabanı yedeği
    size_bytes BIGINT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_dealer_date (dealer_id, created_at),
    FOREIGN KEY (dealer_id) REFERENCES dealers(id) ON DELETE CASCADE
);

-- 5. Activity Log (Sistem olayları)
CREATE TABLE IF NOT EXISTS remote_activity_log (
    id INT AUTO_INCREMENT PRIMARY KEY,
    dealer_id VARCHAR(36),
    action_type VARCHAR(50) NOT NULL, -- 'LOGIN', 'SYNC', 'LICENSE_CHECK'
    description TEXT,
    ip_address VARCHAR(45),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (dealer_id) REFERENCES dealers(id) ON DELETE SET NULL
);

-- İlk admin kullanıcısını oluşturmak için (Şifre: admin123 - Lütfen sonra değiştir)
-- INSERT INTO admin_users (id, username, password_hash, display_name) 
-- VALUES (UUID(), 'admin', '$2a$10$7R.v6/8l.XpWqA0H4tUuueP1V6yS8X.o6.mH8W.v6/8l.XpWqA0H', 'Sistem Sahibi');

-- 6. Sync Devices (Cihaz takibi - hangi cihaz ne zaman sync yaptı)
CREATE TABLE IF NOT EXISTS sync_devices (
    id INT AUTO_INCREMENT PRIMARY KEY,
    dealer_id VARCHAR(36) NOT NULL,
    license_id INT,
    device_name VARCHAR(100),
    device_identifier VARCHAR(100), -- MAC address veya unique ID
    last_sync_at DATETIME,
    last_ip VARCHAR(45),
    pending_transactions INT DEFAULT 0,
    status ENUM('online', 'offline', 'syncing') DEFAULT 'offline',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY unique_device (dealer_id, device_identifier),
    FOREIGN KEY (dealer_id) REFERENCES dealers(id) ON DELETE CASCADE,
    FOREIGN KEY (license_id) REFERENCES licenses(id) ON DELETE SET NULL,
    INDEX idx_dealer_status (dealer_id, status)
);

-- 7. Sync Transactions (Delta sync - sadece değişiklikler)
CREATE TABLE IF NOT EXISTS sync_transactions (
    id VARCHAR(36) PRIMARY KEY,
    dealer_id VARCHAR(36) NOT NULL,
    device_identifier VARCHAR(100) NOT NULL,
    action_type ENUM('SALE', 'STOCK_IN', 'STOCK_OUT', 'PRICE_CHANGE', 'ITEM_CREATE', 'ITEM_UPDATE', 'ITEM_DELETE') NOT NULL,
    item_sku VARCHAR(50),
    item_name VARCHAR(255),
    quantity_change INT DEFAULT 0,
    old_value DECIMAL(10, 2),
    new_value DECIMAL(10, 2),
    metadata JSON, -- Ekstra bilgi (satış detayı vs.)
    transaction_time DATETIME NOT NULL, -- İşlemin cihazda yapıldığı zaman
    synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, -- Cloud'a geldiği zaman
    FOREIGN KEY (dealer_id) REFERENCES dealers(id) ON DELETE CASCADE,
    INDEX idx_dealer_time (dealer_id, transaction_time),
    INDEX idx_dealer_device (dealer_id, device_identifier),
    INDEX idx_synced (dealer_id, synced_at)
);

-- 8. Sync State (Her cihazın son aldığı transaction ID)
CREATE TABLE IF NOT EXISTS sync_state (
    id INT AUTO_INCREMENT PRIMARY KEY,
    dealer_id VARCHAR(36) NOT NULL,
    device_identifier VARCHAR(100) NOT NULL,
    last_received_at DATETIME, -- Bu cihazın en son aldığı transaction zamanı
    last_sent_at DATETIME, -- Bu cihazın en son gönderdiği transaction zamanı
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY unique_state (dealer_id, device_identifier),
    FOREIGN KEY (dealer_id) REFERENCES dealers(id) ON DELETE CASCADE
);

-- 9. Inventory Items (Admin Panel Ürün Listesi)
CREATE TABLE IF NOT EXISTS inventory_items (
    id VARCHAR(36) PRIMARY KEY,
    sku VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    category VARCHAR(100),
    quantity INT DEFAULT 0,
    price DECIMAL(10, 2) DEFAULT 0,
    cost_price DECIMAL(10, 2) DEFAULT 0,
    location VARCHAR(100),
    image_url MEDIUMTEXT,
    description TEXT,
    tags JSON,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
