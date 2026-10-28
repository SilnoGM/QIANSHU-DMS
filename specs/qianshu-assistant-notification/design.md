# 千树小助理通知落地设计

## 文档信息

| 项目 | 内容 |
| --- | --- |
| 文档状态 | 设计稿，待评审；未实施 |
| 方案定位 | 通知中心的微信出站通道；站内通知后续接入同一命令模型 |
| 关联文档 | [接口契约](./api.md)、[GeWeAPI 微信通知接入评估](../../docs/技术评估/GeWeAPI微信通知接入评估.md) |
| 适用范围 | `server/src/modules/assistant`、`web/apps/qsmds-arco` |
| 最后更新 | 2026-10-28 |
| 实施边界 | 本文不含迁移 SQL、接口实现与页面代码；表结构、权限与迁移需单独评审批准 |

## 1. 目标与非目标

### 1.1 目标

- 业务模块只调用一个统一接口，不感知 GeWe、`appId`、`wxid`、`chatroomId`、Token 和限速。
- 微信提醒作为补充通道：通知失败不影响业务事务，业务侧始终有站内或其他降级路径。
- 管理端能配置渠道与公司号、维护员工绑定与群目标、编辑模板与策略、查看发送与回调记录、一键停发。
- 数据模型与命令模型为站内通知预留 `IN_APP` 通道，后续通知中心不需要改业务调用方。
- 所有外部调用可审计、可观测、可限速、可停发。

### 1.2 非目标

- 不实现站内通知中心的页面与已读体系；本文只预留模型与渠道位。
- 不做多公司号选号与故障转移；首期只有一个公司号，模型保留 `accountId`。
- 不做图片、文件、语音、视频、群内 `@`、微信内回复指令。
- 不提供送达回执或已读状态；GeWe 没有该能力。
- 不把 GeWe 原始接口暴露给业务模块或浏览器。
- 不改变现有业务状态机；通知是旁路，不参与审批、对账、收付款的判定。

### 1.3 设计原则

1. **单一入口**：业务侧只调用 `AssistantNotificationService.publish()`。
2. **同事务入队**：通知与业务变更同事务提交，避免「业务成功、通知丢失」。
3. **通知不阻断业务**：配置、模板、收件人问题只落失败记录，不抛异常。
4. **状态只到 ACCEPTED**：投递成功仅代表 GeWe 接受请求，不宣称送达。
5. **群优先、1:1 精准**：广播走群，指派走个人，避免单号触发群发风控。
6. **内容最小化**：默认只带单号与提示，金额、客户名称等敏感字段需显式允许。
7. **可止血**：全局停发与按事件停用必须在管理端一键完成。

## 2. 总体架构

```
业务模块（采购/资金/发票/对账/货件）
        │  publish(command, { transaction })
        ▼
AssistantNotificationService
        │  同事务写入
        ▼
assistant_notifications ──< assistant_deliveries
        │                              │
        │                              ▼
        │                     AssistantDispatchService（worker）
        │                              │
        │                     AssistantTransport
        │                     ├─ GeweAssistantTransport ──► GeWe API ──► 微信
        │                     └─ FakeAssistantTransport（仅测试）
        │
        └─ 站内通知中心（未来）读取同一张表，channel = IN_APP

GeWe 回调 ──► AssistantCallbackController ──► 归一化 ──► 去重 ──► 账号状态 / 绑定
管理端页面 ──► Assistant Admin API ──► 配置、绑定、模板、策略、记录
```

职责边界：

- `assistant_notifications` 是「一条逻辑通知」，`assistant_deliveries` 是「一个人或一个群在某个渠道上的一次投递」。
- 站内通知中心以后消费同一张通知表，为每个用户生成 `channel = IN_APP` 的投递记录；业务调用方与模板体系不变。
- GeWe 只在 `AssistantTransport` 之后出现，其他层不引用 GeWe 的字段。

## 3. 业务侧统一入口

### 3.1 调用形态

