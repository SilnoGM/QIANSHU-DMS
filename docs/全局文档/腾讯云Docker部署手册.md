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
| 媒体投递 | `MEDIA_CONTENT_DELIVERY_MODE=application`（应用层流式交付；内部重定向见第 9.1 节的前置条件，仅 `local` 驱动可用） |
| 媒体存储 | `MEDIA_STORAGE_DRIVER=local`（媒体在宿主目录）；可选 `cos`（`assets/`、`trash/` 在腾讯云对象存储，`staging` 仍在本地），切换流程见第 11.3 节 |
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

> **命令约定**：`/srv/qianshu-dms` 及其子目录为 `root:root 0750`，非 root 管理账号**不能直接 `cd` 进入**——`cd /srv/qianshu-dms && sudo docker compose …` 会在 `cd` 处报 `Permission denied`（`sudo` 只作用于 `&&` 之后的命令）。因此：本文涉及的 `docker compose <子命令>` 统一按 `sudo docker compose -f /srv/qianshu-dms/docker-compose.yml <子命令>` 执行（`-f` 形式无需 `cd`，`env_file` 与相对路径卷按 compose 文件所在目录解析）；其余需要在该目录内执行的命令使用 `sudo bash -c 'cd … && …'` 或绝对路径。

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

把四个归档、`release-manifest.json` 与 `SHA256SUMS`（共六个文件）上传到服务器 `/srv/qianshu-dms/images/<tag>/`（`scp`/`rsync` 均可；服务器不直连 GitHub）：

```bash
ssh <服务器SSH用户>@<服务器公网IP> 'sudo install -d -o root -g root -m 0750 /srv/qianshu-dms/images/<tag>'
scp ./qsmds-*-<tag>*.tar.gz ./release-manifest.json ./SHA256SUMS <服务器SSH用户>@<服务器公网IP>:/tmp/
ssh <服务器SSH用户>@<服务器公网IP> 'sudo mv /tmp/qsmds-*-<tag>*.tar.gz /tmp/release-manifest.json /tmp/SHA256SUMS /srv/qianshu-dms/images/<tag>/'
```

在服务器上复核摘要（逐行核对，应 5/5 全部 `OK`；出现 `FAILED open or read` 通常是漏传了某个归档）：

```bash
sudo bash -c "cd /srv/qianshu-dms/images/<tag> && sha256sum -c SHA256SUMS"
```

### 4.3 载入镜像并核对 digest

```bash
# 该目录为 root:root 0750：用绝对路径（或 sudo bash -c 'cd …'），不要直接 cd
sudo docker load -i /srv/qianshu-dms/images/<tag>/qsmds-server-image-<tag>-linux-x64.tar.gz
sudo docker load -i /srv/qianshu-dms/images/<tag>/qsmds-web-image-<tag>-linux-x64.tar.gz

# 内容判据（跨镜像存储一致）：tar 内嵌的 Config digest 必须等于 Manifest 记录值
for image in server web; do
  digest=$(sudo tar -xzOf "/srv/qianshu-dms/images/<tag>/qsmds-${image}-image-<tag>-linux-x64.tar.gz" manifest.json \
    | grep -o '"Config":"[^"]*"' | cut -d'"' -f4 | grep -oE '[0-9a-f]{64}')
  echo "${image}: sha256:${digest}"
done
# 与 release-manifest.json 的 images.server.digest / images.web.digest 逐项比对
```

镜像内容以 **tar 内嵌的 Config digest** 为判据：它与 `release-manifest.json` 的 `images.*.digest` 在经典 overlayfs 与 containerd 两种镜像存储下都成立（已在 v0.2.3 附件上实测）。`docker image inspect --format '{{.Id}}'` 的取值随镜像存储后端变化（containerd 存储返回 manifest digest，经典存储返回 config digest），**只作参考、不作判据**：

```bash
sudo docker image inspect --format '{{.Id}}' qsmds-server:<tag>   # 参考值，可能不等于 images.*.digest
```

Config digest 与 Manifest 记录值不一致时停止部署并重新上传。`SHA256SUMS` 对 tar 本身的校验（第 4.1 节）继续作为入口完整性依据；`docker load` 失败或加载出错误的 RepoTags 同样停止部署。

## 5. 宿主机准备

### 5.1 校验 Docker 与 Compose

```bash
docker version --format '{{.Server.Version}}'
docker compose version
```

要求 Docker 引擎可用、`docker compose` v2 子命令存在、`docker buildx` 可用（镜像只加载不构建，但保留校验入口）。缺失时先安装并重新执行第 3 节的门禁检查。

