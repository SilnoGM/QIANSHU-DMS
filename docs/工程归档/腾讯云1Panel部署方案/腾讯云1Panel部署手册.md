# 千树 DMS 腾讯云 1Panel 部署手册

> [!IMPORTANT]
> 归档提示：本方案已停止执行，仅用于历史追溯，不作为当前部署依据。
> 当前部署方式与操作步骤见 [腾讯云 Docker 部署手册](../../全局文档/腾讯云Docker部署手册.md)；
> 发布与附件口径见 [发布与版本管理](../../全局文档/发布与版本管理.md)。
> 归档背景与结论见 [归档说明](./归档说明.md)。

## 1. 适用范围与已确认决策

本文档描述在腾讯云服务器（北京地域）上，使用 1Panel 将千树 DMS 前端、后端与数据库整体部署上线的完整流程，以及后续更新与回滚方式。

本文是操作手册；生产门禁仍以 [`生产部署与 Gate OPS 检查清单`](<../../全局文档/生产部署与Gate OPS检查清单.md>) 为准，发布身份仍以 [`发布与版本管理`](<../../全局文档/发布与版本管理.md>) 为准。本文不替代两者，也不授权执行其中要求单独审批的操作。

### 1.1 已确认的部署决策

| 决策项 | 结论 |
| --- | --- |
| 总体形态 | 混合：1Panel 负责网站（静态托管、反向代理、TLS 证书）、PostgreSQL、备份与面板观测；Server 按仓库既定 systemd 合同运行在宿主机 |
| 代码上线 | 本地下载并校验 GitHub Release 四附件，经 1Panel 文件管理上传到服务器；服务器不直连 GitHub，不在服务器构建 |
| 数据库 | 1Panel 应用商店安装 PostgreSQL 16（容器方式），业务库与用户通过面板创建 |
| 迁移执行 | 本地通过 SSH 隧道对生产库执行 `prisma migrate deploy`，连接串只出现在本地 |
| 媒体投递 | `MEDIA_CONTENT_DELIVERY_MODE=application`（应用层流式交付，规避 OpenResty 容器的媒体目录挂载与权限对齐） |
| 证书 | 使用已有证书，经 1Panel 证书管理上传，不申请 ACME |
| 初始化数据 | 迁移内置种子自动应用；业务基础数据 seed CLI **待补齐**（独立任务），未就绪前按第 5.5 节手工准备 |
| 维护窗口 | 暂无固定约定；更新与回滚按第 13 节的建议流程执行 |

### 1.2 与既有口径的一处修订

选择 `application` 媒体交付模式后，`生产部署与 Gate OPS 检查清单` 第 6 节 "Reverse proxy" 行的表述 "私有媒体 internal redirect" 需要同步修订为 "私有媒体交付（application 或 internal_redirect，以部署决策为准）"，否则文档间口径矛盾。本文档落地的同时应完成该修订。

### 1.3 版本与界面差异说明

- 1Panel 界面路径基于 v2.x 编写；你的实例审计快照为 v2.2.5。面板升级后菜单名称与位置可能有微调，凡涉及界面路径的步骤，请以实例实际显示为准。
- 涉及 1Panel 能力边界（OpenResty 容器网络模式、容器挂载可编辑性、网站配置文件可编辑范围）的环节，本文均已标注为**实测检查点**，不得凭文档假设跳过验证。
- 1Panel 的站点服务器是容器化的 OpenResty，数据库是容器；宿主机的 Node 24 与 systemd 不由面板管理，两者互不冲突。

## 2. 部署总览

```
                    ┌──────────────── 腾讯云轻量服务器（Ubuntu 24.04）────────────────┐
  用户 ── 443 ──►   │  1Panel OpenResty 容器（网站：静态托管 + /api 反向代理 + TLS）    │
                    │        │                                                        │
                    │        └── /api ──► 127.0.0.1:3000（或网桥网关，见第 10.2 节）   │
                    │                        │                                        │
                    │              宿主 Node 24 + systemd                            │
                    │              /opt/qianshu-dms/server/current ──► releases/<tag> │
                    │              /etc/qianshu-dms/server.env（0600）                │
                    │              /var/lib/qianshu-dms/media（只被 Node 读写）         │
                    │                        │                                        │
                    │                        └── DATABASE_URL ──► PostgreSQL 16 容器  │
                    │                                                127.0.0.1:<端口>  │
                    └────────────────────────────────────────────────────────────────┘
```

宿主机关键路径：

