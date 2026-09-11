-- 已有数字主键版本升级；已有条目默认归为‘你’，不更改 ID、文本和学习进度。
ALTER TABLE el_sentences ADD COLUMN speaker TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '角色：0-你，1-AI';
