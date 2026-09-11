# 数据库与部署补充说明

日常更新命令见 [README](../README.md)。本文件保留首次初始化和部署排查细节。

## 新库首次初始化

先创建数据库并配置 `server/.env`。下面以测试库为例；生产库把 `--database=ytc-tool` 换为 `--database=ytc-tool-prod`。每次预览确认无误后，再执行下一条写入命令。

```bash
npm run db:plan --workspace server -- --database=ytc-tool
npm run db:migrate --workspace server -- --database=ytc-tool
npm run content:plan --workspace server -- --database=ytc-tool
npm run content:import --workspace server -- --database=ytc-tool
npm run content:plan --workspace server -- --database=ytc-tool
```

初始化会新增 7 张 el_ 表；首次导入包含 1 个合集、200 集、3,130 条台词，当前清单为已发布状态。已有同名表会阻止初始化，不要清空或重建；已有数字主键库使用 README 中的增量更新命令，旧字符串主键结构需单独审查升级路径。

## 已有数据更新

数据库命令读取 `server/.env` 或进程环境变量，`--database` 只指定本次目标，不修改配置文件。只允许 `ytc-tool` 和 `ytc-tool-prod`；默认目标必须是测试库，生产库必须显式指定。

导入通过 sourceKey 匹配原记录，保留数字 ID 和学习记录；不会自动删除缺失内容或恢复软删除记录。`--accept-changes` 允许已审阅的字段更新，不能绕过缺失、软删除冲突。原始完整清单升级时，预期新增 1,541 条 AI 台词，1,390 条原句只调整排序。

导入按单集事务执行，中途失败可排查后重跑，已完成部分保持幂等。整套内容不是一次事务，需要一次性切换时安排维护窗口。新增台词默认未练习，原有自评、学习位置和手动完成标记保留。

新后端查询依赖 speaker 字段，应先迁移字段，再部署后端、导入内容和更新小程序。数据库变更前备份并先在测试库验证。

## 本地上传镜像：运行细节

本地需要 Node.js 22+、npm 依赖、Docker Desktop/Buildx、SSH/SCP；远程需要 Linux、Docker、flock、sha256sum、gzip。生产配置写在 `server/.env.production`，参考 `deploy/server.env.example`。脚本只上传数据库和微信配置，不会执行数据库迁移或内容导入。

SSH 密码由终端交互询问，使用 SSH 连接复用，脚本不保存密码，也不关闭主机密钥校验。首次连接请核对服务器指纹。非默认应用端口传 `--port 3001`，并同步修改 1Panel 的代理目标。

脚本先识别远程 Docker 的 amd64/arm64 架构，再用 `docker buildx build --platform ... --load` 本地构建 Linux 镜像（Apple Silicon 构建 amd64 需要 Docker Desktop 的跨架构支持，首次可能较慢）。本地执行类型检查和测试，镜像内完成编译。镜像通过 `docker save | gzip` 生成归档，和规范化后的环境文件独立经 SCP 上传，服务器校验 SHA-256、`docker load` 并核对镜像配置内容摘要/平台后启动；服务器无需源码、Node.js、npm 或镜像仓库访问。

构建上下文采用文件白名单，环境文件、头像和 Git 历史不进入镜像。远程配置保存至 `/opt/ytc-tool/releases/<版本>/server.env`，目录权限 700、文件权限 600；成功后 `current` 指向该版本。上传中断可能留下 700 权限的 `/tmp/ytc-tool-upload.*` 临时目录，排查后可人工清理。历史生产配置也含密钥，请仅保留需要的回退版本。

服务端仍使用 host 网络 + 127.0.0.1 监听、`ytc-tool-api` 容器、`ytc-tool-uploads` 头像卷和 `unless-stopped` 重启策略。先完成镜像和配置校验，再停止旧容器；数据库健康检查及只读合集查询通过后才完成发布。失败恢复旧容器及其原环境，首次失败停止新容器。成功后保留上一容器（名称带 backup 和版本）用于人工回退，不自动清理历史镜像、配置或头像。更新有短暂重启，不是零停机部署。

1Panel 反向代理和 HTTPS 继续由面板管理：`eng.yutc.top` → `http://127.0.0.1:3000`（OpenResty 须使用 host 网络）。部署脚本不改变 DNS、证书或小程序地址。HTTPS 可用后再切换小程序配置。

参考：[Docker Buildx 单平台构建与加载](https://docs.docker.com/reference/cli/docker/buildx/build/)。

镜像身份校验以导出归档的 config 内容 SHA-256 为准，兼容 Docker Desktop/containerd 返回索引 ID、传统 Docker 返回 config ID 的差异；文件传输 SHA-256 和平台校验仍保留。

## 备用方式：在服务器上构建

将项目代码上传到服务器，确保 Docker 已启动。只需运行根目录的 `deploy-docker.sh`，不需要安装宿主机 Node.js 或 systemd 服务：

```bash
bash deploy-docker.sh /实际路径/server.env
# 如需其他端口：
bash deploy-docker.sh /实际路径/server.env 3001
```

配置文件使用 Docker env-file 格式 `KEY=value`，不要加 `export`、包裹引号或行末注释。权限设为 `600`。必填示例（填写实际值）：

```dotenv
DB_HOST=127.0.0.1
DB_PORT=3306
DB_NAME=ytc-tool-prod
DB_USER=填写数据库账号
DB_PASSWORD=填写数据库密码
WECHAT_APP_ID=填写小程序AppID
WECHAT_APP_SECRET=填写小程序AppSecret
```

脚本使用 Linux Docker host 网络，因此 `DB_HOST=127.0.0.1` 指服务器本机；如果数据库未在本机开放连接，填写服务器可访问的地址。容器内固定覆盖运行环境、监听地址和头像目录，不受配置文件中的本地调试设置影响。只允许生产库配置，不执行建表或导入。

首次执行会在 Docker 内安装依赖并编译。再次运行同一命令更新容器；先构建、检查配置，再替换旧容器，检查失败回退旧容器。更新会短暂重启，不是零停机。旧镜像保留供人工清理，头像卷 `ytc-tool-uploads` 始终保留，不要用 `docker volume rm` 删除它。容器名 `ytc-tool-api`，重启策略为 `unless-stopped`。基础镜像使用 `public.ecr.aws/docker/library/node:22-bookworm-slim`，需要该镜像源和 npm 仓库可访问。

服务仅监听服务器本机 `127.0.0.1:3000`。1Panel 的 OpenResty 使用 host 网络时，反向代理目标填 `http://127.0.0.1:3000`，域名填 `eng.yutc.top`；不要重写 `/api` 路径或开启接口缓存。设置请求体上限为 `3m`，X-Forwarded-For 用 `$remote_addr` 覆盖。DNS A 记录指向服务器公网 IP，HTTPS 证书在 1Panel 中配置。脚本不修改面板、DNS、证书或小程序地址。

```bash
docker logs --tail 100 ytc-tool-api
curl --fail http://127.0.0.1:3000/api/health
```

参考：[Docker host 网络](https://docs.docker.com/engine/network/drivers/host/)。上线 HTTPS 验证成功后，将小程序 `APP_ENV` 切换为 `prod` 并重新编译。