| 路径 | 用途 |
| --- | --- |
| `/opt/qianshu-dms/server/releases/<tag>` | 每个版本的 Server 归档解包目录 |
| `/opt/qianshu-dms/server/current` | 指向当前版本目录的符号链接（回滚点） |
| `/etc/qianshu-dms/server.env` | 生产环境变量（不进 Git，权限 0600） |
| `/var/lib/qianshu-dms/media/{staging,assets,trash}` | 媒体持久目录（0750，`qianshu-dms:qianshu-media`） |
| `/etc/systemd/system/qianshu-dms-*.service/.timer` | 进程与媒体清理定时任务的 systemd 单元 |

## 3. 第 0 步：安全加固前置（未完成前不得继续）

审计快照结论为 `BLOCKED`，且你已确认安全加固尚未完成。本节安排的是**进入部署前必须完成的加固**；执行时严格遵循 [`生产部署与 Gate OPS 检查清单`](<../../全局文档/生产部署与Gate OPS检查清单.md>) 第 4 节的顺序与停止条件（保留第二个管理会话、先建快照、先验证再 reload）。以下只列关键项与完成判据：

1. **云侧入口**：`22/tcp` 只允许管理 CIDR 或 VPN；1Panel 面板端口（当前 28317）从公网收回，改用 SSH 隧道、VPN 或限来源的 HTTPS；`80/443` 在完成第 9–11 节配置（站点、反代、证书）后才开放，配置期间的验证以服务器本机 `curl` 与 SSH 隧道内的浏览器访问为准。腾讯云轻量应用服务器该功能叫"防火墙"（CVM 才叫安全组），按实例类型对应操作。
2. **1Panel 管理面**：操作员在交互界面更换强管理密码；核对面板自身版本与安全公告。
3. **SSH**：公钥认证 + 关闭密码与 root 登录，按检查清单 4.4 的七步顺序执行，`sshd -t` 通过后才 reload，并用第三个新会话验证。
4. **系统补丁**：安装批准的安全更新并按需重启，确认 `systemctl --failed` 为空、无 `reboot-required`。
5. **快照**：变更前创建云硬盘快照，并确认控制台救援终端（VNC）可用——它是唯一的兜底入口。

**完成判据**：检查清单 4.6 的全部检查命令通过，且从独立客户端验证 `22` 仅对批准来源开放、面板端口不可从公网直达。

## 4. 宿主机运行环境准备

操作位置：1Panel → 左侧菜单"终端"，或本地 SSH。以下命令均在服务器上执行。

### 4.1 安装 Node.js 24

systemd 单元使用绝对路径 `/usr/bin/node`，因此不要用 nvm；用 NodeSource 仓库安装（推荐）：

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs
```

**验证**：

```bash
/usr/bin/node -v          # 应输出 >= v24.15.0
which node                # 应输出 /usr/bin/node
```

注意：Release 归档的兼容承诺是 Ubuntu 24.04 + glibc + x64 + Node 24，不要替换为 Node 22 或 26。

### 4.2 安装媒体工具

```bash
sudo apt-get install -y ffmpeg qpdf
```

**验证**：

```bash
/usr/bin/ffprobe -version   # 应打印版本并退出码 0
/usr/bin/qpdf --version
```

两者是媒体能力的生产依赖，缺失会导致启动前的 preflight 失败（VIDEO/PDF 校验能力失败关闭）。

### 4.3 创建系统身份与目录

```bash
sudo groupadd --system qianshu-media
sudo useradd --system --home /opt/qianshu-dms --shell /usr/sbin/nologin qianshu-dms
sudo usermod -aG qianshu-media qianshu-dms

sudo install -d -o qianshu-dms -g qianshu-dms -m 0750 /opt/qianshu-dms/server /opt/qianshu-dms/server/releases
sudo install -d -o root -g qianshu-dms -m 0750 /etc/qianshu-dms

