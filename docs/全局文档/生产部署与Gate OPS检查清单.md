# 千树 DMS 生产部署与 Gate OPS 检查清单

## 1. 目的与状态

本文定义千树 DMS 首次生产部署及后续版本部署前的宿主机安全、运行依赖、备份恢复和放量门禁。GitHub Release 成功只证明发布附件已生成并通过对应 Workflow；它不能替代本文的生产环境审计，也不授权执行 production migration、部署、重启或流量切换。

截至 `2026-08-17`，生产候选服务器的只读审计结论为 **`BLOCKED`**，不得部署真实业务数据或恢复生产流量。该结论基于当时的服务器状态；端口、补丁、账户、服务和云平台策略都可能变化，每次部署前必须重新取得实时证据，不能直接复用本次记录。

本文不保存公网 IP、域名、密码、Cookie、token、连接字符串、密码 Hash、SSH 公钥正文或云平台凭据。审计证据如需留档，只记录脱敏后的命令、时间、结果和审批人。

## 2. Gate 等级与停止条件

| 等级 | 含义 | 处理要求 |
| --- | --- | --- |
| `P0-SECURITY` | 可能导致管理凭据泄露、未授权远程访问或已知高风险漏洞暴露 | 立即停止部署；完成整改和独立复验前不得放量 |
| `P0-READY` | 缺少应用运行、数据恢复或可回滚所需的硬性条件 | 保持 `BLOCKED`；补齐后重新执行完整 Gate OPS |
| `P1` | 不一定立即造成入侵，但会降低可观测性、容量余量或故障恢复能力 | 首次放量前完成，或取得明确的限期风险接受记录 |
| `P2` | 优化项或长期治理项 | 进入运维待办并保留负责人和完成期限 |

出现以下任一情况必须立即停止：

- SSH 第二个独立管理会话无法登录或无法执行预期 `sudo`。
- `sshd -t`、防火墙校验、TLS 校验、备份恢复校验或健康检查失败。
- 目标端口、云安全组、域名、Release Tag、source Commit、附件摘要或数据库身份不明确。
- 命令要求输入或回显密码、token、连接字符串等敏感值。
- 发现未审批的账户、authorized key、监听端口、systemd unit、Docker object 或外部转发。
- 生产 migration 缺少独立审批、执行前备份或只向前恢复方案。

## 3. 2026-08-17 生产候选服务器审计快照

### 3.1 正常基线

- Ubuntu `24.04.4 LTS`、x86_64、kernel `6.8.0-124-generic`。
- 2 vCPU、约 3.6 GiB RAM、约 1.9 GiB swap。
- 单块约 50 GiB ext4 系统盘，审计时约 40.9 GiB 可用，inode 使用率正常。
- systemd 状态为 `running`，失败 unit 数为 `0`。
- AppArmor 已启用；Chrony 正常，NTP 已同步，时区为 `Asia/Shanghai`。
- unattended-upgrades、APT upgrade timer、持久化 journald 和 logrotate timer 已启用。
- Docker 已运行，但没有 container、image 或 volume。
- 云厂商 `lighthouse` 账户已锁定，无 SSH key，且不属于 `sudo`、`adm` 或 `docker` 组。

### 3.2 `P0-SECURITY` 阻断项

1. 1Panel `v2.2.5 stable` 监听 `0.0.0.0:28317`。从审计客户端可通过公网 TCP 到达，HTTP 返回 `200 OK`，HTTPS 握手失败；因此当时的管理入口是公网可达的纯 HTTP。
2. SSH 有效配置包含 `PermitRootLogin yes`、`PasswordAuthentication yes` 和 `X11Forwarding yes`。root 存在 authorized key，启动后的日志记录到 3 次 root 公钥成功登录。
3. root 的 shadow 值被脱敏验证为结构异常的 `sha512crypt`；ubuntu 使用弱 `md5crypt`。异常字符串不是合格的账户锁定方式，弱 Hash 也不能作为生产认证基线。
4. ubuntu 拥有重复的 `NOPASSWD: ALL` 规则；Fail2ban 与 UFW 未启用，guest firewall 未形成明确的默认拒绝基线。
5. 启动约 1 小时内记录到 4 次失败密码认证和 3 个无效用户名尝试。该现象与常见公网扫描一致，但本记录不据此断言攻击者身份。
6. APT 缓存显示 160 个可更新包，其中 120 个为安全更新；模拟升级结果为 147 个升级、4 个暂不升级。

