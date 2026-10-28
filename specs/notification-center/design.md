# 通知中心与千树小助理落地设计

## 文档信息

| 项目 | 内容 |
| --- | --- |
| 文档状态 | 设计稿，关键决策已确认，待实施 |
| 方案定位 | 通知中心（系统通知）为统一能力；站内通知与千树小助理是两个渠道 |
| 关联文档 | [文档索引](./README.md)、[接口契约](./api.md)、[数据模型](./data-model.md)、[事件规格](./events.md)、[任务拆分](./tasks.md)、[运维手册](./runbook.md)、[部署清单](./deployment.md)、[GeWeAPI 评估](../../docs/技术评估/GeWeAPI微信通知接入评估.md) |
| 适用范围 | `server/src/modules/notifications`、`web/apps/qsmds-arco` |
| 最后更新 | 2026-10-28 |
| 实施边界 | 本文不含迁移 SQL、接口实现与页面代码；表结构、权限与迁移需单独评审批准 |

## 0. 已确认决策

| 决策 | 结论 | 影响 |
| --- | --- | --- |
| 回调 | 阶段 1 不接；只有需要实时掉线/联系人事件时再引入，届时单独做 CSRF 安全评审 | 阶段 1 无公网回调入口，不改 `CsrfProtectionGuard` |
| 首批事件 | 3 个：`PURCHASE_REVIEW_PENDING`（1:1）、`SLH_RECONCILIATION_COMPLETED`（财务群）、`SHIPMENT_ARRIVED`（运营群） | 其余 4 个放阶段 2 |
| 敏感内容 | 这 3 个事件允许金额与客户名称；1:1 与内部群都可发；群必须 `internal_only`，1:1 只发给已验证绑定 | 模板按事件 × 渠道开启 `allow_sensitive` |
| 派发器 | 进程内循环 + 数据库租约；5 秒轮询、批量 20、租约 30 秒 | 不新增 systemd 服务，不引入 Redis |
| 绑定 | 取消员工自助绑定；全部由管理员在后台完成，测试消息确认后置 `verified_at` | 不需要绑定码表，也不需要回调处理绑定消息 |

## 1. 目标与非目标

### 1.1 目标

- 业务模块只调用一个统一接口 `SystemNotificationService.publish()`，不感知渠道。
- 通知中心同时支持两个渠道：站内通知（`IN_APP`）与千树小助理（`ASSISTANT`，微信经 GeWe）。
- 千树小助理只承担「站外提醒」：失败不影响业务事务，业务侧始终有站内或其他降级路径。
- 管理端能配置渠道与公司号、维护员工绑定与群目标、编辑模板与渠道策略、查看发送记录、一键停发；回调引入后再提供回调记录。
- 数据模型为站内通知预留收件箱与已读体系；阶段 1 只启用千树小助理，站内渠道在阶段 3 上线。
- 所有外部调用可审计、可观测、可限速、可停发。

### 1.2 非目标

- 阶段 1 不实现站内通知中心页面与已读体系；只落表结构，渠道默认关闭。
- 不做员工自助绑定、绑定码或员工侧绑定入口；绑定全部由管理员完成。
- 不做多公司号选号与故障转移；首期只有一个公司号，模型保留 `accountId`。
- 不做图片、文件、语音、视频、群内 `@`、微信内回复指令。
- 不提供送达回执或已读状态；GeWe 没有该能力。
- 不把 GeWe 原始接口暴露给业务模块或浏览器。
- 不改变现有业务状态机；通知是旁路，不参与审批、对账、收付款的判定。

### 1.3 设计原则

1. **单一入口**：业务侧只调用 `SystemNotificationService.publish()`。
2. **渠道可插拔**：站内是收件箱条目，站外是发送尝试；两者的生命周期与状态机不同，不强行共用一张投递表。
3. **同事务入队**：通知、站内条目、站外交付与业务变更同事务提交。
4. **通知不阻断业务**：配置、模板、收件人问题只落失败记录，不抛异常。
5. **站外状态只到 ACCEPTED**：成功仅代表 GeWe 接受请求，不宣称送达。
6. **群优先、1:1 精准**：广播走群，指派走个人，避免单号触发群发风控。
7. **内容最小化**：默认只带单号与提示，金额、客户名称等敏感字段需显式允许。
8. **可止血**：千树小助理的全局停发与按事件停用必须一键完成。

## 2. 总体架构

```
业务模块（采购/资金/发票/对账/货件）
        │  publish(command, { transaction })
        ▼
SystemNotificationService
        │  同事务写入
        ├─► notifications（逻辑通知）
        ├─► notification_inbox_items（站内通知，阶段 3 启用）
        └─► assistant_deliveries（千树小助理）
                    │
                    ▼
            AssistantDispatchService（worker）
                    │
            AssistantTransport
            ├─ GeweAssistantTransport ──► GeWe API ──► 微信
            └─ FakeAssistantTransport（仅测试）

GeWe 回调（可选，后续按需引入） ──► AssistantCallbackController ──► 归一化 ──► 去重 ──► 账号状态
管理端页面 ──► 通知中心管理 API + 千树小助理管理 API
```

职责边界：

- `notifications` 是「一条逻辑通知」，属于通知中心。
- `notification_inbox_items` 是站内收件箱条目，属于站内通知渠道；有已读、归档，没有重试与 TTL。
- `assistant_deliveries` 是千树小助理的发送尝试；有账号、重试、`msgId`、失败码、TTL。
- GeWe 只在 `AssistantTransport` 之后出现；共享模板、策略、记录层不引用 GeWe 字段。

## 3. 业务侧统一入口

### 3.1 调用形态

