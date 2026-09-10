# 拾句英语 · ytc-tool

原生微信小程序 TypeScript + NestJS 11 + mysql2 + MySQL。按合集和单集看中文、回想英文、查看参考表达，微信登录后保存学习记录。前后端同仓库，使用 npm workspaces。

## 当前交付状态

- 已实现：学习首页、合集目录、单集复习、个人中心、资料编辑、待复习六个页面及对应后端接口。
- 已整理：文档的 200 个主题、1,589 条双语表达，保留简短场景提示，不展示学习图片。用户头像仍支持。
- 已配置真实 AppID；AppSecret 需在后端本地配置。
- **按用户要求，尚未执行数据库建表或内容导入，也未部署或发布。** 因此学习内容接口当前返回 503“学习内容尚未初始化”；这不是空合集。
- 原文仅做明显笔误与格式清理，英文是参考表达，不是唯一标准答案；没有进行全部条目的语义重译。

## 目录

```text
miniprogram/             # 小程序源码，微信工具编译 TypeScript
server/src/auth/        # 微信登录、会话和鉴权
server/src/catalog/     # 合集、单集、双语内容
server/src/users/       # 个人资料和头像
server/src/progress/    # 学习记录、统计和待复习
server/content/         # 稳定 sourceKey 的学习内容与清理记录
server/migrations/      # 待确认执行的 SQL
server/scripts/         # 内容校验、迁移预览、导入工具
server/test/            # 自动化测试，不操作真实数据库
```

## 本地启动

需要 Node.js 22+、npm、MySQL 8+ 和微信开发者工具。

```sh
npm ci
# 仅首次配置、且 .env 尚不存在时复制，不要覆盖已有配置：
cp server/.env.example server/.env
npm run dev
```

当前项目已有本地 `.env`，直接使用即可，不需要重复复制。后端默认监听 3000，`npm run dev` 自动重启。

后端变量：`PORT`、`DB_HOST`、`DB_PORT`、`DB_NAME`、`DB_USER`、`DB_PASSWORD`、`WECHAT_APP_ID`、`WECHAT_APP_SECRET`，以及可选的绝对路径 `UPLOAD_DIR`。真实配置只放后端 `.env` 或部署环境，禁止写入小程序。

AppSecret 为空时，内容浏览不依赖微信登录，但登录接口返回明确的 503 配置提示，不提供模拟登录或生产绕过入口。会话为 30 天有效的随机令牌，数据库只存 SHA-256 摘要，退出撤销会话。

## 小程序调试

微信开发者工具导入仓库根目录，识别 `project.config.json` 和 `miniprogramRoot`。AppID 已设置为用户提供的值。账号还需具备对应小程序开发权限。

`miniprogram/config.ts` 默认请求 `http://127.0.0.1:3000/api`。本机 HTTP 调试需要开发者工具允许本地调试域名设置；代码没有自动更改工具安全设置。真机使用手机可访问的 HTTPS 后端域名，并在微信平台配置合法域名；手机上的 localhost 指向手机自身。

## 数据库准备（未执行）

所有新表使用 `el_` 前缀，共 7 张：用户、会话、合集、单集、条目、单集进度和条目进度。统一使用数字自增 `id`、`created_at`、`updated_at`、`is_del`。合集/单集用 `status` 管理草稿和发布，条目掌握状态在数据库中为 0/1/2。

完整约定见 [AGENTS.md](AGENTS.md)，字段说明见 [docs/database-design.md](docs/database-design.md)。本次修改的是尚未执行的 v2 初始化脚本；它不是旧字符串主键表的升级脚本。如果已有旧表，不得直接套用或删除重建，需要另行审查数据迁移方案。执行前应审阅 `server/migrations/001_learning.sql` 并取得确认。

以下命令只校验或查询，不写数据库：

```sh
npm run content:validate --workspace server
npm run db:plan --workspace server
# 建表完成后，才能对比数据库中的现有内容：
npm run content:plan --workspace server
```

以下命令会写数据库，**目前未获执行授权**：

```sh
npm run db:migrate --workspace server
npm run content:import --workspace server
```

命令只允许目标库为 `ytc-tool`，拒绝其他库（包括生产库）。迁移遇到任意同名表会停止，避免掩盖已有 schema 差异。MySQL 建表不是跨语句事务；若中途失败，应人工检查，不要直接反复执行。

导入以 JSON 的 `sourceKey` 匹配数据库 `source_key`，查询数据库分配的数字 ID 再关联子表。按单集使用事务和参数化批量更新，并串行化同一合集的并发导入；不使用 `insertId` 转换后的 JS 数字。重复导入保持数字 ID 和学习记录不变。

