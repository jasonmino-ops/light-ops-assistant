# EP-MB2-02 Checksums

This file records the checksum policy for the evidence pack.

The final zip archive cannot contain a self-referential checksum without changing its own bytes. Therefore the final archive size, MD5, and SHA-256 are recorded in:

- `ES-MB2-ACCEPTANCE-002 Device Runtime Acceptance Record V1.0.md`
- `ES-MB2-FREEZE-002 Device Runtime Freeze Record V1.0.md`

## Final Evidence Pack

Path:

```text
docs/milestone-b/EP-MB2-02-Device-Runtime-Review-Evidence-Pack-08bd792-final.zip
```

Reviewed implementation HEAD:

```text
08bd792deff3e6f83719cbad9a1da2ab81815a18
```

## Included Source Boundary

The evidence source copy is rooted at:

```text
docs/milestone-b/ep02-review-evidence/source
```

Root Web typecheck excludes this source copy through exact `tsconfig.json` entries.
