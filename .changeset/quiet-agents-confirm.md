---
'@easy-editor/core': minor
---

Add opt-in host-approved Agent MessagePort execution so peers can prepare plans
without receiving commit authority. Host sessions can approve and execute the
exact prepared plan after reading its authoritative preview and completing an
application-level confirmation step.

Record `approvalSource: 'host'` consistently on the resulting receipt, audit
record, and committed event, and move the Dashboard confirmation flow behind a
behavior-tested coordinator that never retries or executes after rejection,
abort, or expiry.
