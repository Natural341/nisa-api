-- =============================================
-- NEXUS Multi-Device Sync Migration Script
-- Run this on production MySQL database
-- =============================================

-- 1. Sync Devices Table (Track connected devices)
CREATE TABLE IF NOT EXISTS sync_devices (
    id INT AUTO_INCREMENT PRIMARY KEY,
    dealer_id VARCHAR(36) NOT NULL,
    license_id INT,
    device_name VARCHAR(100),
    device_identifier VARCHAR(100),
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

-- 2. Sync Transactions Table (Delta sync transaction log)
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
    metadata JSON,
    transaction_time DATETIME NOT NULL,
    synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (dealer_id) REFERENCES dealers(id) ON DELETE CASCADE,
    INDEX idx_dealer_time (dealer_id, transaction_time),
    INDEX idx_dealer_device (dealer_id, device_identifier),
    INDEX idx_synced (dealer_id, synced_at)
);

-- 3. Sync State Table (Track last sync position per device)
CREATE TABLE IF NOT EXISTS sync_state (
    id INT AUTO_INCREMENT PRIMARY KEY,
    dealer_id VARCHAR(36) NOT NULL,
    device_identifier VARCHAR(100) NOT NULL,
    last_received_at DATETIME,
    last_sent_at DATETIME,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY unique_state (dealer_id, device_identifier),
    FOREIGN KEY (dealer_id) REFERENCES dealers(id) ON DELETE CASCADE
);

-- 4. Inventory Items Table (For admin panel view)
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

-- =============================================
-- Verification Queries (Run after migration)
-- =============================================

-- Check if tables were created
SELECT 'sync_devices' as table_name, COUNT(*) as row_count FROM sync_devices
UNION ALL
SELECT 'sync_transactions', COUNT(*) FROM sync_transactions
UNION ALL
SELECT 'sync_state', COUNT(*) FROM sync_state
UNION ALL
SELECT 'inventory_items', COUNT(*) FROM inventory_items;

-- Show table structure
-- DESCRIBE sync_devices;
-- DESCRIBE sync_transactions;
-- DESCRIBE sync_state;
-- DESCRIBE inventory_items;
