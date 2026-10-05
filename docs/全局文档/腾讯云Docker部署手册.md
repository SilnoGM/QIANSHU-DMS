# 千树 DMS 腾讯云 Docker 部署手册

## 1. 适用范围与已确认决策

本文档描述在腾讯云服务器（北京地域）上，以 Docker Compose 将千树 DMS 前端、后端与数据库整体部署上线的完整流程，以及后续更新、回滚与备份方式。

本文是操作手册；生产门禁仍以 [`生产部署与 Gate OPS 检查清单`](<./生产部署与Gate OPS检查清单.md>) 为准，发布身份仍以 [`发布与版本管理`](<./发布与版本管理.md>) 为准。本文不替代两者，也不授权执行其中要求单独审批的操作。原 1Panel 方案已归档，见 [`工程归档`](../工程归档/归档索引.md)。

### 1.1 已确认的部署决策

| 决策项 | 结论 |
| --- | --- |
| 总体形态 | 纯 Docker + Compose：`web`（nginx：静态产物 + TLS + `/api` 反代）、`server`（Node 24）、`db`（PostgreSQL 16）三个容器；1Panel 不再作为部署载体 |
| 编排真相源 | 仓库 `deploy/docker/`（Dockerfile、nginx 配置、entrypoint、compose 模板、systemd 清理单元） |
| 数据库 | `postgres:16` 容器随编排运行，数据目录绑定挂载到宿主持久目录；版本与 CI 测试使用同一 digest |
| 镜像来源 | 发布流程在 CI 内构建两个镜像并 `docker save` 成归档，作为 Release 附件；服务器只 `docker load`，不在服务器构建 |
| 镜像分发 | 不使用镜像仓库：本地 `gh release download` 六个附件 → 校验 → 上传服务器 → `docker load` |
| 基础镜像 | 两个镜像都以 `ubuntu:24.04` 为基础，与 Release 的 Ubuntu 24.04 / glibc / x64 承诺一致 |
| 媒体投递 | `MEDIA_CONTENT_DELIVERY_MODE=application`（应用层流式交付；内部重定向见第 11.3 节的前置条件） |
| 证书 | 使用已有证书，挂载进 `web` 容器，不申请 ACME |
| 媒体清理 | 宿主 systemd timer 调用 `docker compose run --rm server ...`，语义与宿主部署的 oneshot 单元一致 |
| 迁移执行 | 本地通过 SSH 隧道对生产库执行 `prisma migrate deploy`，连接串只出现在本地 |
| 端口暴露 | 只有 `web` 容器发布 80/443；`server` 与 `db` 不发布宿主端口，仅 compose 网络内可达 |
| 维护窗口 | 暂无固定约定；更新与回滚按第 12 节执行 |

### 1.2 与既有文档的关系

- [`生产部署与 Gate OPS 检查清单`](<./生产部署与Gate OPS检查清单.md>)：安全加固、门禁等级与部署记录格式不变；其中「使用仓库 systemd unit」「Server 只监听 127.0.0.1」的口径在本形态下由「使用仓库 Compose 编排」「Server 不发布宿主端口」替代。
- [`媒体存储部署与恢复`](../后端文档/媒体存储部署与恢复.md)：目录、权限、双探针、备份与恢复的语义不变；`server/deploy/systemd/` 与 `server/deploy/nginx/` 模板由本形态的 `deploy/docker/` 资产替代，仅作目录语义与未来切换参考。
- [`发布与版本管理`](<./发布与版本管理.md>)：Release 附件由四个扩展为六个（新增两个镜像归档）。

## 2. 部署总览

```
                  ┌──────────────── 腾讯云轻量服务器（Ubuntu 24.04, Docker）────────────────┐
 用户 ── 443 ──►  │  web 容器（nginx 1.24：静态产物 + /api 反代 + TLS + 501m 上传）          │
                  │      │  静态：/usr/share/nginx/html（镜像内，只读）                     │
                  │      └── /api ──► http://server:3000（compose 网络，不发布宿主端口）    │
                  │                      server 容器（node dist/main.js，uid/gid 10001）  │
                  │                      ├─ 卷：/var/lib/qianshu-dms/media ──► /srv/qianshu-dms/media
                  │                      └── DATABASE_URL ──► db:5432                      │
                  │  db 容器（postgres:16，digest 固定，不发布宿主端口）                      │
                  │      └─ 卷：/var/lib/postgresql/data ──► /srv/qianshu-dms/pgdata        │
                  └──────────────────────────────────────────────────────────────────────┘
```

