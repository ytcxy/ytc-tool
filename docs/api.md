# 接口说明

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
| GET | /api/episodes/:id/sentences | 双语条目，最多 200 条，含 speaker（0 你 / 1 AI）、speakerName（人物名，空字符串时沿用你 / AI）和 audioUrl（无音频为 null） |
| GET | /api/sentences/:id/audio?version=SHA256 | 公开逐句音频，校验内容及完整父级可见性，支持 Range；200 / 206 / 400 / 404 / 416 |
| GET | /api/me/collections/:id/progress | 当前用户的合集学习状态 |
| GET / PUT | /api/me/episodes/:id/progress | 查询 / 保存位置和完成标记 |
| PUT | /api/me/sentences/:id/progress | 自评状态 |
| GET | /api/me/summary | 统计与最近学习 |
| GET | /api/me/review | 待复习分页列表 |

分页参数 `page` 从 1 开始、`limit` 为 1–100。鉴权接口使用 `Authorization: Bearer <token>`，用户身份从会话取得，不接受前端指定其他用户。错误为 `{statusCode,message}`，不输出数据库密码、Secret、微信 code 或内部 SQL。


单集条目与个人待复习列表均返回 `speakerName`，优先展示人物名；该字段与练习角色 `speaker` 独立，不从 context 前缀推断。


## 网页管理接口

新增 `/api/admin`，使用独立的管理 Cookie、管理员权限检查与 CSRF 校验；小程序 Bearer 会话不能访问管理接口。接口清单、参数和错误规则见 [网页管理端](web-admin.md#管理接口)。
