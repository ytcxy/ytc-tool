# 拾句英语 · ytc-tool

原生微信小程序 + TypeScript + NestJS + MySQL，使用 npm workspaces。按合集复习英语，默认显示中文、隐藏英文，登录后保存进度。共 200 集、3,130 条双语台词，AI 台词为补写参考。

`miniprogram/` 小程序 · `server/` 后端、内容和数据库脚本 · `deploy/` Docker 部署

## 本地启动

需要 Node.js 22+、MySQL 8+ 和微信开发者工具。以下命令都在仓库根目录执行：

```bash
cd ~/code/ytc-tool
npm ci
# 首次配置；已有 .env 则保留
[ -f server/.env ] || cp server/.env.example server/.env
```

填写 `server/.env` 的数据库连接信息（测试库 `DB_NAME=ytc-tool`）和 `WECHAT_APP_ID`、`WECHAT_APP_SECRET`，然后启动后端：

```bash
npm run dev
```

后端默认端口 3000。微信开发者工具导入**仓库根目录**，前端由工具单独编译。

网页管理端同端口提供：访问 `http://localhost:3000/admin/`，使用指定管理员账号密码登录。首次使用前完成管理端增量迁移与管理员初始化，见 [管理端说明](docs/web-admin.md)。

## 小程序环境

修改 `miniprogram/config.ts` 中的 `APP_ENV`，然后重新编译：

| 参数 | 接口地址 |
|---|---|
| `dev` | `http://192.168.1.51:3000/api`，电脑 IP 变化时修改 |
| `prod` | `https://eng.yutc.top/api` |

本地真机调试需手机与电脑在同一网络。体验版和正式版使用 `prod`，并在微信平台配置 HTTPS 合法域名。前端改动需要单独编译、上传小程序。

## 已有数据库升级对话内容

**不清空数据，不重新建表。** 先备份，以下操作测试库；生产库将所有 `--database=ytc-tool` 换为 `--database=ytc-tool-prod`。连接信息读取 `server/.env`。

```bash
# 检查并增加 speaker 字段；已存在且定义正确则跳过
npm run db:speaker:plan --workspace server -- --database=ytc-tool
npm run db:speaker:migrate --workspace server -- --database=ytc-tool

# 预览差异
npm run content:plan --workspace server -- --database=ytc-tool
```

确认差异无误后导入，再检查是否还有变化：

```bash
npm run content:import --workspace server -- --database=ytc-tool --accept-changes
npm run content:plan --workspace server -- --database=ytc-tool
```

`migrate` 和 `import` 会写数据库，`plan` 只读。重复导入不会重复新增，原有 ID 和学习记录保留；最后预览应没有新增或修改。新库首次建表见 [初始化说明](docs/operations.md#新库首次初始化)。

## 后端部署到线上

**先完成生产库 speaker 字段迁移。** 本地启动 Docker Desktop，确认 `server/.env.production` 已配置且 `DB_NAME=ytc-tool-prod`（模板：[server.env.example](deploy/server.env.example)）。

```bash
bash deploy-remote.sh \
  --host 47.120.15.216 \
  --user root \
  --ssh-port 22 \
  --env-file server/.env.production
```

命令末尾加 `--plan` 可仅检查配置。正式执行会测试、构建后端镜像、上传镜像与配置、更新远程容器并健康检查；失败尝试回退。SSH 密码在终端输入。

部署**不会建表、导入内容或上传小程序**。保持 1Panel 代理 `eng.yutc.top` → `http://127.0.0.1:3000`，部署后检查：

```bash
curl --fail https://eng.yutc.top/api/health
# 正常返回 {"status":"ok"}
```

远程容器名 `ytc-tool-api`，日志命令：`docker logs --tail 100 ytc-tool-api`。更新有短暂重启，详细配置和备用部署方式见 [运维说明](docs/operations.md)。

## 校验与文档

```bash
npm run typecheck
npm test
npm run build
npm run content:check --workspace server
```

以上检查不连接真实数据库。修改补写内容后，运行 `npm run content:build --workspace server` 重新生成清单；来源文件和编辑方法见 [内容说明](docs/dialogue-completion.md)。

- [前 50 集英文音频与上传、数据库更新](docs/audio.md)（745 句；独立挂载，脚本预览后导入）
- [项目规范](AGENTS.md) · [数据库设计](docs/database-design.md) · [接口说明](docs/api.md)
- [完整对话稿](docs/dialogues-completed.md) · [内容说明](docs/dialogue-completion.md)
- [数据库初始化与部署排查](docs/operations.md)

## 前五集视频学习

第二个合集前五集支持顶部固定视频、紧凑台词列表和点击逐句播放。视频文件独立安装，视频信息与逐句时间轴存入数据库，不进入小程序包或后端镜像；建表与导入预览、资源安装及尚未完成的真机验收见 [视频说明](docs/video.md)。
