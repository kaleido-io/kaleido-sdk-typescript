---
name: Rename wesdk CLI to ksdk
description: After current init fixes are complete, rename the CLI bin from wesdk to ksdk (Kaleido SDK)
type: project
---

Rename the CLI bin entry from `wesdk` to `ksdk` after the init scaffolding fixes are complete.

**Why:** `wesdk` stands for Workflow Engine SDK, but the CLI is broader than just the workflow engine — it scaffolds projects that use multiple Kaleido SDK packages. `ksdk` (Kaleido SDK) is a better fit.

**How to apply:** Change `"bin": { "wesdk": "./bin/wesdk.js" }` → `"bin": { "ksdk": "./bin/wesdk.js" }` in `packages/workflow-engine-sdk/package.json`, update all references in `bin/wesdk.js`, `bin/init.js`, README, CONTRIBUTING, and any docs. Do this after all init scaffolding fixes (Fix 1, 2, 3) are merged.
