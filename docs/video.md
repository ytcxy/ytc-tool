# 前五集视频学习

## 范围与状态

第二个合集 `forced-english-system` 的前五集复用既有 76 条台词与数据库数字 ID。未修改台词、人物名、学习记录。视频功能需要执行独立的两张表迁移。未配置视频的单集继续使用原页面。

第一集视频是用户提供的 `pre5.mp4` 中的第一遍无字幕版，含原片头，时长约 30.03 秒。前五集均已配置视频与逐句时间轴。视频没有打入小程序包或 Docker 镜像。

运行时以数据库为准：`el_episode_video` 保存单集视频元数据，`el_sentence_video` 保存逐句起止时间与视频版本。每次请求查询当前记录，编辑时间轴无需重启 API。JSON 不参与运行时映射，也不会在数据库无记录时兜底恢复。

`server/video/manifest.json` 仅为批量导入/备份清单；`sourceKey` 仅在导入时解析真实数字 ID。视频表与片段表均包含数字自增主键、创建/更新时间和 `is_del`，唯一索引不包含 `is_del`；使用外键、不级联物理删除。视频发布继承单集与合集，片段还检查句子可见性。

## 时间轴来源

`server/video/episode-001-timing-source.json` 至 `episode-005-timing-source.json` 记录原文件、第一遍与第二遍的偏移及字幕采样结果。第二至五集的逐句时间表见 [时间轴明细](video-timeline-002-005.md)。

时间轴基于各集第二遍带字幕画面的 200ms OCR 采样与第一遍静音间隙核对（第一集偏移 30.03 秒），不宣称为人工逐句试听结果。英语、中文和人物名共同参与文本哈希；内容不匹配时该句不返回片段时间，不能自动给改写台词套用旧定位。

| 条目 | 起点（秒） | 终点（秒） |
|---|---:|---:|
| 01 | 3.500 | 5.100 |
| 02 | 5.200 | 7.210 |
| 03 | 7.340 | 9.320 |
| 04 | 9.410 | 10.950 |
| 05 | 11.180 | 12.800 |
| 06 | 12.920 | 14.400 |
| 07 | 14.880 | 16.800 |
| 08 | 17.000 | 18.800 |
| 09 | 18.840 | 19.430 |
| 10 | 19.470 | 20.580 |
| 11 | 20.750 | 23.340 |
| 12 | 23.450 | 25.800 |
| 13 | 25.820 | 26.800 |
| 14 | 26.820 | 28.200 |

发布前需逐句试听、微信 iOS/Android 真机复核，尤其第 9、10、13、14 条间隙短。原生视频 `timeupdate` 回调不能保证逐帧暂停，可能带出下一句的开头；不要以自动化测试代替此项验收。

## 本地资源与启动

开发目录结构：

```text
server/video/
  manifest.json
  episode-001-timing-source.json
  files/<SHA256>.mp4             # Git 忽略
```

本次工作已在本地准备五集文件。换机器后用下列命令安装，参数为实际文件路径：

```bash
# 仓库根目录运行；默认只打印预览，不写数据库，不修改文件
npm run video:install --workspace server -- --source=/path/to/episode-01.mp4
# 确认预览后安装本地文件（已有不同内容不会覆盖）
npm run video:install --workspace server -- --source=/path/to/episode-01.mp4 --apply
```

文件安装脚本只接受清单中已匹配 SHA-256 的文件，并拒绝覆盖不同清单。首次读取或文件属性变化时以固定内存缓冲校验哈希，播放时用文件流按 Range 读取，不将整段视频常驻内存。缺少表、有效映射或文件时返回 `video: null`，其他合集正常使用。数据库中的映射变化在下一次请求生效。

文件准备后再预览数据库差异：

```bash
npm run video:plan --workspace server -- --database=ytc-tool
# 经确认后建缺失表并导入；已有数据修改还需 --accept-changes
npm run video:import --workspace server -- --database=ytc-tool
npm run video:plan --workspace server -- --database=ytc-tool
```

SQL 位于 `server/migrations/006_episode_video.sql`。命令复用后端连接配置与北京时间会话，默认预览；生产必须显式指定 `--database=ytc-tool-prod`，并单独取得授权。脚本先校验表结构、发布范围、源内容、文件和差异，再创建缺失表，以单集为事务边界写映射；DDL 不属于 MySQL 事务，失败时可能留下空表，但不会清理已有数据。全局导入锁防止并行导入，数字 ID 查询读取，不使用 insertId。软删除、归属不符、遗漏已有片段或文本不符均阻止导入。

本次已获授权并在 `ytc-tool` 测试库完成建表及导入：单集 ID `401`，视频 ID `1`，片段 14 条。再次预览为 0 新增、0 更新、14 不变。生产库未操作。