sudo install -d -o qianshu-dms -g qianshu-media -m 0750 /var/lib/qianshu-dms/media
sudo install -d -o qianshu-dms -g qianshu-media -m 0750 /var/lib/qianshu-dms/media/staging
sudo install -d -o qianshu-dms -g qianshu-media -m 0750 /var/lib/qianshu-dms/media/assets
sudo install -d -o qianshu-dms -g qianshu-media -m 0750 /var/lib/qianshu-dms/media/trash
```

**验证**：

```bash
id qianshu-dms
ls -ld /opt/qianshu-dms/server/releases /etc/qianshu-dms /var/lib/qianshu-dms/media
```

## 5. 数据库：1Panel 安装与初始化 PostgreSQL 16

### 5.1 应用商店安装 PostgreSQL

操作位置：1Panel → **应用商店** → 搜索 `PostgreSQL` → 安装。

- 版本选择 **16**（与项目文档口径一致）。若商店列表中无 16，**停止并与我确认**，不要自行选择其他大版本。
- 安装参数需记录（后续填连接串）：
  - 容器名 / 应用名：`<PG应用名>`（面板自动生成，形如 `1Panel-postgresql-xxxx`）
  - 端口：`<PG映射端口>`（面板表单中的端口映射，默认 5432；如与宿主其他服务冲突可改）
  - 密码：`<PG管理员密码>`（面板生成或自定，只记录在密码管理器中，不写入任何文档与脚本）

**验证**：1Panel → 数据库 → PostgreSQL，实例出现在列表中且状态为运行中；1Panel → 容器 中对应容器状态为 running。

### 5.2 确认访问边界

1Panel 官方文档明确：应用商店数据库运行在容器中，宿主机访问使用 `127.0.0.1` + 映射端口。需要确认两点：

1. **不对公网暴露**：云防火墙不放行 `<PG映射端口>`；如面板提供绑定地址设置，确认绑定为 `127.0.0.1` 而非 `0.0.0.0`（1Panel 应用端口配置在 容器 → 应用详情 → 端口 中查看）。
2. **容器日志与设置**：数据库 → PostgreSQL → 设置 中可改端口、查看日志。

**验证**（本地机器，非服务器）：

```bash
nc -vz <服务器公网IP> <PG映射端口>   # 应超时或被拒绝；若能连上则立即回到 5.2 修正
```

### 5.3 创建业务库与用户

操作位置：1Panel → **数据库** → PostgreSQL → "创建数据库"。

- 数据库名：`<数据库名>`（建议 `qianshu_dms`，以你的最终命名为准）
- 用户名：`<数据库用户名>`（不要复用管理员账号）
- 密码：`<数据库密码>`
- 权限/访问权限：允许本地（宿主机）访问

创建后在该库的"权限"中确认 `<数据库用户名>` 对 `<数据库名>` 有全部权限。

**验证**：在服务器宿主上安装 psql 客户端并走宿主机到容器的实际路径连接（这正是 Server 将使用的路径）：

```bash
sudo apt-get install -y postgresql-client
psql -h 127.0.0.1 -p <PG映射端口> -U <数据库用户名> -d <数据库名> -c '\conninfo'
# psql 会交互提示输入 <数据库密码>，密码不进入 shell 历史
```

能打印连接信息即通过（此时库是空的，正常）。

### 5.4 记录连接串

宿主机侧 Server 使用的连接串形态（第 8.1 节填入 `server.env`）：

```
postgresql://<数据库用户名>:<数据库密码>@127.0.0.1:<PG映射端口>/<数据库名>
```

本地迁移（第 7 节）使用同一连接串，但主机改为隧道本地端口。

### 5.5 初始化数据（当前状态）

| 数据类别 | 来源 | 状态 |
| --- | --- | --- |
| 权限点、地区、货币等基础数据 | Prisma 迁移内置种子 | 随第 7 节迁移自动应用 |
| 管理员账号 | `bootstrap-admin` CLI（第 8.5 节） | 已就绪 |
| 编号规则实例、字典条目、汇率、资金类型、用户资金账户等业务基础数据 | seed CLI | **尚未实现（另案补齐）** |

在 seed CLI 就绪前，上线后由管理员账号在系统界面内逐项配置上述业务基础数据；编号规则缺失会直接影响单据创建，建议作为上线当天的第一项工作。seed CLI 完成后的目标形态是"迁移 → seed → bootstrap-admin"三步，本文档将在 seed 就绪后同步更新本节。

## 6. 代码上线：本地校验 + 面板上传

### 6.1 本地下载并校验 Release 附件

在本地机器执行（需已登录 `gh`）：

```bash
release_dir="$(mktemp -d)"
gh release download <tag> --repo SilnoGM/QIANSHU-DMS --dir "$release_dir"
cd "$release_dir"
shasum -a 256 -c SHA256SUMS        # macOS；Linux 用 sha256sum -c
ls -l                              # 应恰好 4 个文件
```

再打开 `release-manifest.json`，核对 tag、source Commit、runtime、OpenAPI 与 migration 摘要。**四个附件中本次上传两个归档**：

- `qsmds-server-<tag>-linux-x64.tar.gz`
- `qsmds-web-<tag>.tar.gz`

### 6.2 上传并解包 Server 归档

操作位置：1Panel → **文件管理**。

1. 进入 `/opt/qianshu-dms/server/releases/`，上传 `qsmds-server-<tag>-linux-x64.tar.gz`。
2. 右键归档 → 解压，得到顶层目录 `qsmds-server-<tag>-linux-x64/`（内含 `dist/`、`node_modules/`、`prisma/`、`deploy/` 等）。
3. 将该目录重命名为 `<tag>`（终端等价命令：`sudo mv qsmds-server-<tag>-linux-x64 <tag>`）。
4. 修正属主：1Panel 终端执行 `sudo chown -R qianshu-dms:qianshu-dms /opt/qianshu-dms/server/releases/<tag>`。

**验证**：

```bash
ls /opt/qianshu-dms/server/releases/<tag>/dist/main.js
ls /opt/qianshu-dms/server/releases/<tag>/deploy/systemd/
ls /opt/qianshu-dms/server/releases/<tag>/prisma/migrations | tail -3
```

### 6.3 切换 current 符号链接

```bash
cd /opt/qianshu-dms/server
sudo ln -sfn releases/<tag> current
ls -l current && ls current/dist/main.js
```

首次部署同样先建立 `current` 链接，再进入第 7 节迁移。**从此刻起，回滚动作就是把这个链接指回旧版本目录。**

## 7. 数据库迁移：本地 SSH 隧道执行

原则：生产库凭据只出现在本地；服务器上不安装 Prisma CLI，不保存连接串。

### 7.1 本地准备与隧道

```bash
# 本地仓库，切到与 Release 相同的源码
git fetch --tags
git switch --detach <tag>
pnpm -C server install --frozen-lockfile