**配置镜像加速（国内地域必须）**：服务器直连 Docker Hub（`registry-1.docker.io`）会超时，第 7 节启动 db 时无法拉取 `postgres:16`。先配置（腾讯云轻量/CVM 内网可直接使用该源；备选 `https://docker.m.daocloud.io`；已有 `daemon.json` 时合并 `registry-mirrors` 键，不要整文件覆盖）：

```bash
sudo install -d -o root -g root -m 0755 /etc/docker
sudo tee /etc/docker/daemon.json >/dev/null <<'JSON'
{
  "registry-mirrors": ["https://mirror.ccs.tencentyun.com"]
}
JSON
sudo systemctl restart docker
systemctl is-active docker
```

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
- `MEDIA_STORAGE_DRIVER=cos` 时本地媒体目录只承担 staging 与内容校验源，`assets/`、`trash/` 会是空目录但仍必须存在且权限正确（staging 写入与容量检查仍走这里）。
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
| `MEDIA_CONTENT_DELIVERY_MODE` | `application` | 本次决策；`cos` 驱动下只能取该值 |
| `MEDIA_FFPROBE_PATH` / `MEDIA_QPDF_PATH` | `/usr/bin/ffprobe` / `/usr/bin/qpdf` | 镜像内已安装 |
| `MEDIA_STORAGE_DRIVER` | `local`（默认）或 `cos` | `cos` 表示 `assets/`、`trash/` 存在腾讯云桶里；切换必须先迁移存量（见第 11.3 节） |
| `MEDIA_COS_REGION` / `MEDIA_COS_BUCKET` | `ap-beijing` / `<bucket>-<appid>` | 桶与服务器必须同地域；桶权限私有读写 |
| `MEDIA_COS_SECRET_ID` / `MEDIA_COS_SECRET_KEY` | `<sub-account-secret-id>` / `<sub-account-secret-key>` | 只授权该桶的 CAM 子账号密钥；只写在 `server.env`（0600），不进 Git、不进工单、不进聊天记录 |

**验证**：

```bash
sudo stat -c '%a %U:%G' /srv/qianshu-dms/.env /srv/qianshu-dms/server.env   # 应输出 600 root:root
```

## 7. 数据库迁移：本地 SSH 隧道执行

数据库此前为空库，迁移在建库后、启动 Server 前执行一次；更新版本时同样先迁移、后换镜像。

### 7.1 启动 db 容器（建库）

先启动 db 服务：首次启动会从镜像加速源拉取 `postgres:16`（执行前确认第 5.1 节镜像加速已配置）并完成空库初始化（库名/用户/口令来自 `.env`）。

```bash
sudo docker compose -f /srv/qianshu-dms/docker-compose.yml up -d db
# 等到 (healthy)
sudo docker compose -f /srv/qianshu-dms/docker-compose.yml ps
# 取 db 容器在 compose 网络中的地址（下一步的隧道目标）
docker inspect --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' $(sudo docker compose -f /srv/qianshu-dms/docker-compose.yml ps -q db)
```

### 7.2 本地准备与隧道

compose 未把 5432 发布到宿主机，隧道必须指向 db 容器的 compose 网络地址：

```bash
# 本地仓库，切到与 Release 相同的源码
git fetch --tags
git switch --detach <tag>
pnpm -C server install --frozen-lockfile

# 隧道：<db容器IP> 来自 7.1 的 docker inspect 输出
ssh -N -L 15432:<db容器IP>:5432 <服务器SSH用户>@<服务器公网IP>
```

### 7.3 执行迁移

```bash
cd <本地仓库>/server
DATABASE_URL='postgresql://<数据库用户名>:<数据库密码>@127.0.0.1:15432/<数据库名>' pnpm db:migrate:deploy
```

注意事项：连接串只作为单次命令的环境变量，不写入 `.env`、脚本或 shell 历史（可用 `set +o history`）；`migrate deploy` 只应用未执行的迁移，可安全重复执行；首次执行前确认第 3 节的快照已完成。