宿主机关键路径：

| 路径 | 用途 |
| --- | --- |
| `/srv/qianshu-dms/docker-compose.yml` | 生产编排（由仓库 `deploy/docker/docker-compose.yml` 复制并替换占位符） |
| `/srv/qianshu-dms/.env` | compose 插值变量（镜像 Tag、数据库三件套）；权限 0600 |
| `/srv/qianshu-dms/server.env` | Server 环境变量；权限 0600 |
| `/srv/qianshu-dms/certs/{fullchain.pem,privkey.pem}` | 已有证书，只读挂载进 web 容器 |
| `/srv/qianshu-dms/pgdata` | PostgreSQL 数据目录（uid/gid 999，postgres 镜像默认用户） |
| `/srv/qianshu-dms/media/{staging,assets,trash}` | 媒体持久目录（uid/gid 10001，权限 0750） |
| `/srv/qianshu-dms/images/<tag>` | 每个版本的镜像归档与元数据（回滚点） |

## 3. 第 0 步：安全加固前置（未完成前不得继续）

审计快照结论为 `BLOCKED`，且安全加固尚未完成。进入部署前必须完成 [`生产部署与 Gate OPS 检查清单`](<./生产部署与Gate OPS检查清单.md>) 第 4 节的加固（云侧入口、SSH、账户、补丁、快照），顺序与停止条件以该文档为准。本形态下的端口口径调整为：

- `22/tcp` 只允许管理 CIDR 或 VPN；`80/443` 在站点与证书验收后才开。
- 1Panel 已弃用：面板端口（原 28317）不开放；若仍保留面板作运维辅助，按检查清单 4.3 单独加固。
- `3000/tcp`、`5432/tcp` 不得发布到宿主机（本编排不发布这两个端口，云防火墙与宿主防火墙双重确认不从公网可达）。
- Docker 守护进程只允许受控身份操作：不要把普通账号加入 `docker` 组；容器不启用特权、不挂载宿主根目录。

## 4. 镜像与附件的下载、校验与上传

### 4.1 本地下载并校验六个附件

在本地机器执行（需已登录 `gh`）：

```bash
release_dir="$(mktemp -d)"
gh release download <tag> --repo SilnoGM/QIANSHU-DMS --dir "$release_dir"
cd "$release_dir"
shasum -a 256 -c SHA256SUMS        # macOS；Linux 用 sha256sum -c
ls -l                              # 应恰好 6 个文件
```

打开 `release-manifest.json`，核对 tag、source Commit、`components` 与 `images` 的归档名、sha256 与镜像 digest。六附件中本次要上传四个大文件：

- `qsmds-server-<tag>-linux-x64.tar.gz`
- `qsmds-web-<tag>.tar.gz`
- `qsmds-server-image-<tag>-linux-x64.tar.gz`
- `qsmds-web-image-<tag>-linux-x64.tar.gz`

### 4.2 上传到服务器

把四个归档与 `release-manifest.json` 上传到服务器 `/srv/qianshu-dms/images/<tag>/`（`scp`/`rsync` 均可；服务器不直连 GitHub）：

```bash
ssh <服务器SSH用户>@<服务器公网IP> 'sudo install -d -o root -g root -m 0750 /srv/qianshu-dms/images/<tag>'
scp ./qsmds-*-<tag>*.tar.gz ./release-manifest.json <服务器SSH用户>@<服务器公网IP>:/tmp/
ssh <服务器SSH用户>@<服务器公网IP> 'sudo mv /tmp/qsmds-*-<tag>*.tar.gz /tmp/release-manifest.json /srv/qianshu-dms/images/<tag>/'
```

在服务器上复核摘要（与本地 `SHA256SUMS` 中的对应行一致）：

```bash
cd /srv/qianshu-dms/images/<tag> && sha256sum -c <(grep -E 'qsmds-(server|web)(-image)?-<tag>' /srv/qianshu-dms/images/<tag>/SHA256SUMS)
```

### 4.3 载入镜像并核对 digest

```bash
cd /srv/qianshu-dms/images/<tag>
sudo docker load -i qsmds-server-image-<tag>-linux-x64.tar.gz
sudo docker load -i qsmds-web-image-<tag>-linux-x64.tar.gz
sudo docker image inspect --format '{{.Id}}' qsmds-server:<tag>   # 应等于 manifest.images.server.digest
sudo docker image inspect --format '{{.Id}}' qsmds-web:<tag>      # 应等于 manifest.images.web.digest
```