# 建立隧道（保持该终端不关闭）
ssh -N -L 15432:127.0.0.1:<PG映射端口> <服务器SSH用户>@<服务器公网IP>
```

### 7.2 执行迁移

另开一个本地终端：

```bash
cd <本地仓库>/server
DATABASE_URL='postgresql://<数据库用户名>:<数据库密码>@127.0.0.1:15432/<数据库名>' pnpm db:migrate:deploy
```

注意事项：
- 连接串只作为单次命令的环境变量，**不要写入 `.env`、脚本或 shell 历史**（可用 `set +o history` 临时关闭记录）。
- `migrate deploy` 只应用未执行的迁移，可安全重复执行。
- 首次执行前确认第 3 节快照已完成。

### 7.3 验证

```bash
# 再次执行，应输出 "No pending migrations" 或无新迁移
DATABASE_URL='...@127.0.0.1:15432/<数据库名>' pnpm db:migrate:deploy

# 服务器上抽查表结构（走宿主到容器路径）
psql -h 127.0.0.1 -p <PG映射端口> -U <数据库用户名> -d <数据库名> -c '\dt' | head -30
```

确认输出的迁移列表与 `release-manifest.json` 中的 migration 摘要一致后，关闭隧道（Ctrl+C）。

## 8. 后端部署：systemd 与进程管理

### 8.1 编写环境文件

```bash
sudo cp /opt/qianshu-dms/server/current/deploy/environment/server.env.example /etc/qianshu-dms/server.env
sudo chmod 0600 /etc/qianshu-dms/server.env
sudo editor /etc/qianshu-dms/server.env
```

按下表填写（占位符全部替换为真实值；此文件不进 Git、不进日志）：

| 键 | 值 | 说明 |
| --- | --- | --- |
| `NODE_ENV` | `production` | 固定 |
| `PORT` | `3000` | 固定 |
| `DATABASE_URL` | `postgresql://<数据库用户名>:<数据库密码>@127.0.0.1:<PG映射端口>/<数据库名>` | 宿主侧直连容器映射端口 |
| `APP_ORIGIN` | `https://<域名>` | **必须与最终对外域名完全一致**，否则登录被 CSRF 校验拒绝 |
| `TRUST_PROXY_HOPS` | `1` | 只有一层 OpenResty 反代 |
| `AUTH_USERNAME_HMAC_KEY` | `<key1>` | 32-byte base64url，生成方式见附录 14.2 |
| `AUTH_USER_ID_HMAC_KEY` | `<key2>` | 同上，三者必须互不相同 |
| `AUTH_IP_HMAC_KEY` | `<key3>` | 同上 |
| `MEDIA_STORAGE_DRIVER` | `local` | 固定 |
| `MEDIA_STORAGE_ROOT` | `/var/lib/qianshu-dms/media` | 固定 |
| `MEDIA_CONTENT_DELIVERY_MODE` | `application` | 本次决策；切换为 `internal_redirect` 需先完成第 10.5 节的挂载与权限 |
| `MEDIA_STAGING_TTL_HOURS` | `24` | 保持默认 |
| `MEDIA_TRASH_RETENTION_DAYS` | `7` | 保持默认 |
| `MEDIA_FFPROBE_PATH` | `/usr/bin/ffprobe` | 与 4.2 节一致 |
| `MEDIA_QPDF_PATH` | `/usr/bin/qpdf` | 与 4.2 节一致 |

