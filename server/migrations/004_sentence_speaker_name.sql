-- 新增展示人物名，保留原练习角色、句子 ID 和学习进度。
ALTER TABLE el_sentences ADD COLUMN speaker_name VARCHAR(80) NOT NULL DEFAULT '' COMMENT '人物名；空值沿用你/AI';
