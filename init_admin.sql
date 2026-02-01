INSERT INTO admin_users (id, username, password_hash, display_name)
VALUES (UUID(), 'admin', '$2a$10$CtbExE3NjHKWhnWz2N9foeleBbuj8ZhZTxmidXFlAdO2RXtMmz3ha', 'Admin')
ON DUPLICATE KEY UPDATE password_hash=VALUES(password_hash);
