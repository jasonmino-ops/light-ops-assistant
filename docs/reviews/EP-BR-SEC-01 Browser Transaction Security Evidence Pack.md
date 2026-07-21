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

### 已识别但未跨边界修改的 Desktop 授权缺陷

`lib/desktop-pos-auth.ts` 仍有 `allowStoreCodeFallback` 与 `x-lightops-client: desktop-pos` 组合的降级路径，影响 `/api/cashier/sales`、`member-balance-pay`、`offline-sync` 和订单状态写入等接口。

不能安全地在本包删除该路径：当前已激活 Desktop 的 `edt_v1` 凭据只由 `desktop/src/main/activation/credentialStore.ts` 保存；`desktop/src/main/windowManager.ts` 只以 `loadURL()` 加载 `/desktop/pos`，没有请求头注入或受控 token 转发。浏览器渲染页也不能读取该凭据。删除回退会使已激活的 Desktop 浏览器收银请求失去全部服务端身份；补齐 token 转发需要修改被本包明确冻结的 Desktop Runtime。该项保留给经批准的 Runtime/云端授权协同设计。

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

定向测试覆盖：生产语义下伪造开发身份头无效、非生产受控 fallback、KHQR 人工确认状态判定和页面/路由接线、GET callback 的 405 行为。Desktop 有效/撤销 token、storeCode 伪造写入、以及 Shinhan 缺签名/错误签名的完整运行时用例在本包阻塞项解决前不能诚实宣称通过。

## 边界检查

- 未修改 `prisma/**`、migration、顾客屏、邀请页、商品/价格/购物车、打印链、Desktop Runtime、Windows Provider、BroadcastChannel 或支付 Provider。
- 未修改 `lib/desktop-pos-auth.ts` 或任何 storeCode fallback 调用点，以避免在没有 Runtime token 传递设计的情况下破坏已激活 Desktop。
- 未输出或写入环境变量、token、secret、私钥、数据库连接串、cookie 或个人数据。

## Security Gate 待决项

1. 批准 Desktop Runtime 以受控方式向员工窗口请求提供已激活设备凭据，或批准等价的服务端会话交换设计；完成后才能移除 storeCode fallback 并测试有效/撤销设备令牌。
2. 提供 Shinhan callback 的正式签名协议（字段、canonicalization、编码、hash 算法、时间窗和重放语义）；完成后才能验证 POST callback 并将 `signatureVerified` 置为真实结果。

## 结论

本分支只完成了不依赖上述冻结边界的安全收口。它不能作为完整 Browser Transaction Security Gate 的通过依据。
