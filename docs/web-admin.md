# 网页管理端

管理网页与小程序 API 由同一个 NestJS 进程提供，默认端口 3000。执行 `npm run dev`，访问 `http://localhost:3000/admin/`。开发时网页文件直接读取 `server/admin-web/`，编辑后刷新；生产构建复制到 `server/dist/admin-web/`，现有 Docker 构建会自动包含。小程序仍由微信开发者工具编译。

## 数据库升级与首个管理员

已有库依次运行 005 增量迁移，不重跑 001 初始化 SQL。005 只增加用户管理字段、会话类型和操作审计表，支持预览、结构检查与重复执行。新库也需要在原有初始化及其他增量迁移后运行 005。MySQL DDL 会隐式提交，部分失败后修复原因并重跑；不要删除新增列回退，以免丢失管理账号和审计记录。

```bash
npm run build
npm run db:admin:plan --workspace server -- --database=ytc-tool
# 核对预览后应用
npm run db:admin:migrate --workspace server -- --database=ytc-tool
npm run admin:init --workspace server -- --database=ytc-tool
# 文件必须位于已存在的仓库外目录，且不能已存在
npm run admin:init --workspace server -- --database=ytc-tool --apply --credentials-file=/path/outside-repo/test-initial.txt
```

生产库必须显式使用 `--database=ytc-tool-prod`，独立预览和应用；两库初始密码分别生成。连接沿用 `server/.env`，不修改数据库账号权限。不自动执行线上部署。

初始化选取 `ORDER BY id ASC LIMIT 1` 的用户，不假设 ID 为 1。首个用户不存在或已软删除时停止，不跳过、不恢复。管理账号默认 `admin`；随机生成 24 字节初始密码，以 0600 权限保存到指定本地文件，不在日志、SQL 文件或参数中打印密码。首次登录必须改密。重复初始化保留已有账号与密码；账号被其他用户占用时停止。

首个管理员遗失密码时，在服务主机本地运行同一脚本加 `--reset-password`：先不带 `--apply` 查看对象，再带 `--apply --credentials-file=...` 应用。它仅重置首个、现有且未停用的管理员，撤销其管理会话，不自动恢复账号。其他管理员可通过网页重置密码。

## 登录与权限

`el_users` 新增 `admin_username`（ASCII 二进制唯一、允许 NULL）、`admin_password_hash`、`is_admin`、`admin_must_change_password`。普通用户字段为空或 0；微信注册及学习记录不变。管理账号为 3–40 位小写字母、数字、下划线或短横线，以字母开头；密码 6–128 位，使用随机盐的 scrypt 哈希。

`el_sessions.session_type` 区分 `miniapp` 和 `admin`，旧会话默认 `miniapp`。网页管理会话有效期 8 小时，仅保存令牌摘要，通过 HttpOnly、SameSite=Strict Cookie 传输，生产环境额外 Secure，Path=/api/admin。生产须设置 `NODE_ENV=production` 并通过 HTTPS 访问，反向代理保留原请求 Host。浏览器不将令牌保存在 localStorage。

所有管理接口检查有效会话、用户未删除和当前管理员资格；首次改密前仅允许查询自身会话、改密、退出。写操作要求同源 Origin 和会话派生的 CSRF 凭证；登录限制每 IP 每分钟 10 次（单进程）。普通小程序接口只接受 miniapp 会话。

管理密码变更会撤销该用户所有管理会话；停用用户同时撤销小程序会话。所有管理员第一版拥有相同权限，包括为已有小程序用户开通或撤销管理权限。禁止停用自己或取消自己的权限；最后一个可用管理员不能被停用或降级。用户权限变更使用全局锁和事务防止并发绕过。

## 功能和数据规则

- 内容：合集 → 单集 → 双语条目，分页、搜索、状态筛选、新增、编辑、排序、发布/下架、软删除。
- 批量发布：合集、单集列表支持勾选与全选当前页草稿，确认具体标题后发布；翻页、筛选、刷新清空勾选。只发布所选记录，不递归发布草稿子项；单集需要所属合集也发布才对用户可见。每批 1–100 条，携带各记录 updatedAt，后端校验完整批次并在单个事务中发布及逐项审计，冲突或失败整批回滚。已发布记录不重复修改。
- 稳定 sourceKey 由服务端分配，不能编辑；数字 ID 全程字符串，不迁移子内容归属。
- 新合集、单集默认草稿；条目随单集发布。每集最多 200 条有效条目，单集/条目顺序不能与同级有效记录重复。调整顺序发生冲突时先使用未占用序号。
- 编辑提交读取时的 updatedAt（数据库北京时间、毫秒精度）；事务内检查版本，冲突返回 409。服务端保证每次内容更新版本递增。
- 删除只软删除目标，父级删除隐藏其全部下级，保留外键及历史学习记录。不提供自动恢复。
- 用户与管理员：查询、查看学习记录、停用用户、开通管理账号、取消管理权限、重置密码；不编辑微信身份。
- 学习进度：只读，按用户/合集/单集筛选，检查完整父子发布及软删除链。
- 音频：查看关联可用状态及试听。无映射或英文哈希不匹配显示“未关联或需重新生成”；草稿不能播放。试听还会检查实际文件及哈希，文件缺失时返回错误。生成、安装、映射更新继续走既有脚本。
- 操作审计：记录登录、内容和管理员操作，内容写入与审计同事务；不保存密码、密码哈希、会话令牌或微信身份信息。日志按操作者/对象筛选、分页查询。

## 与内容导入配合

管理写入与现有导入复用合集级 `learning-import:<sourceKey SHA-256 前40位>` 命名锁，锁定后重新检查关联、删除状态及版本。冲突返回 409。

