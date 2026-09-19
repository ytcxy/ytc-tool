-- Initial schema v2 (not executed). Do not run over v1 tables.
-- All foreign keys restrict physical deletion. Soft deletion never cascades.

CREATE TABLE el_users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '修改时间',
  is_del TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '是否删除：0-未删除，1-已删除',
  appid VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '小程序 AppID',
  openid VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '微信身份标识',
  nickname VARCHAR(32) NOT NULL DEFAULT '英语学习者' COMMENT '昵称',
  avatar_key VARCHAR(128) NULL COMMENT '头像文件标识',
  last_login_at DATETIME(3) NULL COMMENT '最近登录时间',
  PRIMARY KEY (id),
  UNIQUE KEY uq_wechat_identity (appid, openid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='微信用户';

CREATE TABLE el_sessions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '修改时间',
  is_del TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '是否删除：0-未删除，1-已删除',
  user_id BIGINT UNSIGNED NOT NULL COMMENT '用户 ID',
  token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '令牌 SHA-256 摘要',
  expires_at DATETIME(3) NOT NULL COMMENT '过期时间',
  revoked_at DATETIME(3) NULL COMMENT '主动撤销时间',
  PRIMARY KEY (id),
  UNIQUE KEY uq_token_hash (token_hash),
  KEY ix_session_user (user_id),
  KEY ix_session_expiry (expires_at),
  CONSTRAINT fk_session_user FOREIGN KEY (user_id) REFERENCES el_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='登录会话';

CREATE TABLE el_collections (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '修改时间',
  is_del TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '是否删除：0-未删除，1-已删除',
  source_key VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '稳定导入标识',
  title VARCHAR(160) NOT NULL COMMENT '合集标题',
  description TEXT NOT NULL COMMENT '合集简介',
  source_url VARCHAR(512) NULL COMMENT '原始合集链接',
  sort_order INT UNSIGNED NOT NULL DEFAULT 1 COMMENT '展示排序',
  status TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '发布状态：0-草稿，1-已发布',
  PRIMARY KEY (id),
  UNIQUE KEY uq_collection_source (source_key),
  KEY ix_collection_list (is_del, status, sort_order, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='学习合集';

CREATE TABLE el_episodes (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '修改时间',
  is_del TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '是否删除：0-未删除，1-已删除',
  collection_id BIGINT UNSIGNED NOT NULL COMMENT '所属合集 ID',
  source_key VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '合集内稳定导入标识',
  title VARCHAR(160) NOT NULL COMMENT '单集标题',
  sequence INT UNSIGNED NOT NULL COMMENT '合集内排序',
  source_url VARCHAR(512) NULL COMMENT '视频链接，可含分 P 参数',
  status TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '发布状态：0-草稿，1-已发布',
  PRIMARY KEY (id),
  UNIQUE KEY uq_episode_source (collection_id, source_key),
  KEY ix_episode_list (collection_id, is_del, status, sequence, id),
  CONSTRAINT fk_episode_collection FOREIGN KEY (collection_id) REFERENCES el_collections(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='学习单集';

CREATE TABLE el_sentences (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '修改时间',
  is_del TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '是否删除：0-未删除，1-已删除',
  episode_id BIGINT UNSIGNED NOT NULL COMMENT '所属单集 ID',
  source_key VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '单集内稳定导入标识',
  sequence INT UNSIGNED NOT NULL COMMENT '单集内排序',
  speaker TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '角色：0-你，1-AI',
  speaker_name VARCHAR(80) NOT NULL DEFAULT '' COMMENT '人物名；空值沿用你/AI',
  zh TEXT NOT NULL COMMENT '中文',
  en TEXT NOT NULL COMMENT '参考英文',
  context VARCHAR(500) NOT NULL DEFAULT '' COMMENT '场景与角色提示',
  PRIMARY KEY (id),
  UNIQUE KEY uq_sentence_source (episode_id, source_key),
  KEY ix_sentence_list (episode_id, is_del, sequence, id),
  CONSTRAINT fk_sentence_episode FOREIGN KEY (episode_id) REFERENCES el_episodes(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='双语复习条目';

CREATE TABLE el_episode_progress (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '修改时间',
  is_del TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '是否删除：0-未删除，1-已删除',
  user_id BIGINT UNSIGNED NOT NULL COMMENT '用户 ID',
  episode_id BIGINT UNSIGNED NOT NULL COMMENT '单集 ID',
  last_sentence_id BIGINT UNSIGNED NULL COMMENT '上次学习的条目 ID',
  completed_at DATETIME(3) NULL COMMENT '主动标记完成时间，NULL 表示未完成',
  last_studied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '最近学习时间',
  PRIMARY KEY (id),
  UNIQUE KEY uq_user_episode (user_id, episode_id),
  KEY ix_recent_learning (user_id, is_del, last_studied_at, id),
  CONSTRAINT fk_episode_progress_user FOREIGN KEY (user_id) REFERENCES el_users(id),
  CONSTRAINT fk_episode_progress_episode FOREIGN KEY (episode_id) REFERENCES el_episodes(id),
  CONSTRAINT fk_episode_progress_sentence FOREIGN KEY (last_sentence_id) REFERENCES el_sentences(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='单集学习进度';

CREATE TABLE el_sentence_progress (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '修改时间',
  is_del TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '是否删除：0-未删除，1-已删除',
  user_id BIGINT UNSIGNED NOT NULL COMMENT '用户 ID',
  sentence_id BIGINT UNSIGNED NOT NULL COMMENT '条目 ID',
  status TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '掌握状态：0-未练习，1-还不熟，2-已掌握',
  last_reviewed_at DATETIME(3) NULL COMMENT '最近自评时间',
  PRIMARY KEY (id),
  UNIQUE KEY uq_user_sentence (user_id, sentence_id),
  KEY ix_review (user_id, is_del, status, last_reviewed_at, id),
  CONSTRAINT fk_sentence_progress_user FOREIGN KEY (user_id) REFERENCES el_users(id),
  CONSTRAINT fk_sentence_progress_sentence FOREIGN KEY (sentence_id) REFERENCES el_sentences(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='条目掌握进度';