Dry-run 会列出新增、字段修改、发布状态变化、缺失及已删除冲突。已有标题、排序、译文、链接或发布状态变化均需审阅后再显式使用 `--accept-changes`；该选项不能绕过软删除或缺失冲突。唯一标识不包含 is_del，已删除记录不能通过导入重建或恢复。清理记录保存在 `cleaning-log.json`，不返回给小程序。

表和未声明状态的内容默认草稿。当前 `daily-200.json` 明确声明合集和 200 集 `status: 1`，因此经确认实际导入时会发布这些内容；如果需要先入草稿，应在内容清单中改为 0，再查看 dry-run。尚未执行导入。

内容 `sourceKey` 一经分配不可根据新顺序重算；它不是 API ID。合集 source_key 全局唯一，单集/条目 source_key 在各自父级内唯一。新增合集使用新的 sourceKey，不去重其他单集中的重复短语。

API 中的 `id`、外键和学习位置均为正整数字符串，例如 `"9007199254740993"`，禁止通过 Number/parseInt 转换。旧 `daily-200-e001` 形式的 URL 参数不再有效；需要先从目录接口取得数字 ID。前端仍使用 unseen/learning/mastered 枚举，后端统一映射到数据库 0/1/2。

## 学习规则

每次进入单集参考英文默认隐藏；查看答案不会改变掌握状态。条目状态为未练习、还不熟、已掌握。单集筛选“未掌握”包括前两者，个人待复习列表仅显示还不熟。单集完成由用户主动标记，可撤销，与掌握数量分开。

未登录可浏览，登录后才保存进度。保存串行执行，失败展示未同步并提供重试，后续操作不掩盖前一项失败。跨设备以服务器最后成功接收的状态为准；当前不提供离线同步。

## 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | /api/health | 进程检查 |
| GET | /api/health/database | 只读数据库检查 |
| POST | /api/auth/wechat | code 换登录会话 |
| POST | /api/auth/logout | 撤销当前会话 |
| GET / PUT | /api/me | 获取资料 / 修改昵称（微信请求使用 PUT） |
| POST | /api/me/avatar | multipart 字段 file，最大 2MB |
| GET | /api/avatars/:key | 返回已保存的头像 |
| GET | /api/collections | 合集分页列表 |
| GET | /api/collections/:id/episodes | 单集分页列表 |
| GET | /api/episodes/:id | 单集信息 |
| GET | /api/episodes/:id/sentences | 双语条目，最多 200 条 |
| GET | /api/me/collections/:id/progress | 当前用户的合集学习状态 |
| GET / PUT | /api/me/episodes/:id/progress | 查询 / 保存位置和完成标记 |
| PUT | /api/me/sentences/:id/progress | 自评状态 |
| GET | /api/me/summary | 统计与最近学习 |
| GET | /api/me/review | 待复习分页列表 |

分页参数 `page` 从 1 开始、`limit` 为 1–100。鉴权接口使用 `Authorization: Bearer <token>`，用户身份从会话取得，不接受前端指定其他用户。错误为 `{statusCode,message}`，不输出数据库密码、Secret、微信 code 或内部 SQL。

## 验证

```sh
npm run typecheck
npm test
npm run build
npm run start --workspace server
```

自动化测试使用隔离替身，不连接真实数据库；覆盖公共字段、BIGINT 精度、软删除和完整父级可见性、数值状态映射、导入 dry-run/幂等/拒绝恢复/回滚，以及内容结构和页面行为。它不能替代 MySQL schema 执行、微信真实登录和真机交互验收。

本机可使用已安装微信开发者工具的 wcc / wcsc 对 WXML / WXSS 做原生编译检查。编译通过不等于已完成真机视觉验收。

## 发布前仍需完成

1. 用户确认后在测试库建表、导入，并验证真实 SQL、重复导入及进度恢复。
2. 在本地 `.env` 填入真实 AppSecret，使用有开发权限的微信账号验证登录、头像选择和昵称填写。
3. 头像目录挂载持久存储，配置 HTTPS、合法域名，并完成微信隐私声明及平台要求的头像昵称内容检查。当前实现只有输入/类型校验，未接入服务端内容审核能力，不能视为发布验收完成。
4. 根据实际部署配置专用数据库账号、备份及会话清理任务；当前会话过期会被鉴权拒绝，过期行不会自动物理清理。
5. 生产迁移、后端部署和小程序发布另行确认。

Multer 使用根 overrides 锁定安全修复版本 2.3.0，升级 NestJS 后重新评估覆盖。未添加新的应用框架、UI 库、ORM 或测试库。
