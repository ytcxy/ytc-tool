# 前 50 集英文音频与上线方案

## 内容与存储

前 50 集共 745 句，总时长约 37.6 分钟；相同音频按哈希复用，共 738 个文件，约 97.5 MiB，清单约 337 KiB。沿用第一集的 macOS Samantha 音色、145 词/分钟，单声道 22050 Hz WAV。包含“你”和 AI 双方台词；合成语音为学习参考，不是原视频录音。文件在 `server/audio/files/`，映射清单在 `server/audio/manifest.json`。

线上采用 **MySQL 映射 + 宿主机文件 + Docker 只读挂载**：

- 新增 `el_sentence_audio`，以 `sentence_id` 唯一关联现有句子，不改句子和学习记录。
- 音频保存在宿主机 `/opt/ytc-tool/audio/files/`，容器只读挂载 `/app/audio`。
- `AUDIO_SOURCE=database` 时，后端从数据库批量查映射，播放时只读取当前句文件，不将所有音频留在内存中。
- 音频不打进镜像，重新部署不丢失；上传新的音频无需重启容器。
- JSON 仅供批量生成、校验和导入，线上播放不加载清单。API URL 和小程序播放方式保持兼容。

## 表设计

建表 SQL：`server/migrations/003_sentence_audio.sql`。脚本会在显式 apply 时检查并创建缺失的表；已有结构不一致时拒绝覆盖。排序规则使用线上 MySQL 5.7.44 支持的 `utf8mb4_unicode_ci`；上传清单会携带当前 SQL 并只读挂载到临时导入容器，不必为 SQL 修正重建 API 镜像。

| 字段 | 类型 | 用途 |
|---|---|---|
| id | BIGINT UNSIGNED，自增 | 音频映射主键 |
| sentence_id | BIGINT UNSIGNED，唯一、外键 | 已有句子 ID，一句一个当前音频 |
| text_sha256 | CHAR(64) | 英文原文哈希，防止修改英文后播放旧音频 |
| file_name | VARCHAR(80) | 哈希文件名，无路径或域名 |
| file_sha256 | CHAR(64) | 文件完整性与 URL 版本 |
| voice / rate | VARCHAR(100) / SMALLINT UNSIGNED | 音色和语速 |
| duration_ms | INT UNSIGNED | 时长，毫秒 |
| created_at / updated_at | DATETIME(3) | 创建、修改时间 |
| is_del | TINYINT UNSIGNED | 软删除，默认 0 |

数字 ID 全程使用字符串，不用序号匹配。导入通过合集、单集、句子的三级 sourceKey 找到数字 ID；检查英文、发布状态和软删除，不自动恢复已删除记录。

## 本地生成与校验

以下命令在仓库根目录运行，需要 Node.js 22+。生成使用 macOS 自带 `say` 和 `afconvert`，不需要付费 TTS 密钥。

```bash
npm run audio:generate --workspace server
npm run audio:validate --workspace server
```

生成脚本固定前 50 集；按已完成集保存检查点，可以中断后重跑。音频文件已加入 Git 忽略，换电脑需复制 `server/audio/files/` 或重新生成；清单保留在仓库。

本地默认 `AUDIO_SOURCE=manifest`，`npm run dev` 仍可直接试听，不依赖新增表。要验证数据库方式，先预览再导入测试库：

```bash
npm run audio:plan --workspace server -- --database=ytc-tool
npm run audio:import --workspace server -- --database=ytc-tool --accept-changes
AUDIO_SOURCE=database npm run dev
```

本地脚本读取 `server/.env`。确认 plan 无冲突后再运行 import；import 会创建表并写映射。

## 首次上线：先部署后端，再更新音频

先按 README 的 `deploy-remote.sh` 命令部署新版后端。新版镜像包含音频管理脚本，并配置独立目录挂载与 `AUDIO_SOURCE=database`。在音频表尚未创建、导入前，页面正常浏览，暂不显示朗读入口。

然后在本地执行（SSH 使用 root，默认 22 端口）：

```bash
# 预览：本地校验全部文件；临时上传清单，只读查询线上数据库
bash sync-audio.sh --host YOUR_SERVER_IP --database=ytc-tool-prod

# 确认差异并备份数据库后：上传文件、创建缺失的表、写入映射
bash sync-audio.sh --host YOUR_SERVER_IP --database=ytc-tool-prod --apply --accept-changes

# 再次预览，预期 insert=0、update=0、unchanged=745、conflicts=[]
bash sync-audio.sh --host YOUR_SERVER_IP --database=ytc-tool-prod
```

`YOUR_SERVER_IP` 替换为服务器 IP；非默认端口加 `--ssh-port PORT`。脚本复用 `/opt/ytc-tool/current/server.env`，不上传密码，不需要服务器安装 Node。数据库操作在同版本的临时 Docker 容器中执行，默认不写数据。测试库可把参数改为 `--database=ytc-tool`，仍使用该服务器配置的数据库账号连接。

后续只更新音频时，直接运行上面的预览、apply，无需构建后端。临时容器负责写宿主机文件，运行中的 API 容器保持只读。小程序前端已接入喇叭功能时，不需要为新增集数重新上传小程序。

## 更新、失败与回退

- 上传和校验全部文件后才写映射；文件使用哈希名称，校验后原子安装，不覆盖已有文件。
- 数据库映射在一个事务内提交；失败回滚，文件可能已经上传但不会删除旧文件。
- 建表 DDL 不可随事务回滚：首次导入失败可能留下空表，解决问题后重新执行即可。
- 并发导入使用数据库锁，与后端部署共用服务器锁。事务内重新锁定并核对句子，防止预览后内容被更改。
- 更新已有映射需 `--accept-changes`；冲突不会因该参数而被跳过。先修正缺失或不一致的内容，再重试。
- 脚本先校验正式目录和历史上传临时目录中的文件哈希，只上传缺失或不完整的文件。重复执行会显示复用和待上传数量；失败保留本次临时目录供下次复用，成功清理本次临时目录。不会自动删除其他历史目录。
- 映射与镜像独立：回退镜像不会回退数据库音频映射。要回退音频，用旧清单及对应文件执行预览和 apply；旧文件保留。
- 体验版需使用线上 HTTPS API。微信后台要分别将 `https://eng.yutc.top` 填入 `request` 和 `downloadFile` 合法域名；只配置请求域名，可能出现页面正常但语音加载失败。还需在 iOS / Android 真机试听、检查切后台停止与失败重试。播放失败时卡片会显示微信音频错误码：10002 为网络错误，10003 为文件错误，10004 为格式错误。