两个 `Id` 与 `release-manifest.json` 的 `images.*.digest` 不一致时停止部署并重新上传。

## 5. 宿主机准备

### 5.1 校验 Docker 与 Compose

```bash
docker version --format '{{.Server.Version}}'
docker compose version
```

要求 Docker 引擎可用、`docker compose` v2 子命令存在、`docker buildx` 可用（镜像只加载不构建，但保留校验入口）。缺失时先安装并重新执行第 3 节的门禁检查。

### 5.2 创建目录与身份

```bash
sudo install -d -o root -g root -m 0750 /srv/qianshu-dms
sudo install -d -o root -g root -m 0750 /srv/qianshu-dms/certs
sudo install -d -o root -g root -m 0750 /srv/qianshu-dms/images
sudo install -d -o 999 -g 999 -m 0700 /srv/qianshu-dms/pgdata
sudo install -d -o 10001 -g 10001 -m 0750 /srv/qianshu-dms/media
sudo install -d -o 10001 -g 10001 -m 0750 /srv/qianshu-dms/media/staging
sudo install -d -o 10001 -g 10001 -m 0750 /srv/qianshu-dms/media/assets
sudo install -d -o 10001 -g 10001 -m 0750 /srv/qianshu-dms/media/trash
```

说明：

- `pgdata` 使用 `postgres` 镜像的默认 uid/gid（999），目录权限 0700；PostgreSQL 数据目录不要手工改权限。
- 媒体目录必须由 `10001:10001` 拥有且权限为 `0750`：媒体探针要求目录权限不含组写与其他访问（`(mode & 0o027) === 0`），否则 `read` 能力判定为 down，Server 启动会被 preflight 拦下。
- 目录不得放在源码、Release 暂存或系统临时目录内。

**验证**：

```bash
stat -c '%a %u:%g' /srv/qianshu-dms/media /srv/qianshu-dms/pgdata /srv/qianshu-dms/certs
```

### 5.3 放置证书

把已有证书写入 `/srv/qianshu-dms/certs/`，命名为 `fullchain.pem` 与 `privkey.pem`：

```bash
sudo install -o root -g root -m 0644 <本地fullchain> /srv/qianshu-dms/certs/fullchain.pem
sudo install -o root -g root -m 0600 <本地privkey>   /srv/qianshu-dms/certs/privkey.pem
```

## 6. 编写编排与环境文件

### 6.1 复制模板

从仓库（或 Release 源码归档）取出 `deploy/docker/` 下的模板：

```bash
# 本地执行；<worktree> 为与 <tag> 一致的源码目录
scp <worktree>/deploy/docker/docker-compose.yml <worktree>/deploy/docker/.env.example <worktree>/deploy/docker/server.env.example \
  <服务器SSH用户>@<服务器公网IP>:/tmp/
ssh <服务器SSH用户>@<服务器公网IP> 'sudo mv /tmp/docker-compose.yml /tmp/.env.example /tmp/server.env.example /srv/qianshu-dms/ && sudo mv /srv/qianshu-dms/.env.example /srv/qianshu-dms/.env && sudo mv /srv/qianshu-dms/server.env.example /srv/qianshu-dms/server.env'
ssh <服务器SSH用户>@<服务器公网IP> 'sudo chmod 0600 /srv/qianshu-dms/.env /srv/qianshu-dms/server.env'
```

### 6.2 填写 `.env`

| 键 | 值 |
| --- | --- |
| `QIANSHU_IMAGE_TAG` | `<tag>`（更新与回滚就是改这一行） |
| `POSTGRES_DB` | `<数据库名>`（建议 `qianshu_dms`） |
| `POSTGRES_USER` | `<数据库用户名>`（不要用超级用户） |
| `POSTGRES_PASSWORD` | `<数据库密码>`（只记录在密码管理器） |

### 6.3 填写 `server.env`

按仓库 `deploy/docker/server.env.example` 逐项替换。与宿主部署的差异只有两处：`DATABASE_URL` 的主机是 compose 服务名 `db`，`MEDIA_STORAGE_ROOT` 是容器内路径。