### 7.4 验证

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
sudo docker compose -f /srv/qianshu-dms/docker-compose.yml up -d
sudo docker compose -f /srv/qianshu-dms/docker-compose.yml ps
```

`db` 先经过 healthcheck（`pg_isready`），`server` 才会启动；`server` 启动前会执行媒体 preflight（见 entrypoint），任一能力不满足都会导致容器重启循环。

**验证**：

```bash
sudo docker compose -f /srv/qianshu-dms/docker-compose.yml logs --tail=50 server      # 无环境校验或 preflight 失败
sudo docker compose -f /srv/qianshu-dms/docker-compose.yml exec -T server curl -fsS http://127.0.0.1:3000/api/health
sudo ss -lntp | grep -E ':(80|443|3000|5432)\b'   # 只应看到 80/443（docker-proxy），不应出现 3000/5432
```

### 8.2 创建管理员账号

该命令是交互式的，必须在真实终端执行（`-it`），密码由操作员当场输入：

```bash
# 注意：不要写成 cd /srv/qianshu-dms && sudo docker compose …（该目录 0750，cd 会 Permission denied）
sudo docker compose -f /srv/qianshu-dms/docker-compose.yml run --rm server node dist/cli/auth-admin/bootstrap-admin.js
```

### 8.3 初始化基础数据

```bash
sudo docker compose -f /srv/qianshu-dms/docker-compose.yml run --rm server node dist/cli/seed/seed-run.js            # 默认只预览
sudo docker compose -f /srv/qianshu-dms/docker-compose.yml run --rm server node dist/cli/seed/seed-run.js --apply    # 确认后写入
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

登录被拒绝且 `server` 日志出现来源校验类错误时，核对 `APP_ORIGIN` 与 `TRUST_PROXY_HOPS`，改完执行 `sudo docker compose -f /srv/qianshu-dms/docker-compose.yml up -d server`。

### 9.1 （备选）未来切换 internal_redirect 的前置条件

本形态下 web 容器可控，切换 `internal_redirect` 需要同时做三件事：给 `web` 容器增加媒体目录只读挂载、解决容器内 nginx worker 对 `0750 10001:10001` 目录的读权限、把 `server/deploy/nginx/qianshu-dms-media.conf` 的 internal location 片段并入站点配置；随后把 `MEDIA_CONTENT_DELIVERY_MODE` 改为 `internal_redirect` 并重建 `web` 与 `server`。未经实测不要切换。**该模式只在 `MEDIA_STORAGE_DRIVER=local` 下成立**：`cos` 驱动没有本地媒体目录可供 Nginx 直读，配置里两者并存会被启动校验直接拒绝。

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
| 媒体存储（`cos` 驱动时） | 第 11.3 节第 6 步的 `recovery-dry-run` | `complete=true` 且全部 mismatch 为 0 |
| 迁移状态 | 第 7.4 节重复执行 | No pending migrations |
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
5. **切换**：编辑 `/srv/qianshu-dms/.env` 的 `QIANSHU_IMAGE_TAG=<新tag>` → `sudo docker compose -f /srv/qianshu-dms/docker-compose.yml up -d`。
6. **验证**：执行第 10 节中的「健康检查 / 前端 / 登录 / 媒体 / 订单图片」。
7. **记录**：登记新 tag、镜像 digest、时间与结果。

建议在低峰时段执行；更新前确认 `/srv/qianshu-dms/images/` 保留了上一版本的镜像归档，这就是回滚点。

### 11.2 回滚

- **应用**：把 `.env` 的 `QIANSHU_IMAGE_TAG` 改回旧 tag → `sudo docker compose -f /srv/qianshu-dms/docker-compose.yml up -d`。旧镜像仍在本地（未执行 `docker image prune`），无需重新上传。
- **前端/后端独立回滚**：两个容器同源于一个 tag；如需只回滚一端，单独改动对应服务再 `up -d`。
- **数据库**：不降级。迁移只向前；若新版本迁移导致不兼容且必须回退，从快照或第 13.2 节的备份恢复到更新前时点，属破坏性操作，必须明确批准后在维护窗口执行。

回滚后同样执行第 10 节验证项，并记录回滚原因与结果。

### 11.3 切换媒体存储到 COS

默认形态是 `MEDIA_STORAGE_DRIVER=local`（媒体在 `/srv/qianshu-dms/media`）。切换到腾讯云对象存储时按下列顺序执行，语义细节以 [`媒体存储部署与恢复`](../后端文档/媒体存储部署与恢复.md) 第 8.2 节为准：

1. **准备**：确认桶已创建（同地域、私有读写）、CAM 子账号只授权该桶，并把 `MEDIA_COS_REGION`、`MEDIA_COS_BUCKET`、`MEDIA_COS_SECRET_ID`、`MEDIA_COS_SECRET_KEY` 写入 `/srv/qianshu-dms/server.env`（0600）。此时先**不要**改 `MEDIA_STORAGE_DRIVER`。
2. **备份（同一恢复点）**：执行第 13.2 节，记录数据库与媒体的摘要、UTC 时间与 release commit。
3. **停写**：`sudo docker compose -f /srv/qianshu-dms/docker-compose.yml stop server`，此后不接受新上传。
4. **预览**：
   ```bash
   sudo docker compose -f /srv/qianshu-dms/docker-compose.yml run --rm \
     -e MEDIA_STORAGE_DRIVER=cos server node dist/commands/media-migration.js preview
   ```
   输出 `scanned`、`skipped` 计数；桶不可达会直接失败退出。
