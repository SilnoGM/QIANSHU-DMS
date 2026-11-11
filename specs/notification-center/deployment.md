# 千树小助理部署清单

## 文档信息

| 项目 | 内容 |
| --- | --- |
| 文档状态 | 部署清单，随阶段 1 实施更新 |
| 关联文档 | [落地设计](./design.md)、[数据模型](./data-model.md)、[运维手册](./runbook.md) |
| 适用环境 | 测试环境、生产环境 |
| 最后更新 | 2026-11-06 |

## 1. 前置条件

- [ ] 数据库 schema、15 个权限码、公共 API 范围已获授权。
- [ ] 公司号已实名并养号 3~5 天；昵称与头像为「千树小助理」。
- [ ] 公司号已加入内部财务群、运营群，群已保存到通讯录。
- [ ] 测试员工已添加公司号为好友。
- [ ] `ASSISTANT_GEWE_TOKEN` 已放入部署环境或密钥服务，未进入任何仓库文件。
- [ ] 发布分支、回滚镜像、数据库备份已完成。

## 2. 环境变量

| 变量 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- |
| `ASSISTANT_GEWE_BASE_URL` | 是 | `https://api.geweapi.com` | 只允许 HTTPS |
| `ASSISTANT_GEWE_TOKEN` | 是 | — | 只从环境或密钥服务读取 |
| `ASSISTANT_WORKER_ENABLED` | 否 | `true` | 进程内派发开关 |
| `ASSISTANT_WORKER_POLL_MS` | 否 | `5000` | 轮询间隔 |
| `ASSISTANT_WORKER_BATCH` | 否 | `20` | 单轮领取上限 |
| `ASSISTANT_REQUEST_TIMEOUT_MS` | 否 | `10000` | GeWe 请求超时 |
| `ASSISTANT_MIN_SEND_INTERVAL_MS` | 否 | `3000` | 所有 sendText 的全局最小间隔；`0` 仅用于本地关闭节流 |
| `NOTIFICATION_INTERNAL_API_ENABLED` | 否 | `false` | 内部 HTTP 发布入口，阶段 1 关闭 |
| `NOTIFICATION_INTERNAL_TOKEN` | 否 | — | 内部入口令牌；关闭时不使用 |
| `ASSISTANT_CALLBACK_SECRET` | 否 | — | 阶段 1 不配置，回调引入后再加 |

硬性要求：

- Token 不得写入源码、示例、测试、文档、镜像层、CI 变量日志。
- 日志、错误响应、OpenAPI 快照不得出现 Token 或 Authorization 头。
- 生产 Base URL 只允许 `https://api.geweapi.com`；出站请求校验 host，拒绝私网、回环、保留地址与重定向。
- 渠道启停由数据库 `notification_channel_settings` 管理，不使用进程级 `ASSISTANT_ENABLED`，避免双开关冲突。

## 3. 构建与迁移

### 3.1 构建

```bash
pnpm contract:sync
pnpm contract:check
pnpm -C server check
pnpm -C web check
pnpm build
```

若本地 pnpm 的依赖校验导致 `contract:sync` 失败，按仓库既有方式设置 `pnpm_config_verify_deps_before_run=false` 后重试；不要手工修改 `openapi.json` 或生成类型。

### 3.2 迁移

```bash
# DATABASE_URL 由部署环境提供，不要写入仓库
pnpm -C server db:migrate:deploy
pnpm -C server exec prisma migrate status
```

迁移包含：

1. 通知/渠道枚举与 11 张表。
2. CHECK、部分唯一索引、普通索引。
3. `notification_settings`、`notification_channel_settings`（仅 `ASSISTANT`）、`assistant_dispatch_leases`、`assistant_send_gates` 种子。
4. 15 个权限码与 `system_admin` 授权。
5. `AuditEventType` 新增值。

迁移后核对：

```sql
-- 参数绑定执行；不要在脚本里拼接值
SELECT COUNT(*) FROM notification_channel_settings WHERE channel = 'ASSISTANT';
SELECT COUNT(*) FROM assistant_dispatch_leases WHERE id = 'assistant-dispatch';
SELECT COUNT(*) FROM assistant_send_gates WHERE id = 'assistant-send';
SELECT COUNT(*) FROM permissions WHERE code LIKE 'assistant-%' OR code LIKE 'notification-%';
```