| 键 | 值 | 说明 |
| --- | --- | --- |
| `DATABASE_URL` | `postgresql://<数据库用户名>:<数据库密码>@db:5432/<数据库名>` | 与 `.env` 中的三件套保持一致 |
| `APP_ORIGIN` | `https://<域名>` | **必须与最终对外域名完全一致**，否则登录被 CSRF 校验拒绝 |
| `TRUST_PROXY_HOPS` | `1` | 只有 web 容器一层反代 |
| `AUTH_USERNAME_HMAC_KEY` / `AUTH_USER_ID_HMAC_KEY` / `AUTH_IP_HMAC_KEY` | `<key1>` / `<key2>` / `<key3>` | 32-byte base64url，三者互不相同，生成方式见附录 15.1 |
| `MEDIA_CONTENT_DELIVERY_MODE` | `application` | 本次决策 |
| `MEDIA_FFPROBE_PATH` / `MEDIA_QPDF_PATH` | `/usr/bin/ffprobe` / `/usr/bin/qpdf` | 镜像内已安装 |

**验证**：

```bash
sudo stat -c '%a %U:%G' /srv/qianshu-dms/.env /srv/qianshu-dms/server.env   # 应输出 600 root:root
```

## 7. 数据库迁移：本地 SSH 隧道执行

数据库此前为空库，迁移在建库后、启动 Server 前执行一次；更新版本时同样先迁移、后换镜像。

### 7.1 本地准备与隧道

```bash
# 本地仓库，切到与 Release 相同的源码
git fetch --tags
git switch --detach <tag>
pnpm -C server install --frozen-lockfile

# 通过服务器转发到 db 容器所在宿主端口；db 不发布宿主端口，因此经 docker 转发
ssh -N -L 15432:127.0.0.1:5432 <服务器SSH用户>@<服务器公网IP>
```

说明：compose 未把 5432 发布到宿主机。如需隧道，使用容器网络内地址：

```bash
# 服务器上执行，取得 db 容器在 compose 网络中的地址
docker inspect --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' $(docker compose -f /srv/qianshu-dms/docker-compose.yml ps -q db)
# 本地隧道改为指向该地址（示例）
ssh -N -L 15432:<db容器IP>:5432 <服务器SSH用户>@<服务器公网IP>
```

### 7.2 执行迁移

```bash
cd <本地仓库>/server
DATABASE_URL='postgresql://<数据库用户名>:<数据库密码>@127.0.0.1:15432/<数据库名>' pnpm db:migrate:deploy
```

注意事项：连接串只作为单次命令的环境变量，不写入 `.env`、脚本或 shell 历史（可用 `set +o history`）；`migrate deploy` 只应用未执行的迁移，可安全重复执行；首次执行前确认第 3 节的快照已完成。

### 7.3 验证

```bash
# 再次执行，应输出 "No pending migrations"
DATABASE_URL='...@127.0.0.1:15432/<数据库名>' pnpm db:migrate:deploy

# 服务器上抽查表结构
docker compose -f /srv/qianshu-dms/docker-compose.yml exec -T db \
  psql -U <数据库用户名> -d <数据库名> -c '\dt' | head -30
```

## 8. 首次启动与初始化

### 8.1 启动编排

```bash
cd /srv/qianshu-dms
sudo docker compose up -d
sudo docker compose ps
```

`db` 先经过 healthcheck（`pg_isready`），`server` 才会启动；`server` 启动前会执行媒体 preflight（见 entrypoint），任一能力不满足都会导致容器重启循环。

**验证**：

```bash
sudo docker compose logs --tail=50 server      # 无环境校验或 preflight 失败
sudo docker compose exec -T server curl -fsS http://127.0.0.1:3000/api/health
sudo ss -lntp | grep -E ':(80|443|3000|5432)\b'   # 只应看到 80/443（docker-proxy），不应出现 3000/5432
```

### 8.2 创建管理员账号

该命令是交互式的，必须在真实终端执行（`-it`），密码由操作员当场输入：

```bash
cd /srv/qianshu-dms
sudo docker compose run --rm server node dist/cli/auth-admin/bootstrap-admin.js
```

### 8.3 初始化基础数据

```bash
cd /srv/qianshu-dms
sudo docker compose run --rm server node dist/cli/seed/seed-run.js            # 默认只预览
sudo docker compose run --rm server node dist/cli/seed/seed-run.js --apply    # 确认后写入
```

