# Certificate Package

本目录存放随程序携带的 **E-Shop Root Certificate 包**。内容不入 Git。

## 只能放什么

- `manifest.json`
- Root CA 的**公开证书**（PEM，`.crt`）

## 绝对不能放什么

- Root CA 私钥
- Leaf 私钥
- KMS 相关密钥或凭据
- 任何 `.key` / `.p12` / `.pfx` / `.jks`

程序启动时会递归扫描本目录，一旦发现私钥标记就整包拒绝，状态显示为「配置异常」。

## 生产流程

1. 运维在离线环境用 E-Shop Root CA 私钥签发/导出**公开证书**；
2. 把 `.crt` 和按 `manifest.example.json` 填好的 `manifest.json` 放进本目录；
3. `npm run pack:win` 打包，证书包会被放进安装产物的 `resources/certificate-package`。

`manifest.json` 中的 `rootFingerprint` / `validFrom` / `validTo` 必须与证书本身一致，
否则加载时会因为 `PACKAGE_FINGERPRINT_MISMATCH` 等原因被拒绝。

## 验收/开发用测试包

```bash
npm run make:test-package
```

生成一个自签名的 **TEST** Root（CN 明确标注 DO NOT USE IN PRODUCTION）。
私钥只在系统临时目录中短暂存在，脚本结束即销毁，不会落到本目录。
