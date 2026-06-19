# Stage 6 — RBAC & Operational/Audit Logs

Wires the existing-but-unused `requireRole` middleware into real authorization,
makes the log helpers actually persist, and exposes admin-only observability +
an audit trail. This completes Phase 1.

## RBAC
- **`role` is now in the session context.** `getWorkspaceContextFromRequestAuthHeader`
  selects and returns `role`, so `requireRole` (which reads
  `req.workspaceContext.role`) finally works — before this it always saw
  `undefined` and would have denied everyone.
- **The workspace owner is an ADMIN.** `createWorkspaceForUser` now sets the first
  user's `role: "ADMIN"` (the `User` model default is `USER`).
- **`requireRole` / `requireSession` return proper status codes** (403 / 401) via
  `err.statusCode`, surfaced by `errorNormalization`.
- **Gated routes** (admin-only): all of `/ops/*` and all of `/admin/*`. Regular
  CRM/campaign/inbox routes stay open to any authenticated user (USER+), so agents
  work normally while only admins see logs and manage members.

## Logging — now persistent (were console-only stubs)
- `logOperationalEvent` writes to `OperationalLog`.
- `logFailedSend` writes to `FailedSendLog` (signature widened to include
  `targetType`/`targetId`/`errorMessage` that callers were already passing).
- New `logAuditEvent({ workspaceId, actorId, action, summary, payload })` —
  records an `OperationalLog` with event type `audit.<action>` and the acting user
  in the payload. All logging is wrapped in try/catch so it never breaks callers.

### Audit events wired in (at the route layer, after success)
| Action | Event type |
|---|---|
| Create/send campaign | `audit.campaign.created` / `audit.campaign.sent` |
| Launch campaign | `audit.campaign.launched` |
| Assign lead | `audit.lead.assigned` |
| Delete contact | `audit.contact.deleted` |
| Change user role / delete user | `audit.user.role_changed` / `audit.user.deleted` |

## Endpoints (admin-only)
| Method | Path | Purpose |
|---|---|---|
| GET | `/ops/logs` | operational + audit logs (filters: `eventType` prefix, `level`, `search`) |
| GET | `/ops/failed-sends` | failed send log (filters: `status`, `channel`) |
| GET | `/ops/webhook-events` | received Meta webhook events |
| POST | `/ops/retry-failed-send` | mark a failed send resolved/retried |
| GET | `/admin/users`, `PATCH /admin/users/:id/role`, `DELETE /admin/users/:id`, `GET /admin/partners` | member management |

`/ops/logs?eventType=audit` returns the whole audit trail (prefix match).

## Testing
Covered by `scripts/e2e-stage2-3.ts` (now **95 assertions**, Stage 2–6),
deterministic — green 4 runs in a row:
```bash
npx tsx scripts/e2e-stage2-3.ts   # -> 95 passed, 0 failed
```
Stage 6 assertions: ADMIN can reach `/admin/*` and `/ops/*`; after demoting the
session user to USER (via Prisma) those routes return **403** while CRUD still
works; restoring ADMIN re-grants access; audit logs are persisted and carry
`actorId` + `audit.*` event type (`campaign.sent`, `contact.deleted`,
`lead.assigned` verified); failed-sends and webhook-events list endpoints return
paginated results.

## Known limitations / follow-ups
- RBAC is two-tier in practice (ADMIN vs USER); `PARTNER` exists in the enum but
  isn't given a distinct route policy yet.
- Audit coverage is the high-value mutations above; extend to template
  approval, consent bulk-updates, and conversation assignment as needed.
- `/ops/webhook-events` reads `MetaWebhookEvent`; persistent raw-event capture +
  dedup (`ProcessedWebhookEvent`) is still the Stage 1 follow-up.
- The single global "primary" session means one active user at a time; per-request
  bearer tokens / real multi-user sessions are a separate auth hardening task.