摘要中出现非空 `conflicts` 时停止并人工处理；`seed` 幂等，不会覆盖已有记录。

### 8.4 启用媒体清理定时任务

```bash
sudo install -o root -g root -m 0644 <worktree>/deploy/docker/systemd/qianshu-dms-media-cleanup.service /etc/systemd/system/qianshu-dms-media-cleanup.service
sudo install -o root -g root -m 0644 <worktree>/deploy/docker/systemd/qianshu-dms-media-cleanup.timer /etc/systemd/system/qianshu-dms-media-cleanup.timer
sudo systemctl daemon-reload
sudo systemd-analyze verify /etc/systemd/system/qianshu-dms-media-cleanup.service /etc/systemd/system/qianshu-dms-media-cleanup.timer
sudo systemctl enable --now qianshu-dms-media-cleanup.timer
systemctl list-timers qianshu-dms-media-cleanup.timer
```

手工验证一次：

```bash
sudo systemctl start qianshu-dms-media-cleanup.service
sudo systemctl status qianshu-dms-media-cleanup.service --no-pager
```

## 9. Web 与 TLS 验收

站点配置在 `web` 镜像内（`deploy/docker/nginx/qianshu-dms.conf`），不需要面板配置：

- 80 端口 301 跳转到 HTTPS；
- 443 使用挂载证书，TLS 1.2+；
- 静态产物带哈希缓存头，`index.html` 不缓存；
- `/api/` 反代到 `http://server:3000`，单请求体上限 501m。

**验证**（本地机器）：

```bash
curl -sSI https://<域名>/ | head -5
curl -sSI http://<域名>/ | head -3          # 应返回 301
curl -sS https://<域名>/api/health
openssl s_client -connect <域名>:443 -servername <域名> </dev/null 2>/dev/null | openssl x509 -noout -dates -subject
```

登录被拒绝且 `server` 日志出现来源校验类错误时，核对 `APP_ORIGIN` 与 `TRUST_PROXY_HOPS`，改完执行 `sudo docker compose up -d server`。

### 9.1 （备选）未来切换 internal_redirect 的前置条件

本形态下 web 容器可控，切换 `internal_redirect` 需要同时做三件事：给 `web` 容器增加媒体目录只读挂载、解决容器内 nginx worker 对 `0750 10001:10001` 目录的读权限、把 `server/deploy/nginx/qianshu-dms-media.conf` 的 internal location 片段并入站点配置；随后把 `MEDIA_CONTENT_DELIVERY_MODE` 改为 `internal_redirect` 并重建 `web` 与 `server`。未经实测不要切换。

## 10. 上线验证清单

| 项目 | 方法 | 期望 |
| --- | --- | --- |
| 容器 | `docker compose ps` | 三个服务 Up；db/server 为 healthy |
| 健康检查 | `docker compose exec -T server curl -fsS http://127.0.0.1:3000/api/health` | 200，database up |
| 监听面 | `sudo ss -lntp` | 只有 80/443；无 3000、5432 宿主监听 |
| 前端 | 浏览器访问 `https://<域名>` | 登录页正常，静态资源全部 200 |
| 登录 | 用 bootstrap 管理员登录 | 成功，刷新后会话保持 |
| 权限 | 用低权限角色登录 | 菜单与接口按权限收敛 |
| 媒体 | 上传一张图片并预览 | 上传成功、预览正常（application 模式） |
| 视频（可选） | 上传 MP4 并拖动进度 | 分片请求 206 正常 |
| 订单图片 | 在采购订单中生成订单图片 | 生成成功（验证 sharp/Pango 与归档字体、FONTCONFIG_FILE） |
| 媒体探针 | `docker compose run --rm server node dist/commands/media-operations.js health` | 能力检查全部通过 |
| 迁移状态 | 第 7.3 节重复执行 | No pending migrations |
| 定时任务 | `systemctl list-timers qianshu-dms-media-cleanup.timer` | 已排程 |
| 重启存活 | `docker compose restart server` 后重新健康检查 | 数据与媒体不丢失 |
| 备份 | 执行第 13.2 节备份 | 数据库与媒体同一恢复点，摘要与文件数可核对 |

全部通过后按 [`生产部署与 Gate OPS 检查清单`](<./生产部署与Gate OPS检查清单.md>) 第 7 节记录脱敏证据（Tag、source Commit、Workflow Run、附件与镜像摘要、验证结果、结论）。