预期：`ASSISTANT` 渠道 1 行且 `enabled = false`；派发租约 1 行；发送闸门 1 行；权限 15 行。

## 4. 管理端初始化

1. 管理员登录，打开「通知中心 > 千树小助理 > 渠道」。
2. 确认 Base URL 为 HTTPS、Token 显示「已配置」，打开渠道开关前的最后一步先做自检。
3. 在 GeWe 控制台确认公司号节点在线，复制 `appId` 与 `wxid`；在「公司号 > 导入公司号」填入，确认状态 `ONLINE` 且「启用派发」开启。系统不提供扫码登录、重连或退出。
4. 「渠道 > 测试」向公司号自己的文件传输助手发一条测试消息，不打扰员工。
5. 「群目标 > 同步群」：同步财务群、运营群，设置 key 与用途，勾选 `internalOnly`。
6. 「通知规则」：确认 3 个事件的模板与策略已存在；`ASSISTANT` 与 `IN_APP` 可同时启用，站内策略的 `targetMode` 不能是 `GROUP`，TTL 与静默时段必须为空。
7. 「员工绑定」：为审核人完成绑定 → 测试消息 → 已验证；为测试员工完成同样流程。
8. 确认未验证绑定数为 0、失效绑定数为 0。

## 5. 冒烟测试

按顺序执行，全部通过才恢复正式通知：

| 步骤 | 操作 | 预期 |
| --- | --- | --- |
| 1 | 渠道自检 | 公司号自己的文件传输助手收到测试消息 |
| 2 | 群通知 | 在测试环境完成一个对账批次或货件到仓，财务群/运营群收到消息，记录 `ACCEPTED` |
| 3 | 1:1 通知 | 用测试员工触发采购审核事件，员工收到消息，记录 `ACCEPTED` |
| 4 | 未验证绑定 | 新建一个未验证绑定，触发敏感事件 | 该交付落 `SKIPPED`，原因 `NOT_BOUND` 或未验证 |
| 5 | 停发 | 关闭渠道，再触发一个事件 | 不发送；交付不派发，按 TTL 过期 |
| 6 | 恢复 | 打开渠道，触发测试群消息 | 正常发送 |
| 7 | 离线 | 在 GeWe 控制台将节点下线，再点系统「检查状态」 | 状态显示 `OFFLINE`，队列按 TTL 处理 |
| 8 | 恢复 | 在 GeWe 控制台重新登录节点，再点系统「检查状态」 | 状态恢复 `ONLINE`，自检消息成功 |

注意：步骤 2/3 必须在测试环境或测试数据上执行，不要用生产员工做冒烟。

## 6. 监控与告警

日志字段：`requestId`、`notificationId`、`deliveryId`、`appId`、`eventType`、`attempt`、`ret`、`durationMs`；不记录正文与 Token。

计数器：

- `notification_publish_total{event_type,channel,result}`
- `assistant_delivery_total{status,failure_code}`
- `assistant_account_status{status}`
- `notification_inbox_unread{scope=self}`
- `notification_inbox_list_latency_ms{scope=self}`
- `notification_inbox_new_batch{scope=self}`

告警：

| 条件 | 级别 | 处置 |
| --- | --- | --- |
| 公司号离线 > 10 分钟 | P1 | 按运维手册第 4 节 |
| 15 分钟失败率 > 20% | P1 | 按运维手册第 9.4 节 |
| 最老 `PENDING` > 10 分钟 | P2 | 检查租约、账号、GeWe 状态 |
| 租约空窗 > 1 分钟 | P2 | 检查 worker 开关与进程 |
| Token 无效/配置缺失 | P1 | 更新 Token 并重启 |
| 未验证绑定 > 0 | P3 | 通知管理员补验证 |

## 7. 回滚

1. **先停发**：关闭 `notification_channel_settings.enabled`，避免回滚期间继续发送。
2. 回滚 Server/Web 镜像到上一版本。
3. 数据表是纯新增，不需要删除；保留表与数据以便再次上线。
4. 权限与审计枚举是新增，不影响旧代码；不要执行 `DROP` 或删除权限行。
5. 如需修迁移，按仓库规范做向前修复，不回滚已应用的迁移历史。
6. 确认旧版本不再启动派发循环；若旧版本没有该功能，无需处理。
7. 回滚完成后记录时间、原因、影响范围与未发送通知。

## 8. 安全验收