**验证**：

```bash
sudo stat -c '%a %U:%G' /etc/qianshu-dms/server.env   # 应输出 600 root:root
```

### 8.2 安装 systemd 单元

```bash
sudo install -o root -g root -m 0644 /opt/qianshu-dms/server/current/deploy/systemd/qianshu-dms-server.service /etc/systemd/system/qianshu-dms-server.service
sudo install -o root -g root -m 0644 /opt/qianshu-dms/server/current/deploy/systemd/qianshu-dms-media-cleanup.service /etc/systemd/system/qianshu-dms-media-cleanup.service
sudo install -o root -g root -m 0644 /opt/qianshu-dms/server/current/deploy/systemd/qianshu-dms-media-cleanup.timer /etc/systemd/system/qianshu-dms-media-cleanup.timer
sudo systemctl daemon-reload
```

**验证**：

```bash
sudo systemd-analyze verify /etc/systemd/system/qianshu-dms-server.service /etc/systemd/system/qianshu-dms-media-cleanup.service /etc/systemd/system/qianshu-dms-media-cleanup.timer
```

无输出即通过。

### 8.3 启动 Server 并验证

```bash
sudo systemctl enable --now qianshu-dms-server
sudo systemctl status qianshu-dms-server --no-pager
```

该单元启动前会先执行媒体 preflight（`ExecStartPre`：`media-operations.js preflight`）。若 preflight 失败，Server 不会启动——按第 4.2/4.3 节检查 `ffprobe`、媒体目录属主与权限。

**验证**：

```bash
curl -sS http://127.0.0.1:3000/api/health          # 期望 200 且 JSON 内 database 状态为 up
sudo journalctl -u qianshu-dms-server -n 50 --no-pager   # 无异常堆栈
sudo ss -lntp | grep 3000                          # 只应看到 127.0.0.1:3000
```

### 8.4 启用媒体清理定时任务

```bash
sudo systemctl enable --now qianshu-dms-media-cleanup.timer
systemctl list-timers qianshu-dms-media-cleanup.timer
```

**验证**：下次触发时间显示为整点后一小时内的某一时刻。

### 8.5 创建管理员账号

该命令是交互式的，必须在真实终端（TTY）中执行，密码由操作员当场输入，不进入脚本与日志：

```bash
sudo -u qianshu-dms /usr/bin/node /opt/qianshu-dms/server/current/dist/cli/auth-admin/bootstrap-admin.js
```

**验证**：命令成功退出；待第 12 节端到端验证时用该账号登录。

## 9. 前端托管：1Panel 网站（静态）

### 9.1 创建静态网站

操作位置：1Panel → **网站** → 网站 → "创建网站" → 类型选 **静态网站**。

- 主域名：`<域名>`
- 其余参数（网站目录、分组）保持默认；**记录面板显示的网站目录实际路径**（形如 `/www/sites/<别名>/index` 或面板自定义的存储位置，以实例为准）。
- 暂不在创建向导里申请证书（证书在第 11 节上传已有证书）。

**实测检查点**：若创建向导强制要求选择证书或端口，记录下来并在第 11 节统一处理。

### 9.2 上传并放置前端产物

操作位置：1Panel → **文件管理**。

1. 上传 `qsmds-web-<tag>.tar.gz` 到站点目录的上级（如 `/tmp`），解压。
2. 归档顶层目录 `qsmds-web-<tag>/` 内直接是 `index.html`、`assets/` 等；将**内部内容**移动到网站根目录（覆盖面板生成的默认 `index.html`）。
3. 保留一份归档与解压目录在 `/opt/qianshu-dms/web-releases/<tag>/`，作为前端回滚点（面板站点目录只放当前版本）。

