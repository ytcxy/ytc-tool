# 数据库设计 v2（含对话角色）

本设计对应 `server/migrations/001_learning.sql`，新库使用该初始化 SQL；已有数字主键库新增角色字段使用 `002_sentence_speaker.sql`，本轮未执行数据库变更。旧字符串主键表若已存在，必须单独设计并确认升级路径，不能用本初始化脚本直接替换。

## 公共字段与约束

七张表统一使用 `id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY`、`created_at DATETIME(3)`、`updated_at DATETIME(3)`、`is_del TINYINT UNSIGNED DEFAULT 0`。

created_at 默认 CURRENT_TIMESTAMP(3)；updated_at 默认及自动更新均为 CURRENT_TIMESTAMP(3)。数据库连接会话设置北京时间（UTC+08:00），使默认值和应用写入的业务时间一致。切换前写入的旧记录不作转换。is_del 为 0 未删除、1 已删除，不使用 deleted_at。所有外键均为 BIGINT UNSIGNED，无级联物理删除。

数字 ID 在 TypeScript、JSON 和 URL 中以十进制字符串处理。内容清单的 sourceKey 对应数据库 source_key，永久保留供幂等导入；不会把它直接作为数据库主键或公开资源 ID。

## el_users 用户

| 字段 | 类型 | 说明 |
|---|---|---|
| appid | VARCHAR(64) | 小程序身份 |
| openid | VARCHAR(128) | 微信用户身份 |
| nickname | VARCHAR(32) | 默认英语学习者 |
| avatar_key | VARCHAR(128) NULL | 头像文件标识 |
| last_login_at | DATETIME(3) NULL | 最近成功登录时间 |

唯一键 (appid, openid)，标识大小写敏感。软删除用户不能自动再次注册或获得会话。

## el_sessions 登录会话

| 字段 | 类型 | 说明 |
|---|---|---|
| user_id | BIGINT UNSIGNED | 用户外键 |
| token_hash | CHAR(64) | SHA-256 摘要，唯一，不保存原令牌 |
| expires_at | DATETIME(3) | 过期时间 |
| revoked_at | DATETIME(3) NULL | 主动撤销时间 |

索引 user_id、expires_at。会话有效须用户和会话均 is_del=0、未过期、未撤销。令牌摘要不再充当主键。

## el_collections 合集

| 字段 | 类型 | 说明 |
|---|---|---|
| source_key | VARCHAR(80) | 全局唯一导入标识 |
| title | VARCHAR(160) | 标题 |
| description | TEXT | 简介 |
| source_url | VARCHAR(512) NULL | 原合集链接 |
| sort_order | INT UNSIGNED | 默认 1 |
| status | TINYINT UNSIGNED | 0 草稿、1 已发布，默认 0 |

唯一键 source_key；列表索引 (is_del,status,sort_order,id)。第一版无学习封面图片。

## el_episodes 单集

| 字段 | 类型 | 说明 |
|---|---|---|
| collection_id | BIGINT UNSIGNED | 合集外键 |
| source_key | VARCHAR(80) | 合集内稳定导入标识 |
| title | VARCHAR(160) | 标题 |
| sequence | INT UNSIGNED | 合集内顺序 |
| source_url | VARCHAR(512) NULL | 视频链接，可含分 P 参数 |
| status | TINYINT UNSIGNED | 0 草稿、1 已发布，默认 0 |

唯一键 (collection_id,source_key)；目录索引 (collection_id,is_del,status,sequence,id)。

## el_sentences 双语条目

| 字段 | 类型 | 说明 |
|---|---|---|
| episode_id | BIGINT UNSIGNED | 单集外键 |
| source_key | VARCHAR(80) | 单集内稳定导入标识 |
| sequence | INT UNSIGNED | 单集内顺序 |
| zh | TEXT | 中文 |
| en | TEXT | 参考英文 |
| speaker | TINYINT UNSIGNED NOT NULL DEFAULT 0 | 0 你，1 AI |
| context | VARCHAR(500) | 场景提示，默认空字符串 |

唯一键 (episode_id,source_key)；列表索引 (episode_id,is_del,sequence,id)。随单集发布，不存图片、原文标签和段落编号。API 返回数值 speaker；原文及生成台词都可独立自评。新增 AI 条目没有历史进度，视为未练习；已有条目 ID、学习位置和单集完成标记不重置。来源段落与补写记录保存在内容 source 目录中。

## el_episode_progress 单集进度

| 字段 | 类型 | 说明 |
|---|---|---|
| user_id | BIGINT UNSIGNED | 用户外键 |
| episode_id | BIGINT UNSIGNED | 单集外键 |
| last_sentence_id | BIGINT UNSIGNED NULL | 条目外键，由应用验证属于本集 |
| completed_at | DATETIME(3) NULL | 完成时间，NULL 为未完成 |
| last_studied_at | DATETIME(3) | 最近学习时间，默认当前时间 |

唯一键 (user_id,episode_id)，不把 is_del 加入唯一键。索引 (user_id,is_del,last_studied_at,id)。最近学习依据真实业务时间，不依据维护时也会改变的 updated_at。

## el_sentence_progress 条目进度

| 字段 | 类型 | 说明 |
|---|---|---|
| user_id | BIGINT UNSIGNED | 用户外键 |
| sentence_id | BIGINT UNSIGNED | 条目外键 |
| status | TINYINT UNSIGNED | 0 未练习、1 还不熟、2 已掌握，默认 0 |
| last_reviewed_at | DATETIME(3) NULL | 最近自评时间 |

唯一键 (user_id,sentence_id)，不含 is_del。索引 (user_id,is_del,status,last_reviewed_at,id)。不存在记录也视为未练习；API 使用 unseen/learning/mastered，后端映射数值。查看参考答案不修改此表。

## 查询与写入规则

- 公开内容及学习统计检查完整链：条目 is_del=0，单集和合集同时 is_del=0、status=1。
- 个人查询额外排除已删除进度；学习位置指向已删除条目时返回 NULL，避免滚动到不存在内容。
- 保存资料过滤用户软删除。保存进度时锁定并检查既有记录，已删除记录返回冲突，不自动恢复。
- 删除内容不物理清空历史；恢复另行审查，不复用新 ID。
- 所有导入唯一键均不含 is_del。已删除的相同 sourceKey 保留身份；--accept-changes 不能绕过软删除冲突。
- 导入先 dry-run 比较数据与发布状态，再以数字 ID 关联子表；不使用 REPLACE INTO、删除重建或可能失真的 insertId。
- 当前内容清单显式设置 status=1；数据库和未声明发布状态的清单默认草稿。

## 验证边界

隔离测试覆盖字段规范、ID 精度、枚举映射、关联过滤和导入行为。尚未执行真实 MySQL DDL 或 DML 验证，不能将替身测试视为已完成数据库迁移。获得授权后应在测试库验证约束、实际导入和重复导入。

## 人物名显示

`el_sentences.speaker_name VARCHAR(80) NOT NULL DEFAULT ''` 保存人物名，API/清单对应 `speakerName`。空字符串兼容旧合集的你/AI；多人台词可保存“奥利、丹尼”。已有库运行 004_sentence_speaker_name.sql 对应的迁移脚本，不重建表、不重置 ID 或进度。新后端部署前必须完成此迁移。