同进程依赖注入，不走 HTTP。命令、返回与语义见 [接口契约第 2 节](./api.md#2-业务侧统一接口主入口)。

```ts
await this.assistant.publish(
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

- 业务回滚时，通知记录一起回滚，不会出现「单没建成却通知了审核人」。
- 业务提交时，通知记录一定存在，不会出现「单建成了但没人收到提醒」。
- 业务代码不允许在事务内直接调用 GeWe；`publish()` 只写数据库。

代价是通知表写入失败会连坐业务事务。这是有意选择：如果连一条 insert 都失败，数据库本身已经不可用，此时「业务成功」也不可信。模板缺失、收件人为空这类**可预期问题不会抛异常**，只落失败记录，因此不会因配置问题阻断业务。

### 3.3 收件人快照

`USERS`、`ROLE`、`PERMISSION` 在发布时解析成具体用户并写入投递记录。之后角色调整、员工停用不会改变已入队通知；停用用户由投递时二次校验并落 `SKIPPED`。

`GROUP` 只接受已登记的群目标 key。业务模块不能传原始 `chatroomId`，避免误发到外部群。

### 3.4 事件目录

首批候选事件与默认目标见 [接口契约第 2.7 节](./api.md#27-事件目录首批候选需业务确认)。事件目录是稳定契约：

- 新增事件只追加。
- 每个事件必须有唯一模板与策略；缺失时通知落 `FAILED`，管理端可见。
- 事件的收件人、TTL、优先级由策略表维护，不写死在业务代码里。

## 4. 领域模型

### 4.1 表清单

所有表使用 `assistant_` 前缀。字段命名遵循 Prisma 现有约定：模型 PascalCase、列 `@map` 为 snake_case、时间戳 `@db.Timestamptz(6)`。

| 表 | 用途 | 关键字段 |
| --- | --- | --- |
| `assistant_settings` | 单例设置 | `id='default'`、`enabled`、`default_quiet_hours`、保留期、`version`、`updated_by_user_id` |
| `assistant_accounts` | 公司号 | `name`、`app_id` 唯一、`wxid`、`status`、`region_id`、`proxy_ip_encrypted`、`last_online_at`、`last_login_at`、`version` |
| `assistant_bindings` | 员工与公司号绑定 | `user_id`、`account_id`、`wxid`、`wechat_nickname`、`status`、`friend_checked_at`、`bound_at`；唯一 `(user_id, account_id)`、`(account_id, wxid)` |
| `assistant_binding_codes` | 一次性绑定码 | `user_id`、`account_id`、`code_hash`、`expires_at`、`used_at`、`created_by_user_id` |
| `assistant_targets` | 群目标 | `key` 唯一、`chatroom_id` 唯一、`name`、`purpose`、`member_count`、`enabled`、`last_synced_at` |
| `assistant_templates` | 消息模板 | `key` 唯一、`event_type`、`message_kind`、`body_template`、`title_template`、`link_url_template`、`variables`、`max_length`、`enabled`、`version` |
| `assistant_event_policies` | 事件策略 | `event_type` 唯一、`channels`、`target_kind`、`target_config`、`template_key`、`priority`、`ttl_seconds`、`quiet_hours`、`allow_sensitive`、`enabled`、`version` |
| `assistant_notifications` | 逻辑通知 | `event_type`、`source_type`、`source_id`、`dedupe_key` 唯一、`template_key`、`template_version`、`priority`、`status`、`requested_channels`、`variables`、`expires_at` |
| `assistant_deliveries` | 逐人或逐群投递 | `notification_id`、`channel`、`recipient_user_id`、`target_id`、`account_id`、`status`、`attempt_count`、`next_attempt_at`、`rendered_content`、`provider_msg_id`、`provider_new_msg_id`、`failure_code`、`accepted_at` |
| `assistant_callback_events` | 回调原始记录 | `app_id`、`version`、`kind`、`provider_new_msg_id`、`dedupe_key` 唯一、`raw_payload`、`process_status`、`process_error`、`received_at` |
| `assistant_worker_leases` | 派发器单实例租约 | `id='assistant-dispatch'`、`owner_id`、`expires_at` |

### 4.2 状态机

通知状态：

```
PENDING ──► DISPATCHING ──► COMPLETED
   │              │      ├─► PARTIAL
   │              │      ├─► FAILED
   │              │      └─► SKIPPED
   ├─► EXPIRED
   └─► CANCELLED
```

投递状态：

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

### 4.3 约束与索引

- `assistant_notifications.dedupe_key` 全局唯一，保证一事件一通知。
- 个人投递唯一：`(notification_id, channel, recipient_user_id)`，仅 `recipient_user_id IS NOT NULL` 的部分唯一索引。
- 群投递唯一：`(notification_id, channel, target_id)`，仅 `target_id IS NOT NULL` 的部分唯一索引。
- 回调去重：`(app_id, provider_new_msg_id)` 唯一；新建投递时同时写入 `assistant_callback_events.dedupe_key`。
- 派发索引：`assistant_deliveries (status, next_attempt_at)`。
- 查询索引：`assistant_notifications (event_type, published_at DESC)`、`(source_type, source_id)`。
- 外键统一 `onDelete: Restrict`；`notification → deliveries` 可在保留期清理时 `Cascade`。
- `event_type`、`template_key` 不做外键，允许模板或策略缺失时仍写入失败通知；一致性由发布校验和管理端约束保证。
- 不使用软删除；用 `status` 表达生命周期。

### 4.4 内容快照与模板

- 发布时渲染内容并写入 `assistant_deliveries.rendered_content`，同时记录 `template_version`。
- 模板修改不会改变已入队通知；这是可追溯性的前提。
- 模板只支持 `{{variable}}` 占位，不执行表达式、不渲染 HTML。
- 保存模板时校验：占位符必须在变量白名单中，静态长度加最大变量长度不得超过 `max_length`。
- 发布时变量缺失：通知落 `FAILED`、`failure_code = TEMPLATE_VARIABLE_MISSING`，不抛异常。
- 实际渲染超过 `max_length`：截断并追加 `…`，记录 `truncated` 标记。
- 敏感变量（金额、客户名称、手机号等）在模板中必须标记 `sensitive`；策略未开启 `allow_sensitive` 时替换为 `***` 并返回 `SENSITIVE_VARIABLE_MASKED` 警告。

### 4.5 数据保留与清理

| 数据 | 默认保留 | 说明 |
| --- | --- | --- |
| `assistant_callback_events` | 30 天 | 原始报文可能含消息内容，保留期最短 |
| `assistant_deliveries` | 90 天 | 发送台账，用于排查与对账 |
| `assistant_notifications` | 180 天 | 逻辑通知与统计 |
| `assistant_binding_codes` | 过期后 7 天 | 只存哈希，不存明文 |

清理由 `server/src/commands/assistant-operations.ts cleanup` 执行，沿用媒体清理的 systemd timer 模式，每日一次。保留期可在 `assistant_settings` 调整，但必须有下限（回调 ≥7 天、投递 ≥30 天）。

## 5. 投递链路

### 5.1 入队

`publish()` 在一个事务内完成：

1. 解析事件策略：渠道、目标、模板、优先级、TTL、敏感字段开关。
2. 解析收件人为具体用户或群目标。
3. 计算幂等键；已存在则直接返回原通知。
4. 渲染内容并落 `assistant_notifications` 与 `assistant_deliveries`。
5. 未绑定、停用、渠道关闭的收件人直接落 `SKIPPED` 并记录原因。

### 5.2 Worker 形态与单实例保证

仓库当前没有队列、Redis 或调度器。首期不引入新依赖，采用**进程内派发循环 + 数据库租约**：

- `AssistantDispatchService` 在应用启动后启动循环，每 5 秒轮询一次。
- 用 `assistant_worker_leases` 的单行租约保证同一时刻只有一个实例派发：
  - 获取：`UPDATE ... SET owner_id = $me, expires_at = now() + 30s WHERE id = 'assistant-dispatch' AND (expires_at < now() OR owner_id = $me) RETURNING ...`
  - 心跳：每 10 秒续租；续租失败立即停止派发。
  - 进程退出后租约自然过期，其他实例可接管。
- 这样部署形态不变：不新增 systemd 服务，不需要 Redis。代价是派发与 API 共享进程；当前通知量很低，可以接受。
- 若将来 API 需要多副本，租约已经保证只有一个派发者；若派发量增大，再拆成独立进程，命令与服务边界不变。

### 5.3 领取与并发

每轮领取最多 20 条到期投递：

```sql
UPDATE assistant_deliveries d
SET status = 'SENDING', updated_at = now()
WHERE d.id IN (
  SELECT d2.id
  FROM assistant_deliveries d2
  JOIN assistant_notifications n ON n.id = d2.notification_id
  WHERE d2.status = 'PENDING' AND d2.next_attempt_at <= now()
  ORDER BY n.priority DESC, d2.created_at ASC
  FOR UPDATE OF d2 SKIP LOCKED
  LIMIT 20
)
RETURNING d.*;
```

`SKIP LOCKED` 保证多实例或多轮次不会重复领取。`priority` 不冗余到投递表，排序时 join 通知表；如果后续量增大再考虑冗余。单实例内部串行发送，不并发调用 GeWe。

### 5.4 限速

按公司号维度控制：

- 每分钟不超过 40 条。
- 同一收件人相邻消息间隔不少于 1 秒。
- 群消息间隔随机 2~5 秒。
- 同一批通知按 `HIGH` 优先、创建时间升序发送。

限制器是进程内的软限制；租约切换后计数会重置。这是可接受的，因为限速目的是降低风控概率，不是精确配额。管理端可以看到「当前分钟已发送数」，但不需要持久化计数。

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

- 默认 `20:00–08:00`（`Asia/Shanghai`），可在设置或事件策略覆盖。
- `NORMAL` 通知在静默时段不发送，`next_attempt_at` 推到窗口开始；若窗口开始晚于 `expiresAt`，直接 `EXPIRED`。
- `HIGH` 通知不受静默时段限制，例如待审核、提现审批。

### 5.7 TTL

- 优先使用命令的 `expiresAt`；否则取事件策略的 `ttl_seconds`；默认 24 小时，最长 7 天。
- 过期扫描与派发同一循环：把过期且未完成的投递置 `EXPIRED`，再汇总通知状态。
- 重连后不回放过期通知；这是产品要求，不是实现限制。

### 5.8 账号离线与封禁

- 账号状态：`ONLINE`、`OFFLINE`、`REQUIRES_LOGIN`、`DISABLED`。
- 发送前检查账号状态；`ONLINE` 状态超过 60 秒未刷新时调用 `checkOnline`，结果缓存 30 秒。
- 离线：投递保持 `PENDING` 并按离线退避；TTL 到期转 `EXPIRED`。
- 需要重新登录：不再尝试发送，管理端显示红色状态与「重新扫码」入口。
- 疑似封禁：连续多次登录失败或回调出现退出事件，账号置 `REQUIRES_LOGIN` 并告警；是否停用由管理员决定。
- 账号不可用期间，通知不自动改走其他渠道；降级由业务侧的主通道承担。

### 5.9 环境变量

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `ASSISTANT_ENABLED` | 否 | 进程级默认开关；数据库设置可覆盖 |
| `ASSISTANT_GEWE_BASE_URL` | 是 | 必须是 `https://`，默认 `https://api.geweapi.com` |
| `ASSISTANT_GEWE_TOKEN` | 是 | 只从环境读取，不落库、不回显 |
| `ASSISTANT_CALLBACK_SECRET` | 是 | 回调路径密钥，至少 32 字节随机值 |
| `ASSISTANT_INTERNAL_API_ENABLED` | 否 | 默认 `false` |
| `ASSISTANT_INTERNAL_TOKEN` | 否 | 内部 HTTP 入口令牌 |
| `ASSISTANT_WORKER_ENABLED` | 否 | 默认 `true`；多副本时可只在一个副本开启，租约仍会兜底 |
| `ASSISTANT_WORKER_POLL_MS` | 否 | 默认 5000 |
| `ASSISTANT_WORKER_BATCH` | 否 | 默认 20 |
| `ASSISTANT_REQUEST_TIMEOUT_MS` | 否 | 默认 10000 |

配置缺失时**不阻断服务启动**：记录错误日志，管理端概览显示 `CONFIG_INVALID`，发布落 `SKIPPED`。通知是旁路，不能因为它配置错误导致整个系统不可用。数据库 `assistant_settings.enabled` 优先于 `ASSISTANT_ENABLED`；后者只是初始默认值。

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

首期只实现 `sendText`。链接消息在第二阶段加入 `sendLink`，不改变调用方。

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

## 7. 回调

### 7.1 CSRF 例外（必须评审的关键决策）

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
| 文本消息 + 内容匹配绑定码 | 校验码、写绑定、写审计（`SYSTEM`）、可选回复确认 |
| 掉线 / 登录失败 / 退出 / 重连失败 | 更新账号状态、写审计、触发告警 |
| 登录成功 / 重连成功 | 更新账号状态为 `ONLINE` |
| 联系人删除 | 对应绑装置 `INVALID`，写审计 |
| 其他消息与系统事件 | 只入库，不触发业务动作 |

回调不修改任何业务单据；即使报文被伪造，影响范围也只限于账号状态与绑定，且绑定还需要一次性码。

### 7.5 绑定流程

```
管理员或员工生成绑定码
        │
        ▼
员工扫码添加公司号 → 向公司号发送「绑定 <code>」
        │
        ▼
GeWe 回调 → 归一化 → 校验 code_hash、过期、未使用
        │
        ├─ 成功：写 assistant_bindings，标记 code used_at，审计
        └─ 失败：记录原因，不回复或回复固定提示
```

约束：

- 绑定码 128 位随机值，展示一次，数据库只存 HMAC-SHA256。
- 有效期 10 分钟，单次使用，同一用户每小时最多尝试 5 次。
- 绑定键是 `(user_id, account_id, wxid)`；`wxid` 与微信号 alias 不同，必须用 `wxid`。
- 好友关系巡检调用「检测好友关系」接口；非好友置 `INVALID`，管理端提示重新绑定。
- 员工解绑与管理员解绑都写审计；离职停用用户时绑定自动失效。

### 7.6 回调安全

- 无签名机制，按不可信输入处理：路径密钥、限流、大小限制、只做固定动作。
- 原始报文含消息内容，保留 30 天，管理端查看时对 `content` 做截断与脱敏。
- 不把回调内容拼进 SQL、模板或日志；日志只记录 `appId`、`msgType`、`newMsgId`、处理结果。
- 回调入库失败时记录错误并返回 200（供应商不重试，返回 500 只会放大重复风险），同时触发告警；丢失的回调只能靠反向代理日志排查。
- 回调失败不重试；解析失败只影响该条记录，不影响后续回调。

## 8. 后台管理 API 与前端

### 8.1 API 资源划分

接口清单见 [接口契约第 4 节](./api.md#4-管理端-http-api)。服务端按资源拆控制器：

- `assistant-channel.controller.ts`：渠道配置、测试、设置。
- `assistant-account.controller.ts`：账号 CRUD、扫码登录、重连、退出。
- `assistant-binding.controller.ts`：绑定列表、绑定码、解绑、巡检。
- `assistant-target.controller.ts`：群目标同步与维护。
- `assistant-template.controller.ts`：模板 CRUD、预览、测试。
- `assistant-policy.controller.ts`：事件策略。
- `assistant-notification.controller.ts`：发送记录、详情、重试、取消。
- `assistant-callback-event.controller.ts`：回调记录。
- `assistant-me.controller.ts`：员工自助。
- `assistant-callback.controller.ts`：机器回调，排除出 OpenAPI。

所有管理端写操作使用 `@RequirePermissions`，读操作使用对应 `:read`；审计在业务事务内写。

### 8.2 管理端信息架构

单一路由 `/system/assistant`，页面内用 `FaTabs` 分 6 个页签，避免为每个子页新增品牌图标：

| 页签 | 内容 | 关键动作 |
| --- | --- | --- |
| 概览 | 通道状态、公司号在线状态、今日发送/失败/待发、队列最老等待 | 立即自检、停发/恢复 |
| 账号与绑定 | 公司号卡片、二维码登录、绑定表、未绑定员工 | 扫码登录、重连、退出、生成绑定码、解绑、好友巡检 |
| 群目标 | 群列表、用途、启用状态 | 同步群、命名、启停 |
| 模板与策略 | 模板表、事件策略表 | 新建/编辑模板、预览、测试发送、编辑策略 |
| 发送记录 | 通知列表、逐人投递详情 | 筛选、查看详情、重试失败、取消未发 |
| 回调记录 | 回调列表、原始报文 | 查看详情、按账号/类型筛选 |

路由元数据：

```ts
{
  path: '/system/assistant',
  name: 'systemAssistant',
  component: () => import('@/views/system/assistant/index.vue'),
  meta: {
    title: '千树小助理',
    icon: 'qs-assistant',
    auth: ['assistant-channel:read', 'assistant-notification:read'],
    singleMenu: true,
  },
}
```

`meta.auth` 使用 any-of：只有发送记录权限的财务也能进入页面，但只看得到「发送记录」页签。

图标必须新增品牌资产：`src/assets/icons/qs-assistant.svg`、`brand-icons.json` 登记、重跑 `node web/scripts/generate-icon-inventory.mjs`。导航图标不能用 `i-lucide:*`，现有清单没有小助理语义图标。

### 8.3 页面结构

```
views/system/assistant/
├── index.vue                 # FaTabs + 页签编排 + 权限
├── assistant.logic.ts        # 权限动作、查询构造、状态映射、错误提取
├── overview-panel.vue
├── account-binding-panel.vue
├── group-target-panel.vue
├── template-policy-panel.vue
├── notification-panel.vue
├── callback-panel.vue
└── components/
    ├── qr-login-modal.vue
    ├── binding-code-modal.vue
    ├── template-editor-modal.vue
    ├── policy-editor-modal.vue
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
- 新增 `test/api/assistant.test.ts`：API 方法、路径、参数、错误呈现。
- 新增 `test/views/assistant.test.ts`：页面源码契约（必须使用 QsGenericTable/FaPageHeader/FaAlert，禁止 FaTable/硬编码颜色），以及 `logic.ts` 纯函数测试。
- 浏览器用例可选，优先覆盖「权限不足看不到页签」与「二维码弹窗打开/关闭」。

## 9. 员工侧

- 员工**不需要**安装任何客户端，也不把自己的微信登录到 GeWe。
- 入口在现有账号菜单的个人资料弹窗（`web/apps/qsmds-arco/src/components/AppAccountButton/profile.vue`）新增「微信通知」区块：
  - 未绑定：展示公司号二维码、「生成绑定码」按钮与操作步骤。
  - 已绑定：展示公司号名称、微信昵称、绑定时间、好友状态、解绑按钮。
  - 失效：提示「公司号不是好友，请重新添加后绑定」。
- 自助接口只要求登录，不要求管理权限；员工只能操作自己的绑定。
- 站内通知中心落地后，这里会增加「通知偏好」与「站内消息」入口；本文只留位置，不实现。

## 10. 权限与审计

### 10.1 权限码

全部为 `system_only`，首期只授予 `system_admin`。前缀从评估文档的 `wechat-*` / `notification-*` 统一为 `assistant-*`，便于按产品域授权。

| 权限码 | 覆盖 |
| --- | --- |
| `assistant-channel:read` | 渠道配置、设置、概览 |
| `assistant-channel:update` | 修改渠道、启停、测试发送 |
| `assistant-account:read` | 账号列表与状态 |
| `assistant-account:operate` | 新增账号、扫码登录、重连、退出 |
| `assistant-binding:read` | 绑定列表 |
| `assistant-binding:manage` | 生成绑定码、解绑、好友巡检 |
| `assistant-target:read` | 群目标列表 |
| `assistant-target:manage` | 同步群、命名、启停 |
| `assistant-template:read` | 模板列表、预览 |
| `assistant-template:update` | 新建、修改、测试发送 |
| `assistant-policy:read` | 事件策略 |
| `assistant-policy:update` | 修改事件策略 |
| `assistant-notification:read` | 发送记录与详情 |
| `assistant-notification:resend` | 重试、取消 |
| `assistant-callback:read` | 回调记录与报文 |

员工自助接口不新增权限码，使用 `@RequireAuthenticatedSession()`。

权限码必须在三处同步：`permission.constants.ts`、迁移中的 `permissions` / `role_permissions` 插入、`docs/` 相关说明。缺少任一处会被现有权限一致性测试拦住。

### 10.2 审计事件

| 事件 | 触发 | 元数据 |
| --- | --- | --- |
| `ASSISTANT_CHANNEL_UPDATED` | 修改渠道/设置 | 变更字段名，不含 Token |
| `ASSISTANT_ACCOUNT_LOGIN_STARTED` | 发起扫码 | `accountId`、`appId` |
| `ASSISTANT_ACCOUNT_LOGGED_IN` | 登录成功 | `accountId`、`wxid` 哈希 |
| `ASSISTANT_ACCOUNT_LOGGED_OUT` | 主动退出/掉线 | `accountId`、原因码 |
| `ASSISTANT_ACCOUNT_RECONNECTED` | 重连成功 | `accountId` |
| `ASSISTANT_BINDING_CREATED` | 绑定成功 | `bindingId`、`userId`、`accountId` |
| `ASSISTANT_BINDING_REVOKED` | 解绑 | `bindingId`、操作者 |
| `ASSISTANT_BINDING_INVALIDATED` | 巡检失效 | `bindingId`、原因 |
| `ASSISTANT_TEMPLATE_UPDATED` | 模板变更 | `templateKey`、`version` |
| `ASSISTANT_POLICY_UPDATED` | 策略变更 | `eventType`、`version` |
| `ASSISTANT_NOTIFICATION_RESENT` | 手动重试 | `notificationId`、`deliveryIds` |
| `ASSISTANT_NOTIFICATION_CANCELLED` | 取消 | `notificationId` |
| `ASSISTANT_CHANNEL_DISABLED` / `ENABLED` | 停发/恢复 | 操作者、原因 |

审计约束：

- 只在已有事务内写，复用 `AuditService.record(transaction, input)`。
- 回调驱动的事件使用 `actorType = SYSTEM`，不伪造用户身份。
- 元数据不写消息正文、金额、客户名称、Token、绑定码、完整 `wxid`。
- 长字段截断；审计失败按现有规则使事务失败，不吞异常。

## 11. 安全设计

- **Token**：只从环境读取；管理端只返回 `configured` 与掩码；不进日志、不进审计、不进前端产物。
- **Base URL**：强制 HTTPS；host 白名单；拒绝私网、回环、保留地址；禁止重定向；固定 DNS 解析结果。
- **回调**：路径密钥常量时间比较；1 MiB 上限；每分钟 60 次/IP；只接受 JSON；内容按不可信输入处理。
- **绑定码**：128 位随机；只存 HMAC；10 分钟有效；单次使用；失败限流；日志不记录明文。
- **内容**：模板变量白名单；敏感字段默认脱敏；不接受外部自由文本；不渲染 HTML。
- **日志**：统一脱敏 `token`、`secret`、`content`、`wxid`、`phone`；错误对象只保留 `ret/msg`。
- **CSRF 例外**：只允许机器回调使用 `@MachineCallback()`，需安全评审；不得改为按路径前缀跳过。
- **依赖**：不新增第三方 SDK；直接用 Node 内置 `fetch`/`https` 或现有 HTTP 能力，减少供应链面。

## 12. 可观测性

日志字段统一：`requestId`、`notificationId`、`deliveryId`、`appId`、`eventType`、`attempt`、`ret`、`durationMs`。不记录消息正文与 Token。

计数器沿用现有 `AuthMetricLogger` 的结构化输出方式，新增：

- `assistant_publish_total{event_type,result}`
- `assistant_delivery_total{channel,status,failure_code}`
- `assistant_callback_total{version,kind,result}`
- `assistant_account_status{status}`

告警条件：

- 公司号离线超过 10 分钟。
- 15 分钟内投递失败率超过 20%。
- 账号在线但 30 分钟没有回调（可能回调配置失效）。
- 队列最老 `PENDING` 超过 10 分钟。
- Token 无效或渠道配置缺失。

管理端概览只展示「已接受/失败/过期」，不展示「送达率」——没有回执，无法计算。

## 13. 测试策略

| 层级 | 覆盖 | 命令 |
| --- | --- | --- |
| 单元 | 模板渲染与校验、收件人解析、策略解析、静默时段、TTL、幂等、错误分类、回调归一化、绑定码校验 | `pnpm -C server test` |
| 集成 | 事务内发布 → worker → FakeTransport → 状态汇总；重复发布；离线重试；停发；过期 | `pnpm -C server test:e2e` |
| 契约 | 管理端接口进入 OpenAPI，前端类型同步 | `pnpm contract:sync && pnpm contract:check` |
| 前端 | API 模块、路由权限、页面源码契约、逻辑纯函数 | `pnpm -C web test:api` |
| 浏览器 | 页面加载、页签权限、二维码弹窗、移动端卡片 | 现有浏览器测试入口（可选） |

测试要求：

- 全部测试使用 `FakeAssistantTransport`，禁止访问真实 GeWe。
- 回调夹具至少包含 v1 文本、v2 文本、掉线事件、重复 `newMsgId`、未知类型五类。
- 集成测试使用隔离 schema，沿用 `server/test/*-e2e-database.ts` 的重放模式。
- 通知发布集成测试必须验证「业务事务回滚时通知不落库」。
- CSRF 例外必须有专门用例：回调无 `Origin` 仍可进入；其他写接口无 CSRF 仍 403。

## 14. 落地顺序

| 阶段 | 范围 | 出口条件 |
| --- | --- | --- |
| 1. 渠道骨架 | 表结构、设置、渠道与账号、Transport、Worker、群目标、模板、策略、发送记录、停发开关、管理端「概览/账号/群/模板/策略/记录」 | 能向内部测试群发一条文本；记录显示 `ACCEPTED`；停发立即生效；无真实员工参与 |
| 2. 绑定与 1:1 | 绑定表、绑定码、回调、好友巡检、员工自助、1:1 投递 | 一名测试员工完成绑定并收到 1:1 通知；解绑后落 `NOT_BOUND` |
| 3. 内容增强 | 链接消息、摘要聚合、员工通知偏好（衔接站内） | 通知可跳回系统页面；同一员工短时间内多条待办可合并为一条摘要 |
| 4. 通知中心 | 站内通知中心（独立设计）接入同一通知表与 `IN_APP` 渠道；多公司号路由 | 站内与微信共享同一发布接口；业务调用方零改动 |

阶段 1 的前置条件：

- 数据库迁移与权限迁移获批。
- 一个已完成实名的公司号，且已在线养号 3~5 天。
- 公司号已被拉入内部测试群。
- `ASSISTANT_GEWE_TOKEN` 与 `ASSISTANT_CALLBACK_SECRET` 已配置到部署环境。
- 管理端能访问公网回调地址；反向代理透传 `Content-Type` 与请求体。

## 15. 待确认决策

1. **CSRF 例外方案**：是否接受 `@MachineCallback()` 这一受限装饰器；若不接受，是否改为独立监听端口。该决策影响安全评审与部署。
2. **Worker 形态**：首期采用「进程内循环 + 数据库租约」是否可接受；是否要求独立 systemd 服务。
3. **事件目录**：首批 7 个事件的收件人、群目标、TTL、优先级是否确认；是否需要增加/删减。
4. **敏感内容**：金额、客户名称是否默认不进微信；哪些角色可以开启 `allow_sensitive`。
5. **静默时段**：默认 20:00–08:00 是否符合业务；哪些事件属于 `HIGH`。
6. **数据保留**：回调 30 天、投递 90 天、通知 180 天是否满足审计要求。
7. **权限粒度**：15 个权限码是否过多；是否需要把渠道与账号合并。
8. **员工自助**：绑定入口放在个人资料弹窗是否合适；是否需要独立的「通知设置」页面。
9. **链接消息**：是否在阶段 1 就支持跳回系统页面，还是延后到阶段 3。
10. **表与字段命名**：`assistant_*` 前缀与状态枚举命名是否与后续通知中心统一。
11. **内容留存**：`rendered_content` 是否长期保存；若含业务数据，是否只保留哈希或摘要。
12. **回调报文**：原始 `content` 是否允许入库 30 天；是否需要更短的保留期或字段级脱敏。