同进程依赖注入，不走 HTTP。命令、返回与语义见 [接口契约第 2 节](./api.md#2-业务侧统一接口主入口)。

```ts
await this.systemNotifications.publish(
  {
    eventType: 'PURCHASE_REVIEW_PENDING',
    source: { type: 'PURCHASE_ORDER', id: order.id },
    target: { kind: 'PERMISSION', permissionCode: 'purchase-orders:review' },
    templateKey: 'purchase.review.pending',
    variables: { orderNo: order.orderNo, vendorName: order.vendorName, itemCount: order.itemCount },
    dedupeKey: `purchase-review:${order.id}`,
    priority: 'HIGH',
  },
  { transaction },
)
```

### 3.2 为什么必须传业务事务

业务状态的提交与通知入队必须是同一个原子动作：

- 业务回滚时，通知、站内条目、站外交付一起回滚，不会出现「单没建成却通知了审核人」。
- 业务提交时，通知记录一定存在，不会出现「单建成了但没人收到提醒」。
- 业务代码不允许在事务内直接调用 GeWe；`publish()` 只写数据库。

代价是通知表写入失败会连坐业务事务。这是有意选择：如果连一条 insert 都失败，数据库本身已经不可用，此时「业务成功」也不可信。模板缺失、收件人为空这类**可预期问题不会抛异常**，只落失败记录，因此不会因配置问题阻断业务。

### 3.3 「谁应该知道」与「发到哪里」

命令里的 `target` 只回答「谁应该知道」，只接受 `USERS`、`ROLE`、`PERMISSION`。渠道目标由 `notification_channel_policies.target_mode` 决定：

- `COMMAND_TARGET`：用命令目标；站内默认，千树小助理 1:1 默认。
- `USERS` / `ROLE` / `PERMISSION`：策略覆盖命令目标。
- `GROUP`：只允许千树小助理，发到已登记的群目标。

这样业务模块不需要知道「财务群」这类渠道概念；群路由由管理员在渠道策略里维护。

### 3.4 收件人快照

`USERS`、`ROLE`、`PERMISSION` 在发布时解析成具体用户并写入站内条目或站外交付。之后角色调整、员工停用不会改变已入队通知；停用用户由渠道落地时二次校验并落 `SKIPPED`。

### 3.5 事件目录

首批候选事件与默认渠道见 [接口契约第 2.7 节](./api.md#27-事件目录首批候选需业务确认)。阶段 1 只启用 `PURCHASE_REVIEW_PENDING`、`SLH_RECONCILIATION_COMPLETED`、`SHIPMENT_ARRIVED` 三个事件；其余 4 个在阶段 2 追加。事件目录是稳定契约：

- 新增事件只追加。
- 每个事件在每个启用渠道上必须有策略与模板；缺失时该渠道跳过，不影响其他渠道。
- 渠道的收件人、TTL、优先级由 `notification_channel_policies` 维护，不写死在业务代码里。

## 4. 领域模型

### 4.1 表清单

共享表使用 `notification_` 前缀；千树小助理的专属表使用 `assistant_` 前缀。字段命名遵循 Prisma 现有约定：模型 PascalCase、列 `@map` 为 snake_case、时间戳 `@db.Timestamptz(6)`。

| 表 | 归属 | 用途 | 关键字段 |
| --- | --- | --- | --- |
| `notifications` | 通知中心 | 逻辑通知 | `event_type`、`source_type`、`source_id`、`dedupe_key` 唯一、`priority`、`status`、`template_key`、`requested_channels`、`variables`、`expires_at`、`published_at`、`completed_at`、`requested_by_user_id` |
| `notification_inbox_items` | 站内通知 | 收件箱条目（阶段 3） | `notification_id`、`user_id`、`template_version`、`title_snapshot`、`body_snapshot`、`link_url_snapshot`、`read_at`、`archived_at`；唯一 `(notification_id, user_id)` |
| `notification_templates` | 通知中心 | 按渠道的模板 | `key`、`channel`、`name`、`title_template`、`body_template`、`link_url_template`、`variables`、`max_length`、`enabled`、`version`；唯一 `(key, channel)` |
| `notification_channel_policies` | 通知中心 | 事件 × 渠道策略 | `event_type`、`channel`、`target_mode`、`target_config`、`template_key`、`priority`、`ttl_seconds`、`quiet_hours`、`allow_sensitive`、`enabled`、`version`；唯一 `(event_type, channel)` |
| `notification_settings` | 通知中心 | 全局设置 | `id='default'`、`notification_retention_days`、`delivery_retention_days`、`callback_retention_days`、`version`、`updated_by_user_id` |
| `notification_channel_settings` | 通知中心 | 渠道开关与默认值 | `channel` 主键、`enabled`、`default_quiet_hours`、`version`、`updated_by_user_id` |
| `assistant_deliveries` | 千树小助理 | 逐人或逐群发送尝试 | `notification_id`、`recipient_user_id`、`target_id`、`account_id`、`status`、`attempt_count`、`next_attempt_at`、`template_version`、`rendered_content`、`provider_msg_id`、`provider_new_msg_id`、`failure_code`、`accepted_at` |
| `assistant_accounts` | 千树小助理 | 公司号 | `name`、`app_id` 唯一、`wxid`、`status`、`region_id`、`proxy_ip_encrypted`、`last_online_at`、`last_login_at`、`version` |
| `assistant_bindings` | 千树小助理 | 员工与公司号绑定 | `user_id`、`account_id`、`wxid`、`wechat_nickname`、`status`、`bound_by_user_id`、`verified_at`、`verified_by_user_id`、`friend_checked_at`、`bound_at`；唯一 `(user_id, account_id)`、`(account_id, wxid)` |
| `assistant_targets` | 千树小助理 | 群目标 | `key` 唯一、`chatroom_id` 唯一、`name`、`purpose`、`internal_only`、`member_count`、`enabled`、`last_synced_at` |
| `assistant_callback_events` | 千树小助理 | 回调原始记录（可选，后续） | `app_id`、`version`、`kind`、`provider_new_msg_id`、`dedupe_key` 唯一、`raw_payload`、`process_status`、`process_error`、`received_at` |
| `assistant_dispatch_leases` | 千树小助理 | 派发器单实例租约 | `id='assistant-dispatch'`、`owner_id`、`expires_at` |

设计取舍：

- **不合并成 `notification_deliveries` 单表**：站内与站外的状态机不同，合并会引入大量只有一边使用的可空字段和无法统一的状态枚举。
- **不命名为 `inapp_deliveries`**：站内不是一次投递，而是一条持久收件箱条目；`read_at` / `archived_at` 才是它的生命周期。
- **`assistant_deliveries` 不再带 `channel` 列**：表名已经限定渠道，避免冗余与不一致。

### 4.2 状态机

通知状态（共享）：

```
PENDING ──► COMPLETED
   │      ├─► PARTIAL
   │      ├─► FAILED
   │      ├─► SKIPPED
   │      ├─► EXPIRED
   │      └─► CANCELLED
```

- 站内条目创建成功即视为该渠道成功；站外交付异步推进。
- `PARTIAL` 表示至少一个渠道成功、至少一个渠道失败/跳过/过期。
- `EXPIRED` 只在没有任何渠道成功且站外交付过期时使用。
- `CANCELLED` 只取消站外未发送交付；已创建的站内条目保留。

站外交付状态：

```
PENDING ──► SENDING ──► ACCEPTED
   │            │
   │            ├─► PENDING（可重试失败，带 next_attempt_at）
   │            └─► FAILED（重试耗尽或不可重试）
   ├─► SKIPPED
   ├─► EXPIRED
   └─► CANCELLED
```

`ACCEPTED` 只表示 GeWe 返回了 `ret=200`。页面文案必须写「已接受」，不能写「已送达」。

站内条目状态用时间戳表达：未读（`read_at IS NULL AND archived_at IS NULL`）、已读、已归档。

### 4.3 约束与索引

- `notifications.dedupe_key` 全局唯一，保证一事件一通知。
- 站内唯一：`(notification_id, user_id)`；索引 `(user_id, archived_at, created_at DESC)` 支撑收件箱与未读数。
- 站外唯一：个人交付 `(notification_id, recipient_user_id)`，仅 `recipient_user_id IS NOT NULL` 的部分唯一索引；群交付 `(notification_id, target_id)`，仅 `target_id IS NOT NULL` 的部分唯一索引。
- 回调去重：`(app_id, provider_new_msg_id)` 唯一。
- 派发索引：`assistant_deliveries (status, next_attempt_at)`。
- 查询索引：`notifications (event_type, published_at DESC)`、`(source_type, source_id)`。
- 外键统一 `onDelete: Restrict`；`notification → inbox/deliveries` 可在保留期清理时 `Cascade`。
- `event_type`、`template_key` 不做外键，允许模板或策略缺失时仍写入失败记录；一致性由发布校验和管理端约束保证。
- 渠道策略约束：`channel = 'IN_APP'` 时 `target_mode != 'GROUP'`、`ttl_seconds` 与 `quiet_hours` 必须为空；`channel = 'ASSISTANT'` 时 `GROUP` 合法且 TTL 必填。
- 敏感内容约束：`allow_sensitive = true` 且 `target_mode = 'GROUP'` 时，只能选择 `internal_only = true` 的群；1:1 投递只发给 `verified_at` 非空的绑定。
- 绑定唯一性：`(user_id, account_id)` 与 `(account_id, wxid)`；`verified_at` 为空表示尚未完成测试消息确认。
- 不使用软删除；用 `status` 与时间戳表达生命周期。

### 4.4 模板与内容

- 模板唯一键是 `(key, channel)`；业务命令只传一个 `templateKey`，系统为每个启用渠道解析自己的模板。
- 发布时渲染内容：站内写入 `title_snapshot/body_snapshot/link_url_snapshot`，站外写入 `assistant_deliveries.rendered_content`。
- 模板修改不会改变已入队内容；这是可追溯性的前提。
- 模板只支持 `{{variable}}` 占位，不执行表达式、不渲染 HTML。
- 保存模板时校验：占位符必须在变量白名单中，静态长度加最大变量长度不得超过 `max_length`。
- 发布时变量缺失：对应渠道落失败记录，`failure_code = TEMPLATE_VARIABLE_MISSING`，不抛异常；其他渠道不受影响。
- 实际渲染超过 `max_length`：截断并追加 `…`，记录 `truncated` 标记。
- 敏感变量在模板中必须标记 `sensitive`；策略未开启 `allow_sensitive` 时替换为 `***` 并返回 `SENSITIVE_VARIABLE_MASKED` 警告。
- 阶段 1 的 3 个事件在 `ASSISTANT` 渠道开启 `allow_sensitive`：金额与客户名称可以出现在 1:1 和内部群。1:1 只发给 `verified_at` 非空的绑定；群必须 `internal_only = true`。
- 本次放行范围只有金额与客户名称；手机号、地址、证件号等其他敏感字段仍然脱敏，除非后续单独批准。

### 4.5 数据保留与清理

| 数据 | 默认保留 | 说明 |
| --- | --- | --- |
| `assistant_callback_events` | 30 天 | 原始报文可能含消息内容，保留期最短（回调引入后） |
| `assistant_deliveries` | 90 天 | 站外发送台账，用于排查与对账 |
| `notifications` | 180 天 | 逻辑通知与统计 |
| `notification_inbox_items` | 用户归档或 1 年 | 站内消息是用户资产，不随站外 TTL 删除 |

清理由 `server/src/commands/notification-operations.ts cleanup` 执行，沿用媒体清理的 systemd timer 模式，每日一次。保留期可在 `notification_settings` 调整，但必须有下限（回调 ≥7 天、站外投递 ≥30 天）。

## 5. 投递链路

### 5.1 入队

`publish()` 在一个事务内完成：

1. 解析事件在 `notification_channel_policies` 中的启用渠道。
2. 对每个渠道解析目标：`COMMAND_TARGET` 用命令目标，其他模式用策略配置；`GROUP` 只用于千树小助理。
3. 解析收件人为具体用户或群目标。
4. 计算幂等键；已存在则直接返回原通知。
5. 站内：为每个用户创建 `notification_inbox_items`，写入渲染快照。
6. 站外：为每个用户或群创建 `assistant_deliveries`；未绑定、停用、渠道关闭的收件人直接落 `SKIPPED`。
7. 汇总通知状态。

阶段 1 的渠道设置只插入并启用 `ASSISTANT`；`IN_APP` 行在阶段 1 不插入，发布请求 `IN_APP` 时返回 `CHANNEL_NOT_CONFIGURED`，不创建收件箱条目。阶段 3 再插入并启用。阶段 1 只配置 3 个事件；`PURCHASE_REVIEW_PENDING` 的 1:1 依赖管理员手动绑定。

### 5.2 派发器形态与单实例保证

仓库当前没有队列、Redis 或调度器。首期不引入新依赖，采用**进程内派发循环 + 数据库租约**：

- `AssistantDispatchService` 在应用启动后启动循环，每 5 秒轮询一次。
- 用 `assistant_dispatch_leases` 的单行租约保证同一时刻只有一个实例派发：
  - 获取：`UPDATE ... SET owner_id = $me, expires_at = now() + 30s WHERE id = 'assistant-dispatch' AND (expires_at < now() OR owner_id = $me) RETURNING ...`
  - 心跳：每 10 秒续租；续租失败立即停止派发。
  - 进程退出后租约自然过期，其他实例可接管。
- 站内通知不需要 worker：收件箱条目在发布事务内创建，读取由查询接口完成。
- 部署形态不变：不新增 systemd 服务，不需要 Redis。当前通知量很低，可以接受；派发量增大后再拆独立进程。

### 5.3 领取与并发

每轮领取最多 20 条到期交付：

```sql
UPDATE assistant_deliveries d
SET status = 'SENDING', updated_at = now()
WHERE d.id IN (
  SELECT d2.id
  FROM assistant_deliveries d2
  JOIN notifications n ON n.id = d2.notification_id
  WHERE d2.status = 'PENDING' AND d2.next_attempt_at <= now()
  ORDER BY n.priority DESC, d2.created_at ASC
  FOR UPDATE OF d2 SKIP LOCKED
  LIMIT 20
)
RETURNING d.*;
```

`SKIP LOCKED` 保证多实例或多轮次不会重复领取。`priority` 不冗余到交付表，排序时 join 通知表。单实例内部串行发送，不并发调用 GeWe。

### 5.4 限速

按公司号维度控制：

- 每分钟不超过 40 条。
- 同一收件人相邻消息间隔不少于 1 秒。
- 群消息间隔随机 2~5 秒。
- 同一批通知按 `HIGH` 优先、创建时间升序发送。

限制器是进程内的软限制；租约切换后计数会重置。这是可接受的，因为限速目的是降低风控概率，不是精确配额。

### 5.5 错误分类与重试

| 现象 | 分类 | 处理 |
| --- | --- | --- |
| 连接超时、连接重置 | 可重试 | 退避 5s / 30s / 2m，最多 3 次 |
| HTTP 5xx（非离线） | 可重试 | 同上 |
| `ret=503` 或返回「节点离线」 | 账号离线 | 账号置 `OFFLINE`，退避 30s / 2m / 5m，TTL 兜底 |
| `ret=400/403/404` | 不可重试 | 落 `FAILED`，管理端告警 |
| 限流类返回 | 可重试 | 退避 60s，最多 3 次 |
| 未知返回 | 不可重试 | 落 `FAILED` 并告警，避免无限重试 |
| `ret=200` | 成功接受 | 落 `ACCEPTED`，保存 `msgId/newMsgId` |

文档没有正式错误码表，上表是保守起点，必须在试用期用真实返回校准。重试无幂等键，可能产生重复消息；内容中带单号，便于人工识别。

### 5.6 静默时段

只作用于千树小助理：

- 默认 `20:00–08:00`（`Asia/Shanghai`），可在渠道设置或事件×渠道策略覆盖。
- `NORMAL` 通知在静默时段不发送，`next_attempt_at` 推到窗口开始；若窗口开始晚于 `expiresAt`，直接 `EXPIRED`。
- `HIGH` 通知不受静默时段限制，例如待审核、提现审批。
- 站内通知没有静默时段，收件箱条目立即创建。

### 5.7 TTL

- 只约束站外交付。优先使用命令的 `expiresAt`；否则取事件×渠道策略的 `ttl_seconds`；默认 24 小时，最长 7 天。
- 站内收件箱条目不因 TTL 删除。
- 过期扫描与派发同一循环：把过期且未完成的站外交付置 `EXPIRED`，再汇总通知状态。
- 重连后不回放过期通知；这是产品要求，不是实现限制。

### 5.8 账号离线与封禁

- 账号状态：`ONLINE`、`OFFLINE`、`REQUIRES_LOGIN`、`DISABLED`。
- 发送前检查账号状态；`ONLINE` 状态超过 60 秒未刷新时调用 `checkOnline`，结果缓存 30 秒。
- 离线：交付保持 `PENDING` 并按离线退避；TTL 到期转 `EXPIRED`。
- 需要重新登录：不再尝试发送，管理端显示红色状态与「重新扫码」入口。
- 疑似封禁：连续多次登录失败或回调出现退出事件，账号置 `REQUIRES_LOGIN` 并告警；是否停用由管理员决定。
- 阶段 1 无回调：掉线靠 `checkOnline` 每 60 秒轮询与发送失败发现，检测延迟最长约 60 秒；回调引入后改用事件驱动。
- 账号不可用期间，通知不自动改走站内（站内渠道可能已关闭）；降级由业务侧主通道承担。

### 5.9 环境变量

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `ASSISTANT_GEWE_BASE_URL` | 是 | 必须是 `https://`，默认 `https://api.geweapi.com` |
| `ASSISTANT_GEWE_TOKEN` | 是 | 只从环境读取，不落库、不回显 |
| `ASSISTANT_CALLBACK_SECRET` | 否（回调引入后必填） | 回调路径密钥，至少 32 字节随机值 |
| `NOTIFICATION_INTERNAL_API_ENABLED` | 否 | 默认 `false` |
| `NOTIFICATION_INTERNAL_TOKEN` | 否 | 内部 HTTP 入口令牌 |
| `ASSISTANT_WORKER_ENABLED` | 否 | 默认 `true`；多副本时可只在一个副本开启，租约仍会兜底 |
| `ASSISTANT_WORKER_POLL_MS` | 否 | 默认 5000 |
| `ASSISTANT_WORKER_BATCH` | 否 | 默认 20 |
| `ASSISTANT_REQUEST_TIMEOUT_MS` | 否 | 默认 10000 |

渠道启停由 `notification_channel_settings` 管理，不再使用进程级 `ASSISTANT_ENABLED`，避免双开关冲突。配置缺失时**不阻断服务启动**：记录错误日志，管理端概览显示 `CONFIG_INVALID`，发布时该渠道落 `SKIPPED`。

## 6. GeWe 适配层

### 6.1 Transport 接口

```ts
export interface AssistantTransport {
  sendText(input: {
    appId: string
    toWxid: string
    content: string
  }): Promise<AssistantTransportResult>
}

export type AssistantTransportResult =
  | { ok: true; msgId: string | null; newMsgId: string | null }
  | { ok: false; kind: 'TIMEOUT' | 'NETWORK' | 'REJECTED' | 'OFFLINE' | 'RATE_LIMITED' | 'UNKNOWN'; code: string; message: string }
```

首期只实现 `sendText`。链接消息在第三阶段加入 `sendLink`，不改变业务调用方。

### 6.2 请求映射

- 文字：`POST /gewe/v2/api/message/postText`，body `{ appId, toWxid, content }`。
- 群消息：`toWxid` 为 `xxx@chatroom`；群内 `@` 暂不支持。
- 请求头 `X-GEWE-TOKEN` 从环境注入；日志与错误对象只保留 `ret` 与 `msg`，不保留请求体。
- 响应 `ret=200` 时保存 `data.msgId` 与 `data.newMsgId`；其余字段忽略。

### 6.3 出站安全校验

所有出站请求必须先经过统一校验：

1. 只允许 `http` / `https`；生产环境只允许 `https`。
2. 解析 URL，拒绝包含用户名密码、非 443 端口、查询串中的敏感信息。
3. host 必须在白名单中（首期只有 `api.geweapi.com`）。
4. 解析 DNS 后拒绝 localhost、回环、私有、链路本地、保留地址和多播地址。
5. 把解析结果固定到本次连接，防止 DNS 重绑定。
6. 禁止跟随重定向。
7. 请求超时 10 秒，响应体上限 1 MiB。
8. `X-GEWE-TOKEN` 不得出现在日志、异常消息、审计元数据中。

### 6.4 测试替身

`FakeAssistantTransport` 在测试中按脚本返回成功、超时、离线、拒绝等结果，并记录调用参数。测试环境如果误配真实 transport，启动即失败，避免 CI 触网。

## 7. 回调（可选，阶段 1 不实现）

> 本节描述后续可选能力。阶段 1 不接回调；只有业务要求实时掉线/联系人事件时才引入，届时 7.1 的 CSRF 例外需要单独安全评审。

### 7.1 CSRF 例外（引入回调时才需要评审）

现状：`CsrfProtectionGuard` 是全局 Guard，对除 `GET/HEAD` 外的所有方法要求 `Origin` 等于 `APP_ORIGIN`、`X-Qianshu-CSRF: 1`、JSON Content-Type。它**明确不读取 `@Public` 等路由元数据**，因此 GeWe 的机器回调无法直接通过。

可选方案：

| 方案 | 做法 | 评价 |
| --- | --- | --- |
| A. 受限装饰器（推荐） | 新增 `@MachineCallback()` 元数据，Guard 只识别这一个显式标记；路由必须同时 `@Public`、路径密钥、常量时间比较、限流、1 MiB 限制 | 语义正确：机器回调本来就没有浏览器会话；例外范围可枚举、可测试 |
| B. 独立监听 | 第二个 Nest 应用或独立端口，只挂回调控制器，不注册全局 CSRF Guard | 隔离最彻底，但新增监听、健康检查与部署配置 |
| C. 反向代理注入 | nginx 对回调路径注入 `Origin` 与 `X-Qianshu-CSRF` | 不改代码，但把安全例外藏在基础设施里，三套部署都要配，最脆弱 |

推荐 A，并附加以下约束：

- `@MachineCallback()` 只能与 `@Public()` 同时使用，否则启动失败。
- 全仓库只允许回调控制器使用；增加单元测试断言「只有 `/api/assistant/callback/:secret` 携带该标记」。
- 回调路由必须校验路径密钥、JSON Content-Type、1 MiB 请求体上限、每分钟 60 次/IP 限流。
- Guard 仍然对所有其他写操作执行完整 CSRF 校验；不能改成「按路径前缀跳过」。
- 该改动涉及全局安全防线，实施前必须单独做安全评审与测试评审。

如果安全评审不接受修改 Guard，则退回方案 B，不采用方案 C。

### 7.2 请求体解析

现有默认 JSON 解析器上限为 100 KiB。回调单独注册 1 MiB 解析器，超出返回 413 `PAYLOAD_TOO_LARGE`。实现方式沿用 `createPurchaseOrderBodyParser()` 的「只匹配指定路径、使用 Nest ExpressAdapter 公开注册接口」模式，不改变全局解析器。

### 7.3 版本归一

回调控制器只做三件事：校验密钥与大小、落 `assistant_callback_events`、返回 200。归一化在异步处理器中执行：

- 存在 `TypeName` 或 `Data`：按 v1 解析。
- 顶层 `msgType` 为字符串：按 v2 解析。
- 两者都不满足：记为 `UNKNOWN`，只入库，不处理。
- 统一输出 `AssistantCallbackEvent`：`{ version, appId, wxid, kind, msgId, newMsgId, fromUser, toUser, content, isSelf, receivedAt }`。
- 去重键：`appId + ':' + newMsgId`。重复回调直接返回，不重复处理。

### 7.4 事件处理

| 归一化事件 | 处理 |
| --- | --- |
| 文本消息 | 阶段 1 无回调；引入后只入库，不处理（绑定由管理员完成） |
| 掉线 / 登录失败 / 退出 / 重连失败 | 更新账号状态、写审计、触发告警 |
| 登录成功 / 重连成功 | 更新账号状态为 `ONLINE` |
| 联系人删除 | 对应绑装置 `INVALID`，写审计 |
| 其他消息与系统事件 | 只入库，不触发业务动作 |

回调不修改任何业务单据；即使报文被伪造，影响范围也只限于账号状态与绑定，且绑定还需要一次性码。

### 7.5 绑定不由回调驱动

绑定完全由管理员在后台完成：选择员工、从公司号好友列表选择微信、发送测试消息、员工确认后标记 `verified_at`。回调不处理绑定码，也不需要绑定码表。

约束：

- 绑定键是 `(user_id, account_id, wxid)`；`wxid` 与微信号 alias 不同，必须用 `wxid`。
- 只有 `verified_at` 非空的绑定可以接收 1:1 消息，尤其是金额与客户名称。
- 好友关系巡检调用「检测好友关系」接口；非好友置 `INVALID`，管理端提示重新绑定。
- 解绑、换号、离职停用都写审计；离职停用用户时绑定自动失效。

### 7.6 回调安全

- 无签名机制，按不可信输入处理：路径密钥、限流、大小限制、只做固定动作。
- 原始报文含消息内容，保留 30 天，管理端查看时对 `content` 做截断与脱敏。
- 不把回调内容拼进 SQL、模板或日志；日志只记录 `appId`、`msgType`、`newMsgId`、处理结果。
- 回调入库失败时记录错误并返回 200（供应商不重试，返回 500 只会放大重复风险），同时触发告警；丢失的回调只能靠反向代理日志排查。
- 回调失败不重试；解析失败只影响该条记录，不影响后续回调。

## 8. 后台管理 API 与前端

### 8.1 API 资源划分

接口清单见 [接口契约第 4 节](./api.md#4-管理端-http-api)。服务端按「共享能力」与「千树小助理渠道」拆控制器：

共享（`server/src/modules/notifications/`）：

- `notification-settings.controller.ts`：全局保留期。
- `notification-template.controller.ts`：模板 CRUD、预览、测试。
- `notification-policy.controller.ts`：事件 × 渠道策略。
- `notification-record.controller.ts`：逻辑通知列表、详情、取消。
- `notification-inbox.controller.ts`：站内收件箱（阶段 3）。

千树小助理（`server/src/modules/notifications/assistant/`）：

- `assistant-channel.controller.ts`：渠道配置、测试、启停。
- `assistant-account.controller.ts`：账号 CRUD、扫码登录、重连、退出。
- `assistant-binding.controller.ts`：公司号好友列表、管理员绑定、测试消息验证、解绑、巡检。
- `assistant-target.controller.ts`：群目标同步与维护。
- `assistant-delivery.controller.ts`：单条站外交付重试。
- `assistant-callback-event.controller.ts`：回调记录（可选，回调引入后）。
- `assistant-callback.controller.ts`：机器回调（可选，回调引入后），排除出 OpenAPI。

所有管理端写操作使用 `@RequirePermissions`，读操作使用对应 `:read`；审计在业务事务内写。

### 8.2 管理端信息架构

单一路由 `/system/notifications`，页面标题「通知中心」，用 `FaTabs` 分页签：

| 页签 | 内容 | 阶段 |
| --- | --- | --- |
| 概览 | 渠道状态、公司号在线、今日发送/失败/未读、队列积压 | 1 |
| 站内通知 | 站内渠道配置与消息治理 | 3，阶段 1 隐藏 |
| 千树小助理 | 渠道配置、公司号、管理员绑定、群目标 | 1 |
| 通知规则 | 模板（按渠道）与事件 × 渠道策略 | 1 |
| 发送记录 | 逻辑通知、渠道汇总、逐人交付、重试/取消 | 1 |
| 回调记录 | 回调列表与原始报文 | 可选，回调引入后 |

路由元数据：

```ts
{
  path: '/system/notifications',
  name: 'systemNotifications',
  component: () => import('@/views/system/notifications/index.vue'),
  meta: {
    title: '通知中心',
    icon: 'qs-notification',
    auth: [
      'notification-record:read',
      'notification-template:read',
      'assistant-channel:read',
    ],
    singleMenu: true,
  },
}
```

`meta.auth` 使用 any-of：只有发送记录权限的财务也能进入页面，但只看得到「发送记录」页签。页签内部再按各自权限显示。回调引入后再把 `assistant-callback:read` 加入 auth。

图标必须新增品牌资产：`src/assets/icons/qs-notification.svg`、`brand-icons.json` 登记、重跑 `node web/scripts/generate-icon-inventory.mjs`。千树小助理页签如需图标，同时新增 `qs-assistant.svg`；导航图标不能用 `i-lucide:*`。

### 8.3 页面结构

```
views/system/notifications/
├── index.vue                    # FaTabs + 页签编排 + 权限
├── notifications.logic.ts       # 权限动作、查询构造、状态映射、错误提取
├── overview-panel.vue
├── inbox-panel.vue              # 阶段 3
├── assistant-panel.vue          # 渠道、账号、绑定、群目标
├── rules-panel.vue              # 模板 + 事件 × 渠道策略
├── records-panel.vue            # 逻辑通知与逐人交付
├── callback-panel.vue
└── components/
    ├── qr-login-modal.vue
    ├── binding-code-modal.vue
    ├── template-editor-modal.vue
    ├── channel-policy-editor-modal.vue
    └── notification-detail-drawer.vue
```

约定：

- 表格统一 `QsGenericTable`，禁止 `<FaTable>`、`<FaPagination>`、Arco 业务组件与硬编码色值。
- 弹窗统一 `QsGenericModal`；详情用 `FaDrawer`。
- 页头 `FaPageHeader`，内容区 `FaPageMain`，错误 `FaAlert`，空态 `FaEmpty`。
- 读请求带 `signal` 与 `errorPresentation: 'local'`；写请求 `retry: false`。
- 列表竞态用请求版本号；分页/筛选用统一微任务合并器，沿用 `views/system/users/index.vue` 的写法。
- 敏感操作（停发、退出登录、解绑、取消通知）二次确认。

### 8.4 移动端

- 断点 768px，与现有表格页一致。
- 表格在窄屏自动切卡片；自定义 `mobile-row` 时必须用 `hasVisibleTableColumn` 同步列显隐。
- 二维码弹窗在窄屏全宽，二维码最小 240px；按钮触控高度不小于 44px。
- 发送记录的操作收进底部 `FaDrawer`，桌面用 `FaDropdown`。

### 8.5 前端测试契约

- 更新 `test/api/system-management-routes.test.ts`：新增路由与权限断言。
- 新增 `test/api/notifications.test.ts`：API 方法、路径、参数、错误呈现。
- 新增 `test/views/notifications.test.ts`：页面源码契约（必须使用 QsGenericTable/FaPageHeader/FaAlert，禁止 FaTable/硬编码颜色），以及 `notifications.logic.ts` 纯函数测试。
- 浏览器用例可选，优先覆盖「权限不足看不到页签」与「二维码弹窗打开/关闭」。

## 9. 员工侧

- 员工**不需要**安装任何客户端，也不把自己的微信登录到 GeWe。
- 员工侧**没有绑定入口**；绑定、解绑、换号全部由管理员在后台完成。员工只需要在微信里添加公司号并接收消息。
- 新员工入职流程：管理员展示公司号二维码 → 员工扫码添加好友 → 管理员在手机端同意 → 管理员在「千树小助理 > 员工绑定」里从好友列表选择该员工 → 发送测试消息 → 员工确认后标记 `verified_at`。
- 阶段 3 的站内通知入口在顶栏铃铛与「站内通知」页；数据来自 `notification_inbox_items`，未读数来自 `read_at IS NULL` 的计数。
- 员工在微信里看到的发送者名称是**公司号微信自己的昵称**，不是系统里的「千树小助理」标签。上线时要把公司号昵称与头像设置为「千树小助理」，否则员工看到的是「公司号-01」。

## 10. 权限与审计

### 10.1 权限码

全部为 `system_only`，首期只授予 `system_admin`。

| 权限码 | 覆盖 |
| --- | --- |
| `notification-template:read` | 模板列表、预览 |
| `notification-template:update` | 新建、修改、测试发送 |
| `notification-policy:read` | 全局设置、事件 × 渠道策略 |
| `notification-policy:update` | 修改全局设置与渠道策略 |
| `notification-record:read` | 发送记录列表与详情 |
| `notification-record:manage` | 取消未发送的站外交付 |
| `assistant-channel:read` | 渠道配置与概览 |
| `assistant-channel:update` | 修改渠道、启停、测试发送 |
| `assistant-account:read` | 账号列表与状态 |
| `assistant-account:operate` | 新增账号、扫码登录、重连、退出 |
| `assistant-binding:read` | 绑定列表、公司号好友列表 |
| `assistant-binding:manage` | 管理员绑定、测试消息验证、解绑、好友巡检 |
| `assistant-target:read` | 群目标列表 |
| `assistant-target:manage` | 同步群、命名、启停 |
| `assistant-delivery:resend` | 重试单条站外交付 |
| `assistant-callback:read` | 回调记录与报文（可选，回调引入时新增） |

阶段 1 启用 15 个；`assistant-callback:read` 在引入回调时新增。若后续认为过细，可把模板与策略合并为 `notification-config:*`，把账号与渠道合并为 `assistant-channel:*`；不建议把「取消」与「重试」并入只读权限。

权限码必须在三处同步：`permission.constants.ts`、迁移中的 `permissions` / `role_permissions` 插入、`docs/` 相关说明。缺少任一处会被现有权限一致性测试拦住。

### 10.2 审计事件

| 事件 | 触发 | 元数据 |
| --- | --- | --- |
| `NOTIFICATION_TEMPLATE_UPDATED` | 模板变更 | `templateKey`、`channel`、`version` |
| `NOTIFICATION_POLICY_UPDATED` | 渠道策略或全局设置变更 | `eventType`、`channel`、`version` |
| `NOTIFICATION_CANCELLED` | 取消站外交付 | `notificationId`、取消数量 |
| `ASSISTANT_CHANNEL_UPDATED` | 修改渠道/启停 | 变更字段名，不含 Token |
| `ASSISTANT_ACCOUNT_LOGIN_STARTED` | 发起扫码 | `accountId`、`appId` |
| `ASSISTANT_ACCOUNT_LOGGED_IN` | 登录成功 | `accountId`、`wxid` 哈希 |
| `ASSISTANT_ACCOUNT_LOGGED_OUT` | 主动退出/掉线 | `accountId`、原因码 |
| `ASSISTANT_ACCOUNT_RECONNECTED` | 重连成功 | `accountId` |
| `ASSISTANT_BINDING_CREATED` | 管理员创建绑定 | `bindingId`、`userId`、`accountId`、`boundByUserId` |
| `ASSISTANT_BINDING_VERIFIED` | 测试消息确认后置为已验证 | `bindingId`、`verifiedByUserId` |
| `ASSISTANT_BINDING_REVOKED` | 解绑 | `bindingId`、操作者 |
| `ASSISTANT_BINDING_INVALIDATED` | 巡检失效 | `bindingId`、原因 |
| `ASSISTANT_DELIVERY_RESENT` | 手动重试 | `notificationId`、`deliveryId` |
| `ASSISTANT_CHANNEL_DISABLED` / `ENABLED` | 停发/恢复 | 操作者、原因 |

审计约束：

- 只在已有事务内写，复用 `AuditService.record(transaction, input)`。
- 回调驱动的事件使用 `actorType = SYSTEM`，不伪造用户身份。
- 元数据不写消息正文、金额、客户名称、Token、完整 `wxid`。
- 长字段截断；审计失败按现有规则使事务失败，不吞异常。

## 11. 安全设计

- **Token**：只从环境读取；管理端只返回 `configured` 与掩码；不进日志、不进审计、不进前端产物。
- **Base URL**：强制 HTTPS；host 白名单；拒绝私网、回环、保留地址；禁止重定向；固定 DNS 解析结果。
- **回调**：路径密钥常量时间比较；1 MiB 上限；每分钟 60 次/IP；只接受 JSON；内容按不可信输入处理。
- **绑定**：仅管理员操作；绑定后发送测试消息，员工确认后才写 `verified_at`；只有已验证绑定可接收敏感内容；解绑、换号写审计。
- **敏感内容**：仅阶段 1 的 3 个事件开启 `allow_sensitive`；1:1 只发已验证绑定；群必须 `internal_only`；手机号、地址、证件号仍脱敏。
- **内容**：模板变量白名单；不接受外部自由文本；不渲染 HTML。
- **日志**：统一脱敏 `token`、`secret`、`content`、`wxid`、`phone`；错误对象只保留 `ret/msg`。
- **CSRF 例外**：只允许机器回调使用 `@MachineCallback()`，需安全评审；不得改为按路径前缀跳过。
- **依赖**：不新增第三方 SDK；直接用 Node 内置 `fetch`/`https` 或现有 HTTP 能力，减少供应链面。

## 12. 可观测性

日志字段统一：`requestId`、`notificationId`、`deliveryId`、`appId`、`eventType`、`channel`、`attempt`、`ret`、`durationMs`。不记录消息正文与 Token。

计数器沿用现有 `AuthMetricLogger` 的结构化输出方式，新增：

- `notification_publish_total{event_type,channel,result}`
- `notification_inbox_unread{user_scope}`
- `assistant_delivery_total{status,failure_code}`
- `assistant_callback_total{version,kind,result}`
- `assistant_account_status{status}`

告警条件：

- 公司号离线超过 10 分钟。
- 15 分钟内站外交付失败率超过 20%。
- 回调引入后：账号在线但 30 分钟没有回调（可能回调配置失效）。阶段 1 无回调，账号在线靠 `checkOnline` 轮询。
- 站外队列最老 `PENDING` 超过 10 分钟。
- Token 无效或渠道配置缺失。

管理端概览只展示「已接受/失败/过期」，不展示「送达率」——没有回执，无法计算。站内可以展示未读数与已读数。

## 13. 测试策略

| 层级 | 覆盖 | 命令 |
| --- | --- | --- |
| 单元 | 模板渲染与校验、收件人解析、渠道策略解析、静默时段、TTL、幂等、错误分类、管理员绑定与验证、敏感字段策略 | `pnpm -C server test` |
| 集成 | 事务内发布 → 站内条目 + 站外交付 → worker → FakeTransport → 状态汇总；管理员绑定后的 1:1；重复发布；离线重试；停发；过期；渠道独立失败 | `pnpm -C server test:e2e` |
| 契约 | 管理端接口进入 OpenAPI，前端类型同步 | `pnpm contract:sync && pnpm contract:check` |
| 前端 | API 模块、路由权限、页面源码契约、逻辑纯函数 | `pnpm -C web test:api` |
| 浏览器 | 页面加载、页签权限、二维码弹窗、移动端卡片 | 现有浏览器测试入口（可选） |

测试要求：

- 全部测试使用 `FakeAssistantTransport`，禁止访问真实 GeWe。
- 回调引入后，夹具至少包含 v1 文本、v2 文本、掉线事件、重复 `newMsgId`、未知类型五类；阶段 1 不测回调。
- 集成测试使用隔离 schema，沿用 `server/test/*-e2e-database.ts` 的重放模式。
- 通知发布集成测试必须验证「业务事务回滚时通知、站内条目、站外交付都不落库」。
- 渠道独立性测试：站外交付全部失败时，站内条目仍然存在，通知状态为 `PARTIAL`。
- 绑定测试：管理员绑定 → 测试消息 → `verified_at` → 1:1 发送；未验证绑定收到敏感事件时必须跳过。
- 回调引入后再补 CSRF 例外用例：回调无 `Origin` 仍可进入；其他写接口无 CSRF 仍 403。

## 14. 落地顺序

| 阶段 | 范围 | 出口条件 |
| --- | --- | --- |
| 1. 通知中心骨架 + 千树小助理 | 共享表、3 个事件、渠道策略、模板、站外交付、进程内 worker、群目标、管理员绑定与验证、发送记录、渠道停发、管理端「概览/千树小助理/通知规则/发送记录」 | 一名测试员工完成管理员绑定并收到 1:1；内部测试群收到群通知；停发立即生效；站内渠道保持关闭；无回调 |
| 2. 事件扩展与内容增强 | 其余 4 个事件、链接消息、摘要聚合 | 7 个事件均可配置；通知可跳回系统页面；同一员工短时间内多条待办可合并为一条摘要 |
| 3. 站内通知中心 | 启用 `IN_APP` 渠道、收件箱页面、顶栏铃铛、已读/归档、未读计数 | 站内与千树小助理共享同一发布接口；业务调用方零改动 |
| 4. 多公司号与可选回调 | 多账号路由；仅在需要实时掉线/联系人事件时引入回调 | 多号可切换；若引入回调，完成 CSRF 安全评审与回调测试 |

阶段 1 的前置条件：

- 数据库迁移与权限迁移获批。
- 一个已完成实名的公司号，且已在线养号 3~5 天；微信昵称与头像设置为「千树小助理」。
- 公司号已加入内部财务群与运营群；两个群都标记为 `internal_only`，成员均为有权查看金额与客户名称的内部员工。
- `ASSISTANT_GEWE_TOKEN` 已配置到部署环境；阶段 1 不需要 `ASSISTANT_CALLBACK_SECRET`，也不开放公网回调地址。
- 管理员可用公司号好友列表完成绑定；至少一名测试员工已添加公司号为好友。

## 15. 待确认决策

以下事项不阻塞阶段 1 开工，但需要在对应阶段前确认：

1. **TTL 与静默时段**：首批 3 个事件的 TTL 是否按 24h（采购审核）与 8h（对账完成、货件到仓）执行；默认静默时段 20:00–08:00 是否符合业务。
2. **敏感字段范围**：本次只放行金额与客户名称；手机号、地址、证件号仍脱敏。是否需要追加字段，需单独确认。
3. **内部群成员边界**：财务群、运营群的成员清单由谁维护；群内是否可能出现外部人员；成员变动时如何复核。
4. **数据保留**：站外交付 90 天、通知 180 天、站内 1 年是否满足审计要求；是否需要更长。
5. **权限粒度**：阶段 1 的 15 个权限码是否过多；是否合并模板/策略或账号/渠道。
6. **链接消息**：阶段 2 是否加入跳回系统页面的链接；链接与缩略图必须是微信端可访问的公网地址。
7. **多公司号**：阶段 4 是按业务范围拆号，还是只做冗余；这决定后续路由与绑定迁移方式。
8. **回调**：只有需要实时掉线/联系人事件时才引入；届时再在 `@MachineCallback()` 与独立监听端口之间选择，并完成安全评审。
9. **内容留存**：站内外渲染快照是否长期保存；若含金额与客户名称，是否只保留摘要或缩短保留期。
10. **绑定验证方式**：管理员发测试消息、员工线下确认后标记 `verified_at`，是否满足管理要求；是否需要双人复核。
