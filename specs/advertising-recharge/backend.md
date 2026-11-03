# 广告账户充值后端设计

## 1. 模块边界

```text
server/src/modules/advertising-recharges/
  advertising-recharge.contract.ts        状态、权限码、编号、媒体用途与限额
  advertising-recharge.errors.ts          错误码 + 资金错误翻译
  advertising-recharge.logic.ts           金额/币种/文本规范化、幂等哈希、展示文件名
  advertising-recharge.dto.ts             请求/响应 DTO 与 Swagger 注解
  advertising-recharge-document.service.ts 二维码与付款截图的暂存/认领/读取
  advertising-recharge.service.ts         提交/撤回/驳回/付款/作废
  advertising-recharge-query.service.ts   本人与全量读模型
  advertising-recharge.controller.ts      路由与契约装饰器
  advertising-recharge.module.ts          依赖 Prisma/Auth/Media/Numbering/FundAccounts
```

资金域新增 `server/src/modules/fund-accounts/application/fund-advertising-recharge.ts`，并在 `fund-posting.service.ts` 与 `fund-source-snapshot.ts` 登记来源。

## 2. 接口

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/advertising-recharges/me` | `read-self` | 本人分页列表，支持状态与关键词 |
| GET | `/advertising-recharges/me/:id` | `read-self` | 本人详情 |
| GET/HEAD | `/advertising-recharges/me/:id/qr-content` | `read-self` | 本人二维码 |
| GET/HEAD | `/advertising-recharges/me/:id/payment-proof-content` | `read-self` | 本人付款截图 |
| POST | `/advertising-recharges` | `create` | 提交申请，需 `Idempotency-Key` |
| POST | `/advertising-recharges/qr-uploads` | `create` | 上传收款二维码（multipart，IMAGE） |
| POST | `/advertising-recharges/:id/withdrawals` | `create` | 撤回本人待付款申请 |
| GET | `/advertising-recharges` | `read` | 财务全量分页列表 |
| GET | `/advertising-recharges/:id` | `read` | 财务详情 |
| GET/HEAD | `/advertising-recharges/:id/qr-content` | `read` | 二维码 |
| GET/HEAD | `/advertising-recharges/:id/payment-proof-content` | `read` | 付款截图 |
| POST | `/advertising-recharges/:id/payment-proofs` | `pay` | 上传付款截图 |
| POST | `/advertising-recharges/:id/payments` | `pay` | 登记付款并入账 |
| POST | `/advertising-recharges/:id/rejections` | `pay` | 驳回 |
| POST | `/advertising-recharges/:id/voids` | `pay` | 作废并冲正 |

路由声明顺序：`me` 与 `me/:id` 必须在 `:id` 之前，避免 `me` 被当成申请 id。

## 3. 读模型

`AdvertisingRechargeDto` 是单一聚合：基础字段 + `applicant`（带 `avatarUrl`）+ `paymentQr` + `payment` + `reject` + `withdrawnAt` + `void`。只有对应状态才返回付款/驳回/作废子对象，前端不需要自己拼状态。

列表返回 `statusCounts`：按基础范围（本人或全量）与关键词分组计数，不受当前状态筛选影响，前端一次请求即可渲染页签计数。

## 4. 错误码

| 码 | 场景 |
|---|---|
| `ADVERTISING_RECHARGE_NOT_FOUND` | 申请不存在或不属于本人 |
| `ADVERTISING_RECHARGE_STATE_CHANGED` | 版本号不一致 / 并发冲突 |
| `ADVERTISING_RECHARGE_STATUS_NOT_ALLOWED` | 当前状态不允许该动作 |
| `ADVERTISING_RECHARGE_VALIDATION_FAILED` | 内容或原因不合法 |
| `ADVERTISING_RECHARGE_AMOUNT_INVALID` | 金额格式或非正数 |
| `ADVERTISING_RECHARGE_ACCOUNT_UNAVAILABLE` | 申请人无资金账户/分成比例，或规则不可用 |
| `ADVERTISING_RECHARGE_QR_REQUIRED` | 个人户缺少二维码 |
| `ADVERTISING_RECHARGE_QR_INVALID/TOO_LARGE/UNAVAILABLE` | 二维码上传或认领失败 |
| `ADVERTISING_RECHARGE_PROOF_INVALID/REQUIRED/TOO_LARGE/UNAVAILABLE` | 付款截图问题 |
| `ADVERTISING_RECHARGE_NUMBER_UNAVAILABLE` | 编号规则不可用 |
| `ADVERTISING_RECHARGE_POSTING_UNAVAILABLE` | 资金规则不可用 |
| `ADVERTISING_RECHARGE_IDEMPOTENCY_CONFLICT` | 同一幂等键内容不同 |
| `ADVERTISING_RECHARGE_CONFLICT` | 唯一约束冲突 |

资金错误统一翻译：账户/比例/规则配置类映射为 `ACCOUNT_UNAVAILABLE`，其余映射为 `POSTING_UNAVAILABLE`，并发映射为 `STATE_CHANGED`。

## 5. 媒体

- `ADVERTISING_RECHARGE_QR`：池 `payment-recipient`，申请人上传。
- `ADVERTISING_RECHARGE_PAYMENT_PROOF`：池 `voucher`，财务上传。
- 暂存时只标记 `upload_purpose`；提交/付款事务内认领：锁媒体行、校验上传人/用途/图片类型/大小/对象键、核对对象字节与 SHA-256、必要时激活。
- 内容读取复用 `MediaContentDeliveryService`，`Cache-Control: private, no-store`。
- `MediaAssetReferenceRepository` 与数据库延迟触发器同步扩展，防止回收仍被引用的图片。

## 6. 编号

`ADVERTISING_RECHARGE_NO`：`FIXED 'AD' + '/' + DATE YYYYMMDD + '-' + SEQUENCE(4)`，`YEARLY`，`Asia/Shanghai`；consumer `ADVERTISING_RECHARGE.CREATE`。种子 `config_fingerprint` 由 `calculateNumberingConfigFingerprint` 计算并写入迁移。

## 7. 测试

- `advertising-recharge.logic.spec.ts`：金额/币种/文本/幂等哈希/文件名。
- `advertising-recharge-schema.spec.ts`：枚举、约束、触发器、编号、来源、权限、媒体用途。
- `test/advertising-recharge.e2e-spec.ts`：提交、幂等、二维码形状、列表隔离、撤回/驳回、付款 30/70 分摊、作废全额冲正、无账户拒绝。