**验证**：

```bash
ls <网站根目录>/index.html && ls <网站根目录>/assets | head
curl -sS http://127.0.0.1/ -o /dev/null -w '%{http_code}\n'   # 服务器本机访问站点，期望 200
```

若此时 80 端口尚未对公网开放，浏览器验证留到第 12 节统一进行（可先用 SSH 隧道转发 80 端口在本地浏览器查看）。

## 10. 反向代理：/api 转发到后端

### 10.1 添加反向代理

操作位置：1Panel → **网站** → `<站点>` → **反向代理** → 添加。

- 名称：`api`
- 代理路径：`/api`
- 目标地址：`http://127.0.0.1:3000`（**先按此填写，然后执行 10.2 的连通性验证，按结果修正**）

### 10.2 容器到宿主机的连通性（实测检查点，必做）

1Panel 的 OpenResty 运行在容器中，能否访问宿主 `127.0.0.1:3000` 取决于其网络模式：

```bash
# 查看 OpenResty 容器网络模式（容器名在 1Panel → 容器 中查看）
docker inspect <OpenResty容器名> --format '{{.HostConfig.NetworkMode}}'

# 情况 A：输出 host  → 127.0.0.1:3000 可直接使用
# 情况 B：输出 bridge → 127.0.0.1 指向容器自身，需要网桥网关地址：
docker network inspect $(docker inspect <OpenResty容器名> --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}') --format '{{(index .IPAM.Config 0).Gateway}}'
```

**注意**：Server 的生产合同是只监听 `127.0.0.1:3000`。若为情况 B，有两种做法，二选一并与我确认后再改：

- **B1（推荐）**：将 OpenResty 容器切换为 host 网络（在 1Panel 容器设置中修改，属于面板能力需实测；切换后 `127.0.0.1:3000` 直通，Server 合同不变）。
- **B2**：让 Server 监听附加内网地址（例如 Docker 网桥网关侧的宿主地址），同时用云防火墙与宿主防火墙双重确认 3000 不从公网可达。这会放宽 loopback 合同，需在部署记录中说明。

无论哪种情况，完成后在服务器上验证：

```bash
# 情况 A 验证
curl -sS http://127.0.0.1:3000/api/health
# 情况 B 验证（以网桥网关地址为例）
docker exec <OpenResty容器名> curl -sS http://<网关IP>:3000/api/health
```

以容器内 curl 返回 200 为准，而不是只验证宿主机 curl。

### 10.3 上传大小与请求缓冲

媒体上传（单文件上限 500 MiB）必须放开 Nginx 侧限制，否则大文件会得到 413。**两种方式二选一，不要重复添加 `location`**：

**方式一（沿用面板的反向代理功能）**：编辑刚创建的 `api` 反代条目，在其自定义配置入口补充下面两行（不同 1Panel 版本入口名称可能不同，以实例为准）：

```nginx
client_max_body_size 501m;
proxy_request_buffering off;
```

**方式二（直接写网站配置文件）**：在 网站 → 配置文件 中把 10.1 的反代替换为完整片段：

```nginx
location ^~ /api/ {
    client_max_body_size 501m;
    proxy_request_buffering off;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_pass http://127.0.0.1:3000;
}
```

注意：
- 1Panel 会解析并管理网站配置；保存后应重新打开配置文件确认内容保留，并用 1Panel 的 OpenResty 重载功能生效。若保存被拒绝或重载后丢失，属**实测检查点**，记录实际表现再调整方案。
- `application` 交付模式下媒体字节经反代流出，关注 `proxy_read_timeout` 即可；默认值对持续传输没有问题，仅当客户端长时间无数据交互时才可能触发。
- 本次不需要 `X-Accel-Redirect` 的 internal location（`application` 模式不产生该跳转）。若未来切换 `internal_redirect`，见 10.5。

### 10.4 验证

```bash
# 服务器上
curl -sS http://127.0.0.1/ -o /dev/null -w '%{http_code}\n'            # 静态页 200
curl -sS http://127.0.0.1/api/health                                   # 经反代返回健康 JSON
# 本地机器
curl -sS http://<服务器公网IP>/api/health
```

### 10.5 （备选）未来切换 internal_redirect 的前置条件

仅当决定切换媒体交付模式时执行，三件事缺一不可：

