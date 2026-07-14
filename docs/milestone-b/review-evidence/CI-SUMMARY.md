# CI Summary

| Check | Status | Evidence |
| --- | --- | --- |
| Windows CI | PASS | GitHub Actions run 29352914573, job 87153342628 |
| Contract Build | PASS | Windows CI Build Contract step success; local `npm --prefix packages/hrt-contract run build` success |
| Desktop Typecheck | PASS | Windows CI Type check step success; local command success |
| Unit Tests | PASS | Windows CI Unit tests step success; local desktop tests 74 passed |
| Compile main & preload | PASS | Windows CI step success |
| Electron Builder | PASS | Windows CI Build Windows installer step success |
| Artifact Upload | PASS | Artifact `eshop-desktop-windows-installer`, id 8318942951 |
| Vercel Preview | PASS | Deployment dpl_EkCtaq3HSo6VY61pbDwytc8ff4ND Ready |
| Preview URL | PASS / protected | URL responds with Vercel SSO 302 due access protection |
