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
| GET | /api/episodes/:id/sentences | 双语条目，最多 200 条，含 speaker（0 你 / 1 AI） |
| GET | /api/me/collections/:id/progress | 当前用户的合集学习状态 |
| GET / PUT | /api/me/episodes/:id/progress | 查询 / 保存位置和完成标记 |
| PUT | /api/me/sentences/:id/progress | 自评状态 |
| GET | /api/me/summary | 统计与最近学习 |
| GET | /api/me/review | 待复习分页列表 |

分页参数 `page` 从 1 开始、`limit` 为 1–100。鉴权接口使用 `Authorization: Bearer <token>`，用户身份从会话取得，不接受前端指定其他用户。错误为 `{statusCode,message}`，不输出数据库密码、Secret、微信 code 或内部 SQL。