### 3.3 `P0-READY` 阻断项

- 未安装 Node.js `^24.15.0`、PostgreSQL 16、Nginx/OpenResty、`ffprobe` 和 `qpdf`。
- 未创建 `qianshu-dms` 用户、`qianshu-media` 组、`/opt/qianshu-dms`、`/etc/qianshu-dms`、`/var/lib/qianshu-dms/media` 或项目 systemd units。
- 只有单块系统盘；云硬盘快照、PostgreSQL 恢复、媒体恢复和异机备份尚无验收证据。
- 公网 `80/443` 在审计客户端完成 TCP 握手，但 guest OS 没有对应监听；HTTP 返回空响应，HTTPS 握手异常。云安全组、NAT、负载均衡或防护设备的真实入口尚未核清。

上述数字和版本只代表该次审计快照，不是后续部署的默认值。

## 4. P0 安全加固实施顺序

P0 加固涉及云安全组、SSH、账户、软件升级和重启，必须单独审批并在维护窗口执行。不得改变以下顺序，也不得在没有第二个有效管理会话时 reload SSH 或启用默认拒绝防火墙。

### 4.1 建立回退入口

1. 创建并记录云硬盘快照，确认快照属于正确实例和磁盘。
2. 验证腾讯云控制台救援终端或 VNC 可用，不把当前 SSH 会话视为唯一回退路径。
3. 脱敏核对 ubuntu 的 authorized key 数量、fingerprint、owner 和 mode；不输出公钥正文。
4. 保持当前会话，新开第二个独立 ubuntu 公钥会话，验证可执行预期 `sudo`。
5. 记录当前 SSH、1Panel、网络和 systemd 状态，以便失败时对照恢复。

### 4.2 收紧云侧与宿主机入口

云安全组至少满足：

- `22/tcp` 只允许已批准的固定管理 CIDR 或 VPN。
- `28317/tcp` 不对公网开放；如临时保留，只允许固定管理 CIDR，并且不得继续使用纯 HTTP 输入凭据。
- `80/tcp` 与 `443/tcp` 只在正式入口、域名和 TLS 配置验收后开放。
- Server `3000/tcp` 只监听 loopback，由反向代理访问。
- PostgreSQL `5432/tcp` 只允许本机或明确批准的私网来源。

guest firewall 必须形成与云安全组一致的默认拒绝策略。启用前先审计 1Panel、Docker 和 nftables/iptables 的规则关系，验证 Docker 发布端口不会绕过预期策略。任何来源不明的 `80/443` 外部握手都必须在继续部署前解释并关闭或纳入正式拓扑。

### 4.3 保护 1Panel 管理面

- 优先关闭公网 `28317`，改用内网、VPN、SSH tunnel 或受控 HTTPS 反向代理。
- 如保留浏览器访问，必须使用与正式管理域名匹配、能被客户端正常验证的 TLS 证书；禁止用 `curl -k` 或浏览器忽略证书告警作为验收。
- 限制管理入口来源，并按当前版本能力启用 MFA、安全入口和登录告警。
- 操作员亲自在交互界面更换强管理密码；密码不得出现在 argv、脚本、文档或日志中。
- 部署前联网核对当前 1Panel 版本、安全公告和升级说明，不根据本次快照推断 `v2.2.5` 仍是最新版本。

