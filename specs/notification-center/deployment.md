# 千树小助理部署清单

## 文档信息

| 项目 | 内容 |
| --- | --- |
| 文档状态 | 部署清单，随阶段 1 实施更新 |
| 关联文档 | [落地设计](./design.md)、[数据模型](./data-model.md)、[运维手册](./runbook.md) |
| 适用环境 | 测试环境、生产环境 |
| 最后更新 | 2026-10-28 |

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

1. 通知/渠道枚举与 10 张表。
2. CHECK、部分唯一索引、普通索引。
3. `notification_settings`、`notification_channel_settings`（仅 `ASSISTANT`）、`assistant_dispatch_leases` 种子。
4. 15 个权限码与 `system_admin` 授权。
5. `AuditEventType` 新增值。

迁移后核对：

```sql
-- 参数绑定执行；不要在脚本里拼接值
SELECT COUNT(*) FROM notification_channel_settings WHERE channel = 'ASSISTANT';
SELECT COUNT(*) FROM assistant_dispatch_leases WHERE id = 'assistant-dispatch';
SELECT COUNT(*) FROM permissions WHERE code LIKE 'assistant-%' OR code LIKE 'notification-%';
```

预期：`ASSISTANT` 渠道 1 行且 `enabled = false`；租约 1 行；权限 15 行。

## 4. 管理端初始化

1. 管理员登录，打开「通知中心 > 千树小助理 > 渠道」。
2. 确认 Base URL 为 HTTPS、Token 显示「已配置」，打开渠道开关前的最后一步先做自检。
3. 「账号 > 扫码登录」完成公司号登录；确认状态 `ONLINE`。
4. 「渠道 > 测试」向公司号自己的文件传输助手发一条测试消息，不打扰员工。
5. 「群目标 > 同步群」：同步财务群、运营群，设置 key 与用途，勾选 `internalOnly`。
6. 「通知规则」：确认 3 个事件的模板与策略已存在；阶段 1 只启用 `ASSISTANT`，`IN_APP` 关闭。
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
| 7 | 离线 | 手机端退出公司号 | 60 秒内管理端显示 `OFFLINE`，队列按 TTL 处理 |
| 8 | 恢复登录 | 用上次 `appId` 重新扫码 | 状态恢复 `ONLINE`，自检消息成功 |

注意：步骤 2/3 必须在测试环境或测试数据上执行，不要用生产员工做冒烟。

## 6. 监控与告警

日志字段：`requestId`、`notificationId`、`deliveryId`、`appId`、`eventType`、`attempt`、`ret`、`durationMs`；不记录正文与 Token。

计数器：

- `notification_publish_total{event_type,channel,result}`
- `assistant_delivery_total{status,failure_code}`
- `assistant_account_status{status}`
- `notification_inbox_unread{user_scope}`（阶段 3）

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
