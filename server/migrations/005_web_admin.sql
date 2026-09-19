-- Incremental migration. Run scripts/migrate-admin.mjs (preview by default).
ALTER TABLE el_users ADD COLUMN admin_username VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NULL;
ALTER TABLE el_users ADD COLUMN admin_password_hash VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NULL;
ALTER TABLE el_users ADD COLUMN is_admin TINYINT UNSIGNED NOT NULL DEFAULT 0;
ALTER TABLE el_users ADD COLUMN admin_must_change_password TINYINT UNSIGNED NOT NULL DEFAULT 0;
ALTER TABLE el_users ADD UNIQUE KEY uq_admin_username (admin_username);
ALTER TABLE el_sessions ADD COLUMN session_type VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'miniapp';
CREATE TABLE el_admin_audit_logs (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
 is_del TINYINT UNSIGNED NOT NULL DEFAULT 0,
 actor_id BIGINT UNSIGNED NOT NULL,
 action VARCHAR(40) NOT NULL,
 target_type VARCHAR(40) NOT NULL,
 target_id BIGINT UNSIGNED NOT NULL,
 details JSON NOT NULL,
 KEY ix_admin_audit_time (created_at,id),
 KEY ix_admin_audit_actor (actor_id,created_at,id),
 CONSTRAINT fk_admin_audit_actor FOREIGN KEY (actor_id) REFERENCES el_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