- [ ] 生产只走 HTTPS；Base URL host 白名单生效。
- [ ] 出站请求拒绝私网、回环、保留地址与重定向。
- [ ] Token 只存在于环境/密钥服务；日志、错误、OpenAPI 中无 Token。
- [ ] 15 个权限码均为 `system_only`，仅 `system_admin` 持有。
- [ ] 管理端不返回完整 `wxid`、Token。
- [ ] 敏感内容只对 3 个事件开启；1:1 只发已验证绑定；群只发 `internalOnly`。
- [ ] 阶段 1 没有回调路由，公网没有新增入口。
- [ ] 审计记录渠道、账号、绑定、模板、策略、停发、重试操作。
- [ ] 数据库迁移与权限变更有备份和评审记录。

## 9. 上线后观察

- 首 24 小时每 4 小时检查：账号在线、失败率、队列、未验证绑定。
- 首周每天检查一次；月末对账高峰前提前检查账号与群成员。
- 记录首次真实通知的接收情况；如有人未收到，先查绑定与好友关系，再查发送记录。
- 不把「接口返回 200」当成「员工已收到」；页面文案统一写「已接受」。

## 10. 阶段 3 站内通知

### 10.1 迁移与种子核对

本阶段迁移为 `20261108100000_notification_inbox_items` 与 `20261108110000_notification_inbox_business_links`。部署后先确认结构、种子和业务详情链接，再做策略配置：

```sql
SELECT to_regclass('public.notification_inbox_items') IS NOT NULL AS inbox_table_exists;

SELECT channel, enabled
FROM notification_channel_settings
WHERE channel = 'IN_APP';

SELECT key, enabled
FROM notification_templates
WHERE channel = 'IN_APP'
ORDER BY key;

SELECT key, link_url_template
FROM notification_templates
WHERE channel = 'IN_APP'
ORDER BY key;
```

预期：表存在；`IN_APP` 渠道 1 行且 `enabled = true`；三个模板 `invoice.review.pending`、`purchase.review.pending`、`shipment.arrived` 均启用，并分别带 `invoiceRequestId`/`orderId` 业务详情链接。

迁移只插入渠道配置和模板，不插入事件策略。策略必须按环境显式配置；`IN_APP` 策略不能使用 `GROUP`，`ttl_seconds` 与 `quiet_hours` 必须为空。

### 10.2 测试环境策略

测试环境按以下口径配置：采购审核、开票审核固定发给系统管理员角色；货件到仓沿用命令目标（`purchase-orders:read`）。执行前确认 `roles.code = 'system_admin'` 存在：

```sql
BEGIN;

INSERT INTO notification_channel_policies (
    event_type, channel, target_mode, target_config, template_key,
    priority, ttl_seconds, quiet_hours, allow_sensitive, enabled, version
)
VALUES
    (
        'PURCHASE_REVIEW_PENDING', 'IN_APP', 'ROLE',
        '{"roleCodes":["system_admin"]}'::jsonb, 'purchase.review.pending',
        'HIGH', NULL, NULL, true, true, 1
    ),
    (
        'INVOICE_REQUEST_REVIEW_PENDING', 'IN_APP', 'ROLE',
        '{"roleCodes":["system_admin"]}'::jsonb, 'invoice.review.pending',
        'HIGH', NULL, NULL, true, true, 1
    ),
    (
        'SHIPMENT_ARRIVED', 'IN_APP', 'COMMAND_TARGET',
        '{}'::jsonb, 'shipment.arrived',
        'NORMAL', NULL, NULL, true, true, 1
    )
ON CONFLICT (event_type, channel) DO UPDATE SET
    target_mode = EXCLUDED.target_mode,
    target_config = EXCLUDED.target_config,
    template_key = EXCLUDED.template_key,
    priority = EXCLUDED.priority,
    ttl_seconds = NULL,
    quiet_hours = NULL,
    allow_sensitive = EXCLUDED.allow_sensitive,
    enabled = true,
    version = notification_channel_policies.version + 1,
    updated_at = CURRENT_TIMESTAMP;

COMMIT;
```

核对：

```sql
SELECT event_type, channel, target_mode, target_config, template_key,
       priority, ttl_seconds, quiet_hours, allow_sensitive, enabled
FROM notification_channel_policies
WHERE channel = 'IN_APP'
ORDER BY event_type;
```