## 11. 更新与回滚

### 11.1 版本更新

1. **本地**：`gh release download <新tag>` 并按第 4.1 节校验六附件。
2. **上传**：把四个归档与 `release-manifest.json` 上传到 `/srv/qianshu-dms/images/<新tag>/` 并复核摘要。
3. **迁移**：按第 7 节经 SSH 隧道执行 `migrate deploy`（新版本含迁移时；先确认快照）。
4. **载入镜像**：`docker load` 两个新镜像，核对 digest。
5. **切换**：编辑 `/srv/qianshu-dms/.env` 的 `QIANSHU_IMAGE_TAG=<新tag>` → `cd /srv/qianshu-dms && sudo docker compose up -d`。
6. **验证**：执行第 10 节中的「健康检查 / 前端 / 登录 / 媒体 / 订单图片」。
7. **记录**：登记新 tag、镜像 digest、时间与结果。

建议在低峰时段执行；更新前确认 `/srv/qianshu-dms/images/` 保留了上一版本的镜像归档，这就是回滚点。

### 11.2 回滚

- **应用**：把 `.env` 的 `QIANSHU_IMAGE_TAG` 改回旧 tag → `sudo docker compose up -d`。旧镜像仍在本地（未执行 `docker image prune`），无需重新上传。
- **前端/后端独立回滚**：两个容器同源于一个 tag；如需只回滚一端，单独改动对应服务再 `up -d`。
- **数据库**：不降级。迁移只向前；若新版本迁移导致不兼容且必须回退，从快照或第 13.2 节的备份恢复到更新前时点，属破坏性操作，必须明确批准后在维护窗口执行。

回滚后同样执行第 10 节验证项，并记录回滚原因与结果。

## 12. 数据安全红线

- **禁止** `docker compose down -v`、`docker volume prune`、`docker system prune --volumes`：数据在宿主绑定目录，但这类命令会删除容器与卷元数据，属于不可逆操作。
- `pgdata` 与 `media` 只能是宿主目录绑定挂载，不得改为匿名卷。
- 容器重建前先做备份（第 13.2 节）；容器删除不影响数据，数据目录删除不可恢复。
- 日志轮转已由 compose 的 `json-file` 上限约束（10 MB × 5），不得关闭。

## 13. 备份与恢复

### 13.1 约定

- 数据库与媒体目录必须记录同一恢复点标识（UTC 时间、数据库备份摘要、媒体备份摘要、release commit），两者不能拼接不同恢复点。
- 业务备份包含数据库与 `assets/`、`trash/`；`staging/` 不作为业务备份。
- 至少保留一份加密的离机备份；密钥不与备份同放。
- 备份成功不能只看退出码：记录文件总数、总字节数、摘要与可读取性验证。

### 13.2 备份步骤

```bash
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_root=/srv/qianshu-dms/backups/$stamp
sudo install -d -o root -g root -m 0700 "$backup_root"

# 数据库（走容器内 pg_dump，凭据不落盘）
cd /srv/qianshu-dms
sudo docker compose exec -T db pg_dump -U <数据库用户名> -d <数据库名> -Fc > "$backup_root/database.dump"

# 媒体（只含 assets 与 trash）
sudo tar -C /srv/qianshu-dms/media -czf "$backup_root/media.tar.gz" assets trash

# 记录恢复点
sudo tee "$backup_root/restore-point.txt" >/dev/null <<EOF
utc=$stamp
release-commit=<source Commit>
database-sha256=$(sha256sum "$backup_root/database.dump" | cut -d' ' -f1)
media-sha256=$(sha256sum "$backup_root/media.tar.gz" | cut -d' ' -f1)
EOF
```

随后把 `$backup_root` 加密并复制到离机位置（云硬盘快照或对象存储），并在记录中确认可读取。

### 13.3 恢复

1. 核对同一恢复点与 release commit，先恢复数据库；
2. 恢复 `assets/` 与 `trash/`（不恢复 `staging/`）；
3. 用 release 镜像运行只读 dry run：

   ```bash
   cd /srv/qianshu-dms
   sudo docker compose run --rm server node dist/commands/media-operations.js recovery-dry-run
   ```

4. 确认 `complete=true` 且 missing、size、checksum、location、orphan 全部为零；
5. 再运行媒体 `health`、`/api/health` 与授权 GET/HEAD Range 验收，最后开放读取。