1. 给 OpenResty 容器增加挂载 `/var/lib/qianshu-dms/media:/var/lib/qianshu-dms/media:ro`（1Panel 容器参数是否可编辑属实测检查点）；
2. 解决容器内 worker 用户对 `0750 qianshu-dms:qianshu-media` 目录的读权限（gid 对齐或经评估后调整目录权限，注意这会放宽媒体文档的最小权限设计）；
3. 在站点配置中加入 `/_qianshu_internal_media/` 的 internal location 片段（内容取自 `server/deploy/nginx/qianshu-dms-media.conf`），并确认面板保存后不被覆盖。

同时把 `server.env` 的 `MEDIA_CONTENT_DELIVERY_MODE` 改回 `internal_redirect` 并重启 Server。

## 11. HTTPS 证书与强制跳转

### 11.1 上传已有证书

操作位置：1Panel → **证书** → 证书 → "上传证书"。

- 证书名称：`<证书名>`
- 公钥：`fullchain.pem` 内容（含中间证书链）
- 私钥：`privkey.pem` 内容
- 不选自动续签（证书来源与续期在证书签发侧管理；到期前重新上传替换即可）

**验证**：证书列表中该证书状态正常，可见到期时间。

### 11.2 站点启用 HTTPS

操作位置：1Panel → **网站** → `<站点>` → **HTTPS**。

1. 启用 HTTPS，选择刚上传的证书。
2. 开启"强制 HTTPS"（HTTP 自动 301 跳转到 HTTPS）。
3. 如面板提供 TLS 版本/加密套件配置，保持默认（TLS 1.2+ 即可）。

**验证**（本地机器，不使用 `-k`）：

```bash
curl -sSI https://<域名>/ | head -5
curl -sSI http://<域名>/ | head -3        # 应返回 301 到 https
openssl s_client -connect <域名>:443 -servername <域名> </dev/null 2>/dev/null | openssl x509 -noout -dates -subject
```

### 11.3 校准 APP_ORIGIN

打开站点页面尝试登录。若被拒绝且后端日志出现来源校验类错误，检查：

1. `/etc/qianshu-dms/server.env` 的 `APP_ORIGIN` 是否为 `https://<域名>`（协议、域名、无多余斜杠）；
2. `TRUST_PROXY_HOPS` 是否为 `1`；
3. 修改后 `sudo systemctl restart qianshu-dms-server`。

## 12. 上线验证清单

按顺序执行，每项记录结果（脱敏）：

| 项目 | 方法 | 期望 |
| --- | --- | --- |
| 进程 | `systemctl status qianshu-dms-server --no-pager` | active (running)，无重启循环 |
| 健康检查 | `curl -sS https://<域名>/api/health` | 200，database up |
| 监听面 | `sudo ss -lntp` | 3000 仅 loopback；`<PG映射端口>` 仅 127.0.0.1 |
| 前端 | 浏览器访问 `https://<域名>` | 登录页正常，静态资源全部 200 |
| 登录 | 用 bootstrap 管理员登录 | 成功，刷新后会话保持 |
| 权限 | 用低权限角色登录（如已配置） | 菜单与接口按权限收敛 |
| 媒体 | 上传一张图片并预览 | 上传成功、预览正常（application 模式） |
| 视频（可选） | 上传一个 MP4 并拖动进度 | 分片请求 206 正常 |
| 迁移状态 | 第 7.3 节重复执行 | No pending migrations |
| 定时任务 | `systemctl list-timers qianshu-dms-media-cleanup.timer` | 已排程 |
| 媒体清理自检 | `sudo -u qianshu-dms /usr/bin/node /opt/qianshu-dms/server/current/dist/commands/media-operations.js health` | 能力检查全部通过 |
| 备份 | 1Panel → 数据库 → 备份 创建一次备份；云控制台确认快照策略 | 备份文件可下载，快照在保留期内 |
| 日志 | `sudo journalctl -u qianshu-dms-server --since "30 min ago"` | 无错误级别异常 |

全部通过后，按 [`生产部署与 Gate OPS 检查清单`](<../../全局文档/生产部署与Gate OPS检查清单.md>) 第 7 节记录本次部署的脱敏证据（Tag、source Commit、Workflow Run、附件摘要、验证结果、结论）。

## 13. 更新与回滚

### 13.1 版本更新流程