预期：三条 `IN_APP` 策略；采购/开票为 `ROLE`，货件到仓为 `COMMAND_TARGET`；`ttl_seconds` 与 `quiet_hours` 为空；`allow_sensitive = true`，站内模板才能展示客户名与金额。

说明：

- 使用角色而不是用户 UUID，避免测试库换管理员后策略失效；`system_admin` 是当前超级管理员角色码。
- `SHIPMENT_ARRIVED` 的事件目标本身是 `purchase-orders:read`，因此 `COMMAND_TARGET` 与命令目标一致。
- 若测试环境决定只让某个测试账号收采购/开票通知，把 `target_mode` 改为 `USERS`，并在 `target_config` 写 `{"userIds":["<测试用户 UUID>"]}`；不要把真实用户 UUID 写进仓库。
- 该 SQL 只改 `IN_APP`，不会覆盖已有的 `ASSISTANT` 策略。

### 10.3 保留期清理定时

清理命令：

```bash
pnpm -C server notifications:cleanup
```

Docker 部署等价命令：

```bash
sudo docker compose -f /srv/qianshu-dms/docker-compose.yml \
  run --rm server node dist/commands/notification-operations.js cleanup
```

命令输出一行 JSON，包含 `kind=notification_cleanup`、四类删除计数和 `timeBudgetReached`。命令自带 60 秒预算、每批 500 条；未归档站内条目保留 180 天，已归档保留 365 天；站外交付按 `notification_settings.deliveryRetentionDays`，逻辑通知仅在没有任何站内条目和交付时删除。

建议每日低峰执行一次。仓库已提供与媒体清理相同形态的宿主 systemd 资产：

- [`qianshu-dms-notification-cleanup.service`](../../deploy/docker/systemd/qianshu-dms-notification-cleanup.service)
- [`qianshu-dms-notification-cleanup.timer`](../../deploy/docker/systemd/qianshu-dms-notification-cleanup.timer)

以下为文件内容；安装命令见本节末尾。

```ini
[Unit]
Description=Qianshu DMS Notification Retention Cleanup (Docker)
After=docker.service network-online.target
Requires=docker.service
Wants=network-online.target

[Service]
Type=oneshot
# 与媒体清理相同的宿主 oneshot 形态；命令自带 60 秒预算与分批删除。
WorkingDirectory=/srv/qianshu-dms
ExecStart=/usr/bin/docker compose -f /srv/qianshu-dms/docker-compose.yml run --rm server node dist/commands/notification-operations.js cleanup
TimeoutStartSec=120s
```

```ini
[Unit]
Description=Run Qianshu DMS Notification Retention Cleanup Daily (Docker)

[Timer]
OnCalendar=*-*-* 03:20:00
AccuracySec=1m
Persistent=true
Unit=qianshu-dms-notification-cleanup.service

[Install]
WantedBy=timers.target
```

安装、静态校验并启用：

```bash
sudo install -o root -g root -m 0644 \
  <worktree>/deploy/docker/systemd/qianshu-dms-notification-cleanup.service \
  <worktree>/deploy/docker/systemd/qianshu-dms-notification-cleanup.timer \
  /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemd-analyze verify \
  /etc/systemd/system/qianshu-dms-notification-cleanup.service \
  /etc/systemd/system/qianshu-dms-notification-cleanup.timer
sudo systemctl enable --now qianshu-dms-notification-cleanup.timer
systemctl list-timers qianshu-dms-notification-cleanup.timer
```

安装后必须做一次手工运行并检查退出码：

```bash
sudo systemctl start qianshu-dms-notification-cleanup.service
sudo systemctl status qianshu-dms-notification-cleanup.service --no-pager
sudo journalctl -u qianshu-dms-notification-cleanup.service --since today
```

该命令当前没有数据库 advisory lock，部署时必须保证只有一个调度器运行；不要同时在两个主机或两个 timer 上启用。仓库资产尚未在测试机安装，也没有执行 `systemd-analyze verify`。

### 10.3.1 业务扫描定时

扫描命令：

```bash
pnpm -C server notifications:scan
pnpm -C server notifications:scan --dry-run
```

Docker 部署等价命令：

```bash
sudo docker compose -f /srv/qianshu-dms/docker-compose.yml \
  run --rm server node dist/commands/notification-scan.js
```

命令只在上海时间 `09:00–22:00` 内执行；窗口外输出 `skipped/outside_window` 并成功退出。扫描范围：