后端仍使用 `npm run dev`；需配置现有数据库连接，但本任务未复制或修改 `.env`。小程序在微信开发者工具导入这个 worktree 的根目录。当前 `miniprogram/config.ts` 沿用原有 `prod` 设置；本地联调需按 README 切换到正确的开发 API 地址，不能用旧线上 API 来验收本地功能。

## 页面交互

- 视频页固定占据可用窗口；导航、播放器和紧凑工具栏保持可见，只有台词 `scroll-view` 滚动。
- 中文完整显示，英文默认折叠；状态入口打开三项选择，不堆叠三颗大按钮。
- 首次点播放才装载媒体；点击台词定位到本句，结束暂停；再次点击重播。整集播放从头开始，并跟随当前句。
- Native seek 完成事件没有请求 ID，故串行执行 seek，并只播放最后一次请求，避免快速点击播放旧句。
- 手动触摸列表后停止自动滚动；“回到当前句”恢复跟随。过滤台词会停止当前片段。
- 进入后台和离开页面停止视频；视频与现有音频互斥。视频播放只更新学习位置，不改变掌握状态。
- 游客可播放。自评与完成操作继续使用现有登录与进度接口；保存失败显示“未同步”及重试。

## API

`GET /api/episodes/:id` 新增：

```json
{"video":{"url":"/episodes/123/video?version=<SHA256>","version":"<SHA256>","durationMs":30030}}
```

无资源时 `video: null`。`GET /api/episodes/:id/sentences` 的条目新增 `videoClip: {startMs,endMs,version} | null`；前端同时检查视频版本。

`GET /api/episodes/:id/video?version=<SHA256>`：200 完整响应，206 单一 Range，400 参数无效，404 不可见/版本或文件失效，416 Range 无效。使用 `video/mp4`、`Accept-Ranges: bytes`、`private, no-cache`，每次重新校验父级可见性。不开放目录枚举或客户端文件路径。

为沿用现有发布权限检查，首版由 NestJS 文件流提供视频，未增加绕过数据库检查的公开静态 URL。现有小文件体量可先验证；以后若改成 Nginx 内部转发，需要保留鉴权/可见性检查。

## 线上部署

2026-09-19，经用户授权已在生产库 `ytc-tool-prod` 创建 `el_episode_video`、`el_sentence_video`，导入第一集（episode ID `401`）的视频信息及 14 条时间点。再次 dry-run 为 0 新增、0 更新、14 条不变，无冲突。

五集单遍视频均已安装至 `/opt/ytc-tool/video/files/`，使用 SHA-256 文件名，总计 33,974,556 字节，服务器逐文件哈希校验通过。原始名称与哈希对应清单位于 `/opt/ytc-tool/video/upload-pre5-20260919.json`。第二至五集现已录入 62 条时间点（分别为 14、16、15、17 条），五集合计 76 条。生产库再次 dry-run 为 0 新增、0 更新、76 条不变，无冲突。后续核对时测试库第二至五集均已发布，经用户授权已补齐 4 条视频信息及 62 条时间点；复查五集合计 76 条不变、无冲突。本次未调整发布状态或导入规则。

本次未发布后端镜像或小程序。检查时运行中的 API 容器尚无视频目录挂载，以上数据库和文件准备不代表线上已可播放。

部署脚本已准备 `/opt/ytc-tool/video` → `/app/video` 的只读挂载，并设置 `VIDEO_DIR=/app/video`。视频文件需要单独安装，数据库映射需要独立导入；回退镜像不会回退映射。

可先在本地生成资源包，目录不要选项目代码或既有资源目录：

```bash
npm run video:install --workspace server -- --source=/path/to/episode-01.mp4 --directory=/tmp/episode-video-bundle
npm run video:install --workspace server -- --source=/path/to/episode-01.mp4 --directory=/tmp/episode-video-bundle --apply
```

取得线上部署和数据库操作授权后，先将 `files/` 安装到服务器资源目录（API 只读访问），再在受控管理环境使用相同清单和文件执行 `video:plan` / `video:import --database=ytc-tool-prod`，最后部署后端、上传小程序。运行 API 不需要 `manifest.json`。已有不同映射须先审阅差异并显式 `--accept-changes`；不会重新导入台词或改动学习记录。管理脚本需要开发依赖中的 tsx，不能假设只含生产依赖的 API 镜像可直接运行 TypeScript 管理脚本。

## 验证边界

新增替身测试覆盖 BIGINT、父级发布与软删除谓词、范围读取、文件损坏、版本/文本不匹配、切句竞态、后台停止、超时重试及滚动跟随。类型检查、后端构建以及开发者工具自带 WXML/WXSS 编译可在本地执行。

开发者工具 CLI 服务端口当前关闭，UI 连接超时；尚未完成模拟器画面检查、微信真机验证、生产部署。已验证本地后端连接真实测试库时的 14 条映射及视频 Range 响应；尚未验证手机播放边界。
