# EP-BR-SEC-01 — Browser Transaction Security Containment Evidence Pack

## 范围与基线

- Baseline：`origin/main` / `a469c9f5b95b1214bd0fe32f6e5a0eb56a31c5f2`
- Implementation worktree：`/Users/jason/worktrees/ep-br-sec-01`
- Implementation branch：`feat/ep-br-sec-01-transaction-security`
- 本包只处理已证实且可在既定边界内独立收口的浏览器交易风险；不修改顾客屏、Schema、打印链、Desktop Runtime 或 Provider。

## 调用链与风险确认

### 生产开发身份头

`lib/context.ts` 在签名 `auth-session` 不可用时会读取 `x-tenant-id`、`x-user-id`、`x-store-id` 与 `x-role`。修复前该回退没有生产环境条件，客户端可伪造这些头建立 `RequestContext`。

### KHQR 缺配置自动 PAID

`POST /api/cashier/sales` 在 `findKhqrConfig()` 返回空值时设置 `khqrFallback`，随后将 `paymentMethod === 'CASH' || khqrFallback` 作为 `PaymentIntent.status = PAID` 的依据。门店未上传系统图片并不代表顾客已经付款；该门店仍可能使用柜台实体收款码。

### Shinhan GET 回调

`GET /api/payments/shinhan/callback` 曾直接委托给 `POST`，所以 URL 查询参数可以触发支付状态写入。

### StoreCode 写入 fallback

`lib/desktop-pos-auth.ts` 的 `allowStoreCodeFallback` 与 `x-lightops-client: desktop-pos` 组合，曾把公开 `storeCode` 升格为 OWNER 写入权限，影响 `/api/cashier/sales`、`member-balance-pay`、`offline-sync` 和订单状态写入。

本轮已在这四条写路径关闭 fallback。`/cashier` 已有的 `posDeviceHeaders()` 会携带 `pos-device-v1` 与 deviceId，且设备未授权时已有授权/重新授权 UI；因此不需要读取或暴露 Desktop Runtime 的 `edt_v1`，也不需要新增 Desktop credential bridge。没有 `pos-device-v1` 的旧浏览器收银端需要完成一次既有的设备授权迁移，这是一次性迁移问题，不是架构阻塞。

### 已识别但未猜测实现的 Shinhan 签名验证

仓库仅有发起 deeplink 请求的 `buildShinhanHash()`，其输入是商户 ID、商户名称、交易号、金额、货币和时间戳。现有 callback 规范化结果不含可验证的 hash/signature、merchantId 或 currency，仓库也没有供应商回调协议文档。不能据此推断回调签名字段、编码、时间窗或密钥用途。POST 签名验证及 `signatureVerified` 的真实赋值必须待 Shinhan 正式回调规范后单独实施。

## 已实施的安全控制

1. `getContext()` 在 `NODE_ENV === 'production'` 时于读取任何 `x-*` 开发身份头前直接返回 `null`；签名会话仍保持原有优先级，非生产测试/开发回退保持可用。
2. 新增 `lib/cashier-payment-confirmation.ts` 作为可测试的纯判定：现金保持即时 PAID；KHQR 只有 `manualPaymentConfirmed === true` 才能成为 PAID。
3. `/api/cashier/sales` 要求 KHQR 请求带有该明确人工确认；缺失时返回 `409 MANUAL_PAYMENT_CONFIRMATION_REQUIRED`，不会写入销售或 PaymentIntent。系统 KHQR 图片是否存在不参与支付状态判定。
4. 既有收银末步按钮原本已经显示「确认 KHQR 已收款，完成销售」。只在该既有提交动作中附加 `manualPaymentConfirmed: true`，未改变页面布局、文案、商品、金额或操作顺序。
5. Shinhan callback 的 GET 现在返回 `405` 且 `Allow: POST`，不再有状态写入路径。

## KHQR 人工确认保留

- 门店配置静态 KHQR 图片时，员工仍通过原有最终确认动作完成收款。
- 门店未配置系统内图片时，员工仍可使用柜台打印实体码；只有点击原有最终「确认已收款」动作后才创建 PAID。
- 本包没有生成动态 KHQR，没有将缺配置当作自动支付成功，也没有修改 PaymentIntent/SaleRecord 金额计算。

## 验证原始输出

- [定向测试原始输出](ep-br-sec-01-evidence/01-focused-tests.txt)
- [TypeScript 原始输出](ep-br-sec-01-evidence/02-typescript.txt)
- [production build 原始输出](ep-br-sec-01-evidence/03-production-build.txt)
- [diff 检查原始输出](ep-br-sec-01-evidence/04-diff-check.txt)
- [最终定向测试、TypeScript 与 diff 原始输出](ep-br-sec-01-evidence/05-final-focused-types-and-diff.txt)

定向测试覆盖：生产语义下伪造开发身份头无效、非生产受控 fallback、KHQR 人工确认状态判定和页面/路由接线、GET callback 的 405 行为。FIX-01 的真实运行时测试补充覆盖四条 storeCode 伪造写入拒绝、有效/篡改/设备不匹配/门店不匹配/过期 `pos-device-v1` 与正常交易回归。`pos-device-v1` 是无状态 HMAC，仓库没有服务端撤销表或撤销校验；不得把已撤销 token 覆盖宣称为已通过。

## 边界检查

- 未修改 `prisma/**`、migration、顾客屏、邀请页、商品/价格/购物车、打印链、Desktop Runtime、Windows Provider、BroadcastChannel 或支付 Provider。
- 未修改 Desktop Runtime，也没有暴露或转发 `edt_v1`；四条写入路由仅关闭 `allowStoreCodeFallback`，三个只读 fallback 保持不变。
- 未输出或写入环境变量、token、secret、私钥、数据库连接串、cookie 或个人数据。

## Security Gate 待决项

1. 旧浏览器收银端如未持有 `pos-device-v1`，需要完成现有的一次性设备授权；这不是 Desktop Runtime 或架构设计阻塞。
2. 提供 Shinhan callback 的正式签名协议（字段、canonicalization、编码、hash 算法、时间窗和重放语义）；完成后才能验证 POST callback 并将 `signatureVerified` 置为真实结果。

## 结论

本分支已关闭四条写路径的 StoreCode fallback；Shinhan callback 签名验证仍不在本轮范围内，因此不得将本分支表述为完整支付安全 Gate 的通过依据。