- 静态节点剩余 7 天、1 天到期提醒，并补发最近 7 天内已过期节点
- 采购应付日汇总
- 包装待付款日汇总

命令使用数据库 advisory lock，防止多个 timer 或人工重跑重复发布；同一节点按 `节点 + 到期日 + 阈值` 去重，日汇总按上海日期去重。

仓库资产：

- [`qianshu-dms-notification-scan.service`](../../deploy/docker/systemd/qianshu-dms-notification-scan.service)
- [`qianshu-dms-notification-scan.timer`](../../deploy/docker/systemd/qianshu-dms-notification-scan.timer)

安装、静态校验并启用：

```bash
sudo install -o root -g root -m 0644 \
  <worktree>/deploy/docker/systemd/qianshu-dms-notification-scan.service \
  <worktree>/deploy/docker/systemd/qianshu-dms-notification-scan.timer \
  /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemd-analyze verify \
  /etc/systemd/system/qianshu-dms-notification-scan.service \
  /etc/systemd/system/qianshu-dms-notification-scan.timer
sudo systemctl enable --now qianshu-dms-notification-scan.timer
systemctl list-timers qianshu-dms-notification-scan.timer
```

首次启用前先手工做一次 dry-run：

```bash
sudo docker compose -f /srv/qianshu-dms/docker-compose.yml \
  run --rm server node dist/commands/notification-scan.js --dry-run
```

定时器按上海时间 `09:05/13:05/17:05/21:05` 运行。`Persistent=true` 可能在主机夜间恢复时补跑，命令自身的时间守卫会拒绝窗口外执行。

### 10.4 告警阈值

站内指标目前以结构化日志输出（`kind=metric`），没有额外的 Prometheus exporter；若日志平台未接入，以下阈值只能作为巡检口径，不能宣称自动告警已生效。

| 指标 | 建议阈值 | 级别 | 处置 |
| --- | --- | --- | --- |
| `notification_inbox_unread` | 单用户连续 15 分钟 `> 50` | P3 | 检查该用户是否长期未读；确认不是批量事件误发 |
| `notification_inbox_list_latency_ms` | 15 分钟 p95 `> 500ms` | P2 | 检查 `notification_inbox_items` 索引、数据库负载与分页大小 |
| `notification_inbox_new_batch` | 单次 `> 20` 且连续 5 分钟出现 | P2 | 检查是否事件风暴、重复发布或模板/策略误配 |
| 清理命令 | 退出码非 0 或 `timeBudgetReached=true` 连续两次 | P2 | 检查数据库连接、锁等待与保留期；必要时拆分执行窗口 |
| `notification_publish_total{result="FAILED"}` | 15 分钟失败率 `> 5%` | P2 | 检查模板变量、收件人解析与数据库错误 |
| `assistant_delivery_total{status="FAILED"}` | 15 分钟失败率 `> 20%` | P1 | 按运维手册第 9.4 节处理 |

阈值是测试环境起点，正式环境按实际用户量、轮询频率和日志平台能力调整；不要在没有指标采集的情况下把表格当成已配置告警。

### 10.5 冒烟与浏览器验收

1. 三个事件各触发一次，确认目标用户收到站内条目，其他用户不可见。
2. 未读数、标记已读、全部已读、归档、取消归档、详情正文与业务域筛选正确。
3. 顶栏铃铛显示未读数；点击「查看全部」进入 `/notifications`。
4. 桌面通知开关：授予权限后显示测试通知；页面隐藏时新消息弹系统通知；点击通知跳到详情；页面可见时不弹。
5. 两个标签页同时打开时，Web Locks 只让一个标签页轮询和弹通知；另一个只同步未读数。
6. 浏览器用例入口：`QIANSHU_BROWSER_AUTH_SHARD=2/2 pnpm ci:browser-auth-e2e`。用例使用测试进程内改写的 `newItems` 游标模拟隐藏页新消息，不修改数据库。
7. 停止轮询：退出登录或会话返回 401 后不再请求；重新登录后恢复。

### 10.6 边界

- 无新增环境变量、无新增基础设施；不启用 Web Push 或 Service Worker 推送。
- 桌面浏览器通知是纯前端能力，权限由用户自行授予，页面关闭后不提醒。
- 站内条目是发布时快照；后续模板或角色变化不影响已生成内容。
- 观察未读数请求量、列表响应时间、归档清理任务；确认 30 秒轮询没有造成数据库压力。
