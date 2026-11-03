# 广告账户充值实施任务

## 1. 已完成

| # | 任务 | 产物 |
|---|---|---|
| 1 | Schema：模型、两个枚举、资金来源枚举值、五个审计事件 | `server/prisma/schema.prisma` |
| 2 | 迁移：表/约束/触发器/索引/编号/来源绑定/批次形状/媒体用途/权限/审计 | `server/prisma/migrations/20261102160000_advertising_recharge/migration.sql` |
| 2.1 | 应用迁移到本地开发库时发现两个媒体外键名与 Prisma 推导不一致，补向前修复 | `server/prisma/migrations/20261102170000_advertising_recharge_fk_names/migration.sql` |
| 3 | 资金域：来源常量、受控来源映射、来源快照 kind 与映射 | `fund-advertising-recharge.ts`、`fund-posting.service.ts`、`fund-source-snapshot.ts` |
| 4 | 服务端模块：契约/错误/DTO/逻辑/文档/命令/查询/控制器/模块注册 | `server/src/modules/advertising-recharges/`、`http.modules.ts` |
| 5 | 媒体引用仓储与契约测试扩展 | `media-reference.repository.ts`、两个 spec |
| 6 | 契约同步 | `server/openapi/openapi.json`、`web/openapi/openapi.json`、`types.gen.ts`（忽略） |
| 7 | 前端 API 与页面 | `api/modules/advertising-recharges.ts`、两组页面组件 |
| 8 | 路由、菜单、语言包、品牌图标 | 两个路由模块、`locales/lang/advertising-recharge/`、3 个 SVG + 清单 |
| 9 | 测试 | logic spec、schema spec、e2e、路由测试更新、审计文案 |
| 10 | 文档 | 数据库迁移规范、本 spec 目录 |

## 2. 验证结果

| 检查 | 结果 |
|---|---|
| `server` 单元测试 | 393 套件 / 4353 条通过 |
| `server` 类型检查与 lint | 通过 |
| 迁移重放（临时 PostgreSQL 16） | 147 条迁移全部应用 |
| 全量重放 vs `schema.prisma` | 广告充值表无差异（仓库另有四处既有漂移，见迁移规范记录） |
| 广告充值 e2e | 8 条通过 |
| `web` `test:scripts` | 187 + 50 + 2050 条通过 |
| `web` 类型检查 | 通过 |
| `web` eslint（新增文件） | 无 error |
| 图标清单 | 396 项，一致性测试通过 |
| 本地开发库应用 | 147 条迁移，业务表行数不变，种子与约束全部落库 |
| 页面级浏览器验收 | 通过（一次性 PostgreSQL + 本地服务 + 独立运营/财务账号；见下） |

页面级验收覆盖：

- 运营菜单「网络与广告」只对持有 `network-nodes:read` / `advertising-recharges:read-self` 的角色可见；静态节点显示占位文案。
- 新增申请两步弹窗：个人户默认、美元默认、个人户缺二维码时提交禁用；无资金账户时提交被前置校验拦截；上传二维码后提交成功，第二步显示 `AD/20261103-0001`、金额与三行复制文本（含财务详情链接），复制成功并自动关闭。
- 非个人户不显示二维码字段，提交成功；运营详情抽屉二维码通过私有内容路由正常加载，撤回后状态为「已撤回」。
- 财务菜单「实收实付 → 广告充值」只显示广告充值；列表能看到全部申请人；详情页登记 1000 CNY + 付款截图后变为「已付款」，展示付款人、付款时间与批次号。
- 作废并冲正后状态为「已作废」，保留原付款事实与作废原因；资金批次为反向 `ADVERTISING_RECHARGE.VOID`，个人/公司余额从 -300/-700 回到 0/0。
- 权限隔离：运营直接访问财务详情、财务直接访问运营列表都落到 403；三个新品牌图标在 spritesheet 中均存在。

## 3. 未做与风险

- 迁移只应用到本地开发库（`qianshu_dms_prodcopy`），测试机与生产未应用。
- 页面级验收未覆盖「驳回」按钮的视觉路径（驳回与作废共用原因弹窗，接口层已有 e2e 覆盖）。
- `20261102170000_advertising_recharge_fk_names` 只修正两个媒体外键的约束名；开发库与 schema 还有四处与本功能无关的既有漂移，未在本次处理。
- `ADVERTISING_FEE` 规则可被管理员停用或改比例：付款会失败并给出可读错误，需要财务先核对资金配置。
- 作废为终态，重新付款需重新提交申请（已与需求方确认）。
- 充值金额与付款金额之间没有汇率校验，付款金额由财务按实际支付填写。