按合集导出保留 sourceKey、发布状态和有效子内容；导出使用一致性读事务。空合集、含空单集的合集不能导出可导入清单。同步导出文件回仓库后，再执行现有导入预览并确认差异，避免旧清单覆盖网页编辑。导出不修改 AI 补写来源记录；软删除内容不会通过导入自动恢复。

## 管理接口

全部位于 `/api/admin`，不改变现有 `/api` 小程序路由。除登录外均需管理 Cookie。

| 方法与路径 | 功能 |
|---|---|
| POST /auth/login | `{username,password}` 登录，返回用户与 csrf，不返回令牌 |
| GET /auth/me | 当前身份与 csrf |
| POST /auth/password | `{oldPassword,password}` 改密并撤销管理会话 |
| POST /auth/logout | 退出 |
| GET /content/:kind | kind=collections/episodes/sentences；page/limit/q/status/deleted，子级需 parentId |
| POST /content/:kind/batch-publish | 合集或单集批量发布；`{items:[{id,updatedAt}],parentId?}`，单集必填 parentId；返回 published/skipped |
| POST /content/:kind | 新增，子级需 parentId |
| PUT /content/:kind/:id | 编辑，需完整编辑字段及 updatedAt |
| GET /content/:kind/:id/impact | 删除影响范围 |
| DELETE /content/:kind/:id | 软删除，JSON body 含 updatedAt |
| GET /collections/:id/export | 导出清单 |
| GET /users | page/limit/q/admin=1 |
| PUT /users/:id | action=grant/revoke/reset-password/disable，需 updatedAt；grant 需 username/password，重置需 password |
| GET /progress | kind=sentences/episodes；userId/collectionId/episodeId/page/limit |
| GET /audio | q/episodeId/page/limit |
| GET /audio/:id | 校验可见性及哈希后播放 |
| GET /audit | actorId/targetId/page/limit |

写请求带 `X-CSRF-Token`，从登录或 `/auth/me` 获得。管理响应统一 no-store；静态网页设置 CSP、禁止被 iframe 嵌入。错误区分 400（输入）、401（会话）、403（权限/CSRF）、404（不存在）、409（并发/删除/约束）。

## 验证

```bash
npm run typecheck
npm test
npm run build
```

管理单元测试覆盖密码、会话隔离、CSRF、初始改密、软删除、并发版本、导入锁、审计回滚、最后管理员保护与 BIGINT。HTTP 集成测试启动临时端口并使用内存数据库替身，验证同端口页面、登录、编辑、冲突和退出，不访问真实数据库。`server/test/helpers/admin-app.ts` 仅供测试使用，不包含于构建产物。

首次生产部署前确认数据库迁移已完成，并检查 HTTPS 下的 Cookie、反向代理 Host 和实际音频挂载。镜像回退不会撤销管理员权限或审计数据。


## 上传 JSON 新增单集

在某合集的「单集管理」中点击「导入 JSON」，可下载模板。选择 `.json` 文件（最多 1 MB），点击「校验并预览」，核对合集、标题、序号、条目数量及全部中英文，再点击「确认导入」。文件在浏览器中读取为 JSON，不保存原始上传文件。服务端同样验证大小、结构、字段及关联。

文件为一个单集对象，不是合集清单或数据库导出：

```json
{
  "sourceKey": "cafe-episode-001",
  "title": "咖啡馆点单",
  "sequence": 2,
  "status": 0,
  "sourceUrl": null,
  "sentences": [
    {
      "sourceKey": "line-001",
      "sequence": 1,
      "zh": "我想要一杯拿铁，谢谢。",
      "en": "I would like a latte, please.",
      "speaker": 0,
      "speakerName": "",
      "context": "咖啡馆点单"
    }
  ]
}
```

- sourceKey 使用 1–80 位小写字母、数字、短横线；单集标识在合集内唯一，条目标识在单集内唯一，不能随排序改变。
- 单集 sequence 必须未被当前合集有效单集占用；条目 sequence 为正整数且集内不重复。每集 1–200 条。
- title、sourceKey、sequence、sentences 以及每条的 sourceKey、sequence、zh、en 必填。speaker 默认 0，speakerName/context 默认空，sourceUrl 默认 null。
- status 省略或为 0；导入只新增草稿，之后可通过单条编辑或批量发布上线。不会替换正式清单、自动覆盖已有单集或恢复已删除数据。
- 预览不写入记录；应用携带预览内容哈希，重新检查合集状态、sourceKey 和排序。整集及审计同事务写入，失败回滚。重复提交相同 sourceKey 返回 409，不重复创建。
- 与现有导入、编辑共用合集锁；数据库 ID 用 sourceKey 查询，保持 BIGINT 字符串精度。导入完成后可导出合集清单同步回仓库，来源及 AI 补写记录仍需按项目规范单独维护。

接口：`POST /api/admin/episodes/import/preview` 接收 `{parentId,episode}`；`POST /api/admin/episodes/import` 接收相同内容及预览返回的 `previewHash`。两者均要求管理员会话及 CSRF 校验，未改初始密码时不可调用。


## 列表导航与返回

合集和单集列表支持点击整行（名称、简介或空白）进入下一级，也支持聚焦行后按 Enter/空格。勾选、编辑、删除、导出等控件保持独立操作；已删除记录不可进入。页面「返回」与浏览器前进/返回使用站内操作历史，恢复页面、筛选条件、页码和保存的滚动位置；首次进入时页面返回禁用。刷新可恢复当前管理页面。返回仅改变浏览位置，不撤销已保存的数据。