恢复顺序与判定以 [`媒体存储部署与恢复`](../后端文档/媒体存储部署与恢复.md) 第 8 节为准。

## 14. 常见问题

| 现象 | 可能原因 | 处置 |
| --- | --- | --- |
| `server` 反复重启、日志无堆栈 | 媒体 preflight 失败（目录属主/权限、容量、ffprobe） | `docker compose logs server` 查看 preflight 输出；核对第 5.2 节目录属主 10001 与权限 0750 |
| 日志提示环境变量 | `server.env` 缺项或 HMAC key 不合规 | 对照 6.3 逐项核对后 `docker compose up -d server` |
| 容器起不来，提示 `pg_isready` 超时 | pgdata 属主不是 999 或目录被占用 | 核对第 5.2 节；不要手工 `initdb` |
| `/api/health` 经域名 502 | `server` 未就绪或 nginx 解析到旧地址 | `docker compose ps`、`docker compose logs web`；本配置使用 Docker DNS 运行期解析，重建后会自动恢复 |
| 上传大文件 413 | 请求未走 `/api/` 前缀 | 确认客户端基址为 `/api/`（默认即如此） |
| 登录报来源/CSRF 错误 | `APP_ORIGIN` 与实际域名不符 | 修改 `server.env` 后 `docker compose up -d server` |
| 媒体预览 404/500 | 媒体目录权限或存储状态 | 第 10 节的媒体探针与 `docker compose logs server` |
| `docker load` 后 digest 不一致 | 上传不完整或版本不符 | 重新上传并核对 `SHA256SUMS` |
| 磁盘告警 | 镜像归档、日志、备份堆积 | 清理 `/srv/qianshu-dms/images` 的历史 tag（保留至少上一个版本）、核对日志轮转与备份保留期 |

## 15. 附录

### 15.1 占位符清单

| 占位符 | 说明 |
| --- | --- |
| `<服务器公网IP>` / `<服务器SSH用户>` | 实例地址与管理账号（非 root） |
| `<域名>` | 已备案的业务域名（`APP_ORIGIN` 与证书一致） |
| `<tag>` | 正式 Release 版本号（如 `v0.2.2`） |
| `<数据库名>` / `<数据库用户名>` / `<数据库密码>` | 业务库三元组 |
| `<key1>/<key2>/<key3>` | 三个独立 HMAC 密钥 |
| `<worktree>` | 与 `<tag>` 一致的本地源码目录 |
| `<本地fullchain>` / `<本地privkey>` | 证书文件在本地的路径 |

### 15.2 HMAC 密钥生成

在任意可信机器上生成三个互不相同的密钥（输出只填入 `server.env`，不要写入文档、Issue 或聊天记录）：

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

要求：每个 32 字节、canonical base64url、三者互不相同；production 缺失或不合规会直接拒绝启动。

### 15.3 本地重建镜像（可选）

CI 会在发布流程中构建镜像；如需在本地复现同一镜像（例如排查构建问题），在本地仓库执行（Linux/x64 或支持 `linux/amd64` 模拟的 Docker Desktop）：

```bash
node scripts/release-images.mjs \
  --tag <tag> \
  --platform linux/amd64 \
  --server-archive <release_dir>/qsmds-server-<tag>-linux-x64.tar.gz \
  --web-archive <release_dir>/qsmds-web-<tag>.tar.gz \
  --output <输出目录>
```

产物为两个镜像归档与 `release-images.json`（含镜像 digest）；本地重建的镜像 digest 不承诺与 CI 产物相同，生产部署始终以 Release 附件为准。

### 15.4 真相源索引

- [生产部署与 Gate OPS 检查清单](<./生产部署与Gate OPS检查清单.md>)（安全门禁与部署记录格式）
- [发布与版本管理](<./发布与版本管理.md>)（Tag、六个附件、校验与发布边界）
- [媒体存储部署与恢复](../后端文档/媒体存储部署与恢复.md)（媒体目录、身份、探针、备份与恢复合同）
- 仓库 `deploy/docker/`：`Dockerfile.server`、`Dockerfile.web`、`nginx/qianshu-dms.conf`、`entrypoint/server-entrypoint.sh`、`docker-compose.yml`、`.env.example`、`server.env.example`、`systemd/qianshu-dms-media-cleanup.service` 与 `.timer`
- 仓库 `release/manifest.schema.json`：Release Manifest 的 `images` 字段定义
