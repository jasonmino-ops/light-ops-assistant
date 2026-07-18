# EP-MB3-07B1 Windows Verification Checklist

## CI Gates

- Install Contract dependencies.
- Build Contract.
- Install Desktop dependencies.
- Install Provider dependencies.
- Verify exact Provider commit.
- Build Provider artifact.
- Stage Provider artifact for Desktop packaging.
- Type check.
- Activation focused tests.
- Deployment diagnostics focused tests.
- Full unit tests.
- Compile main, preload, and renderers.
- Verify local renderer dist assets.
- Static security scans.
- Release foundation policy.
- Electron safeStorage smoke.
- Provider supervision pipe integration.
- Electron runtime Provider smoke with spaces.
- Verify no surviving Provider process.
- Build Windows installer, unsigned.
- Verify packaged local renderer assets.
- Verify packaged Provider resource.
- Generate release foundation manifests.

## Manual B1 Field Checks

- Disconnect network after activation and confirm employee window shows the local deployment error renderer in the same window.
- Click Retry and confirm the same employee window restores the Cloud POS page after network recovery.
- Confirm no second employee fault window is created.
- Confirm activation failure stays in the activation window and does not load the deployment error renderer.
- Simulate customer display Cloud load failure and confirm customer fallback contains only brand, temporary unavailable text, reconnecting text, and time.
- Confirm customer window remains the same window and restores the Cloud display page automatically.
- Confirm Provider recheck does not start or restart Provider.
- Confirm diagnostics export uses native save dialog and creates a ZIP under 20MB.
- Confirm exported ZIP contains only approved files.
- Confirm logs button opens the log directory and accepts no renderer path input.

## Windows CI Result

Pending until this branch is pushed and the `desktop-windows-build` workflow completes.