### 4.4 SSH 与账户加固

先通过受控配置管理创建独立 SSH drop-in，目标有效配置至少为：

```text
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
X11Forwarding no
MaxAuthTries 3
AllowUsers ubuntu
```

执行顺序：

1. 保持原会话和已验证的第二个 ubuntu 公钥会话。
2. 运行 `sudo sshd -t`；任何输出或非零退出都停止。
3. 使用 `sudo sshd -T` 核对最终有效值，确认没有后置 `Match` 或 cloud-init 配置重新放宽认证。
4. 只执行 `sudo systemctl reload ssh`，不直接 restart。
5. 新建第三个 SSH 会话，验证 ubuntu 公钥登录和 `sudo`。
6. 验证 root 登录及密码登录均被拒绝后，才结束旧会话。
7. 操作员在交互式终端中显式锁定 root 密码；ubuntu 如需保留控制台密码，由操作员亲自设置强密码，否则在公钥和救援入口验证后锁定。
8. 定位并收敛重复的 `NOPASSWD: ALL` 来源，保留一份经过审批的最小管理策略。

Fail2ban 不是关闭密码认证和限制安全组来源的替代品。若 SSH 已严格限制为可信来源和公钥认证，可把 Fail2ban 纳入 P1；否则必须在首次公网运行前启用等价的速率限制和告警。

### 4.5 安装安全更新

1. 再次确认快照、救援入口和维护窗口。
2. 刷新 APT 索引并保存脱敏的待升级数量和安全更新数量。
3. 安装全部批准的安全更新，逐项处理 held back package；不得静默忽略失败。
4. 按更新要求重启服务器。
5. 复核运行 kernel、`reboot-required`、SSH、1Panel、网络、时间同步和 systemd 状态。
6. 若仍存在安全更新、失败 unit 或需要再次重启，保持 `BLOCKED`。

### 4.6 P0 安全验收

以下命令只展示检查形态；执行时使用批准的目标变量，不把凭据写入环境变量：

```bash
sudo sshd -t
sudo sshd -T | grep -E '^(permitrootlogin|passwordauthentication|kbdinteractiveauthentication|pubkeyauthentication|x11forwarding|maxauthtries|allowusers) '
sudo ss -lntup
sudo nft list ruleset
systemctl is-system-running
systemctl --failed --no-pager
test ! -e /var/run/reboot-required
/usr/lib/update-notifier/apt-check 2>&1
```

还必须从独立客户端验证：

- `22/tcp` 只对批准的管理来源开放。
- root SSH 和密码认证被拒绝；ubuntu 公钥登录及 `sudo` 正常。
- `28317/tcp` 已关闭公网入口，或只通过可验证的 HTTPS/受控隧道访问。
- `3000/tcp`、`5432/tcp` 不可从公网访问。
- 所有测试使用正常证书验证，不绕过 TLS 告警。

## 5. P1 与容量、审计、备份门禁

- 评估是否启用 `auditd`；启用前定义规则、磁盘上限、保留期和告警，避免无界日志占满系统盘。
- 保持持久化 journald 和 logrotate，并为 SSH、sudo、1Panel、PostgreSQL、Server 与媒体清理失败建立外部告警。
- 2 vCPU、约 3.6 GiB RAM 是 Node.js、PostgreSQL、反向代理和 1Panel 共机的最低规格候选，首次放量前必须完成同规格容量验证。
- 单块约 50 GiB 系统盘在预计 10 GiB 产品媒体规模下可作为初期候选，但数据库、日志、Release 暂存和本机备份不得无界增长；设置空间与 inode 告警，并保留安全清理和扩容方案。
- 生产备份必须离开应用数据所在故障域。至少验证 PostgreSQL 备份恢复、媒体文件与数据库引用一致性、配置恢复和云快照回滚，不能只证明备份任务“成功”。
- 对云安全组、NAT、负载均衡、域名、证书、DDoS/WAF 和外部监控保存平台侧证据；guest OS 输出不能代替云平台状态。