1. **本地**：`gh release download <新tag>` 并按 6.1 节校验四附件。
2. **数据库**：按第 7 节通过 SSH 隧道执行 `migrate deploy`（新版本若含迁移；只向前，先确认快照）。
3. **后端**：上传并解包 server 归档到 `releases/<新tag>` → 修正属主 → `sudo ln -sfn releases/<新tag> /opt/qianshu-dms/server/current` → `sudo systemctl restart qianshu-dms-server`。
4. **前端**：上传 web 归档解压到 `/opt/qianshu-dms/web-releases/<新tag>/` → 用文件管理将站点根目录内容替换为新版本（先保留旧内容目录）。
5. **验证**：执行第 12 节清单中"健康检查 / 前端 / 登录 / 媒体"四项。
6. **记录**：登记新 tag、时间、结果。

建议在低峰时段执行；更新前确认上一版本的 `releases/` 目录与 `web-releases/` 目录完整保留，这就是回滚点。

### 13.2 回滚流程

- **后端**：`sudo ln -sfn releases/<旧tag> /opt/qianshu-dms/server/current && sudo systemctl restart qianshu-dms-server`
- **前端**：把站点根目录内容替换回 `web-releases/<旧tag>/`
- **数据库**：不降级。迁移只向前；若新版本迁移导致不兼容且必须回退，从云硬盘快照或 pg_dump 备份恢复数据库到更新前时点，属于破坏性操作，必须经你明确批准后在维护窗口执行。

回滚后同样执行第 12 节的验证项，并记录回滚原因与结果。

## 14. 附录

### 14.1 占位符清单（部署前逐项备齐）

| 占位符 | 说明 | 出现位置 |
| --- | --- | --- |
| `<服务器公网IP>` | 实例公网地址 | 隧道、本地验证 |
| `<服务器SSH用户>` | 管理账号（非 root） | 隧道、终端 |
| `<域名>` | 已备案的业务域名 | APP_ORIGIN、站点、证书 |
| `<tag>` | 正式 Release 版本号（如 v0.2.0） | 全流程 |
| `<PG应用名>` | 1Panel 中的 PostgreSQL 应用名 | 数据库操作 |
| `<PG映射端口>` | PostgreSQL 容器映射到宿主的端口 | 连接串、隧道、防火墙 |
| `<数据库名>` / `<数据库用户名>` / `<数据库密码>` | 业务库三元组 | 连接串 |
| `<PG管理员密码>` | 面板初始管理员密码 | 仅密码管理器 |
| `<key1>/<key2>/<key3>` | 三个 HMAC 密钥 | server.env |
| `<证书名>` | 上传证书的名称 | 证书管理 |
| `<OpenResty容器名>` | 面板自动生成 | 网络排查 |
| `<网站根目录>` | 面板显示的实际路径 | 前端托管 |

### 14.2 HMAC 密钥生成

在任意可信机器上生成三个互不相同的密钥（**每次生成的输出只填入 `server.env`，不要写入文档、Issue 或聊天记录**）：

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

要求：每个 32 字节、canonical base64url、三者互不相同；production 缺失或不合规会直接拒绝启动。

### 14.3 常见问题对照

| 现象 | 可能原因 | 处置 |
| --- | --- | --- |
| 启动失败，无堆栈 | media preflight 失败（ffprobe/目录权限/容量） | `journalctl -u qianshu-dms-server` 查看 preflight 输出；核对 4.2/4.3 |
| 启动失败，日志提示环境变量 | `server.env` 缺项或 HMAC key 不合规 | 对照 8.1 表逐项核对 |
| `/api/health` 连不上 | 反代地址错（容器网络模式） | 执行 10.2 连通性验证 |
| 上传大文件 413 | Nginx 未放开 body 限制 | 执行 10.3 |
| 登录报来源/CSRF 错误 | `APP_ORIGIN` 与实际域名不符 | 执行 11.3 |
| 媒体预览 404/500 | 媒体目录权限或存储状态 | `media-operations.js health` 与 `journalctl` |
| 页面空白但静态 200 | 前端产物未覆盖默认 index.html | 检查站点根目录 index.html 是否为归档内容 |

### 14.4 真相源索引

- [生产部署与 Gate OPS 检查清单](<../../全局文档/生产部署与Gate OPS检查清单.md>)（安全门禁与部署记录格式）
- [发布与版本管理](<../../全局文档/发布与版本管理.md>)（Tag、附件、校验与发布边界）
- [媒体存储部署与恢复](<../../后端文档/媒体存储部署与恢复.md>)（媒体目录、身份、探针与清理合同）
- `server/deploy/systemd/`、`server/deploy/environment/server.env.example`（systemd 与环境变量模板）
- `server/deploy/nginx/qianshu-dms-media.conf`（仅供未来切换 `internal_redirect` 时参考）