5. **搬运**：同一条命令把 `preview` 换成 `apply`。命令逐个对象复制并校验，任一失败即退出非零、本地文件保持原样、可安全重跑；**它不写数据库**（`media_assets.storage_driver` 记录"物化时的驱动"且被不可变触发器保护），切换只由 `server.env` 的配置决定。
6. **对账**：把 `server.env` 的 `MEDIA_STORAGE_DRIVER` 改为 `cos`，然后
   `sudo docker compose -f /srv/qianshu-dms/docker-compose.yml run --rm server node dist/commands/media-operations.js recovery-dry-run`，
   要求 `complete=true` 且全部 mismatch 为 0。
7. **启动与验收**：`sudo docker compose -f /srv/qianshu-dms/docker-compose.yml up -d server`，执行第 10 节的「健康检查 / 媒体 / 订单图片」以及媒体 `health`（应报告 `read`、`write`、`video_validator` 全 up）。切换前建议先在本地 checkout 跑一次 `pnpm -C server build && pnpm -C server media:accept:cos`（真实桶往返验收，只留一个临时对象并自行清理）。**切换后必须真正上传一张图片**：切换前若未应用"放松驱动枚举"的数据库迁移（`20261007120000_media_storage_driver_cos_allowed`），新上传会在写库时被拒绝并返回 500。
8. **保留回滚面**：`/srv/qianshu-dms/media/{assets,trash}` 在确认稳定前不得删除；回滚只需把 `MEDIA_STORAGE_DRIVER` 改回 `local` 再 `up -d server`（**不要**改写 `storage_driver` 列，它受不可变触发器保护且不参与运行期分派）。

注意：`cos` 驱动下 `read` 探针走桶探针，桶不可达时容器仍会启动（`preflight` 只拦 `local` 的读取故障），但 `health` 会持续以非零退出码告警——这是刻意设计，不要据此放宽告警。

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
sudo docker compose -f /srv/qianshu-dms/docker-compose.yml exec -T db pg_dump -U <数据库用户名> -d <数据库名> -Fc > "$backup_root/database.dump"

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

`MEDIA_STORAGE_DRIVER=cos` 时媒体备份来自桶而不是本地目录，两者不可混用：

- 桶开启版本控制时，记录 `utc=$stamp` 对应的恢复点时间即可按版本回溯；对外导出时用
  `assets/`、`trash/` 前缀同步到离机桶并记录同步完成时间与对象数。
- 数据库备份与媒体备份必须来自同一恢复点；只备份数据库、只依赖对象存储多副本都不满足合同。
- 本节的 `tar` 步骤在 `cos` 下只对空的本地 `assets/`、`trash/` 生效，不得据此声称媒体已备份。

### 13.3 恢复

1. 核对同一恢复点与 release commit，先恢复数据库；
2. 恢复 `assets/` 与 `trash/`（不恢复 `staging/`）；
3. 用 release 镜像运行只读 dry run：

   ```bash
   sudo docker compose -f /srv/qianshu-dms/docker-compose.yml run --rm server node dist/commands/media-operations.js recovery-dry-run
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
| `cos` 驱动下 Server 启动即失败，日志含环境校验 | `MEDIA_COS_*` 缺项、格式不合规，或同时配置了 `internal_redirect` | 对照 6.3 节补齐键值；`cos` 的投递模式必须是 `application` |
| `cos` 驱动下 `health` 退出非零但服务仍在运行 | 桶不可达、凭据无权限或桶不可写（`read`/`write` 探针失败） | 运行媒体 `health` 查看能力码；核对 CAM 策略、桶名与地域；这是刻意允许的降级启动，不要放宽告警 |
| 迁移命令报 `status: failed` | 未启用 `cos` 驱动配置、桶不可达或凭据缺失 | 确认 `MEDIA_COS_*` 已写入 `server.env` 并用 `-e MEDIA_STORAGE_DRIVER=cos` 运行；命令输出不含底层细节，细节看对象存储侧审计 |
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
| `<bucket>-<appid>` | COS 存储桶名（含 APPID 后缀），如 `dms-qs-media-1396967080` |
| `<sub-account-secret-id>` / `<sub-account-secret-key>` | 只授权单个桶的 CAM 子账号 API 密钥；只写入 `server.env`，不进入文档、工单或聊天记录 |

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