## 6. 应用部署准备门禁

安全 P0 通过后，再准备应用运行环境：

| 项目 | 要求 |
| --- | --- |
| OS/runtime | Ubuntu 24.04、glibc、x64、Node.js `^24.15.0` |
| Database | PostgreSQL 16；生产库身份、备份和只向前 migration 已审批 |
| Seed | 首次部署按 `pnpm -C server db:migrate:deploy` → `auth:bootstrap-admin` → `seed:run --apply` 顺序执行；`seed:run` 默认只预览，幂等且不覆盖已有记录，摘要含非空 `conflicts` 时停止并人工处理 |
| Reverse proxy | Nginx/OpenResty 提供可信 TLS、Web 静态资源、`/api` 代理和私有媒体交付（`application` 或 `internal_redirect`，与部署决策记录一致） |
| Media tools | `/usr/bin/ffprobe` 与 `/usr/bin/qpdf` 可执行且版本已记录 |
| Identities | `qianshu-dms` 用户、`qianshu-media` 组及最小权限目录已创建 |
| Storage | `/var/lib/qianshu-dms/media` 在 release、源码和系统临时目录之外，权限和容量满足 preflight |
| Service | 使用仓库 systemd unit，Server 只监听 `127.0.0.1:3000`，媒体清理 timer 已验收 |
| Release | 从可信 GitHub Release 下载，`SHA256SUMS`、Manifest、Tag、Commit 和双端归档一致 |
| Configuration | `/etc/qianshu-dms/server.env` 不进入 Git，权限最小，production 必填项通过启动前校验 |

生产部署文件真相源：

- [`qianshu-dms-server.service`](../../server/deploy/systemd/qianshu-dms-server.service)
- [`qianshu-dms-media-cleanup.service`](../../server/deploy/systemd/qianshu-dms-media-cleanup.service)
- [`qianshu-dms-media-cleanup.timer`](../../server/deploy/systemd/qianshu-dms-media-cleanup.timer)
- [`qianshu-dms-media.conf`](../../server/deploy/nginx/qianshu-dms-media.conf)
- [`server.env.example`](../../server/deploy/environment/server.env.example)
- [`媒体存储部署与恢复`](../后端文档/媒体存储部署与恢复.md)
- [`发布与版本管理`](./发布与版本管理.md)

如果使用正式 Server Release 归档，pnpm 不是 `dist/main.js` 的运行时依赖；若选择在生产机安装、构建或执行需要 pnpm 的维护流程，则必须使用仓库声明的 pnpm `11.9.0`，并重新审查构建工具留在生产机上的必要性。

## 7. Gate OPS 最终记录

每次部署至少保存以下脱敏记录：

| 字段 | 要求 |
| --- | --- |
| 审计时间 | 明确时区和开始/结束时间 |
| Operator/Approver | 记录人员或受控系统身份，不记录凭据 |
| Target | 使用内部环境标识，不在公开文档记录公网 IP |
| Release identity | Tag、source Commit、Workflow Run、Manifest 与附件摘要 |
| Security evidence | SSH 有效配置、云/guest firewall、监听端口、TLS、补丁和账户核对结果 |
| Recovery evidence | 快照、数据库恢复、媒体恢复和回滚演练结果 |
| Deployment evidence | migration、seed 摘要（含 `conflicts` 处置结果）、systemd、health、login、权限和媒体 smoke |
| Decision | `PASS`、`BLOCKED` 或限期风险接受；风险接受不能覆盖 `P0` |

只有所有 `P0-SECURITY`、`P0-READY` 和首次放量前要求的 `P1` 都取得当前证据，才允许将 Gate OPS 标记为 `PASS`。部署完成后仍需保留观察窗口；出现认证、数据库、媒体、容量或错误率异常时停止放量并执行已批准的回滚方案。
