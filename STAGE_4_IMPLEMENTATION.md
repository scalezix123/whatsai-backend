# Stage 4 — Campaign Engine

Implements queue-ready campaign dispatch with **template parameter validation
wired into the send path**, recipient-level status tracking, wallet charging,
manual retry of failures, scheduling, and a consent gate.

## What changed

### Schema (`prisma/schema.prisma`)
- `Campaign` += `parameters` (Json, shared template values) + `@@index([workspaceId, status])`.
- `CampaignRecipient` += `parameters` (Json, resolved per recipient), `attempts`
  (Int), `metaMessageId`, `error`, `sentAt` + `@@index([campaignId, status])`.
- Applied via `npm run prisma:push` **and** `npx prisma generate` (the running
  server must be restarted so it loads the regenerated client).

### Code (`src/modules/campaigns/`)
- **`campaigns.schemas.ts`** — `createCampaignSchema` now takes `recipients`
  (`[{ contactId, parameters? }]`), a campaign-level `parameters` default,
  `scheduledFor`, and `sendNow`. Added `listCampaignsSchema` (coerced paging).
- **`campaigns.service.ts`** — modern pattern `(workspaceId, input, db)`:
  - `createCampaign` — gates on **approved** template, verifies contacts belong
    to the workspace, **blocks opted-out contacts**, and runs
    `validateTemplateParameters` for every recipient's resolved params. Invalid
    params reject the whole campaign with a per-recipient `details` array. Costs
    the send and checks wallet balance when `sendNow`.
  - `dispatchCampaign` — sends each queued recipient via `deliverMessage`,
    updates `status`/`attempts`/`metaMessageId`/`error`/`sentAt`, and debits the
    wallet **only for messages sent in this pass** (retries never double-charge).
  - `deliverMessage` — calls the real Meta Graph API when a WABA connection +
    active auth exist; otherwise simulates a successful send (dev/test) with a
    synthetic message id.
  - `launchCampaign` — sends a `draft`/`scheduled` campaign now.
  - `retryCampaign` — re-queues only `failed` recipients and re-dispatches.
  - `listCampaigns` / `getCampaign` — list with template + recipient count; detail
    with per-status `stats` ({ total, queued, sent, delivered, failed }).
- **`campaigns.routes.ts`** — `requireSession` on every route:
  `POST /`, `GET /`, `GET /:id`, `POST /:id/launch`, `POST /:id/retry`.
- **`middleware/errorNormalization.ts`** — now surfaces `err.details` so the
  parameter-validation failure returns the per-recipient breakdown.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| POST | `/campaigns` | create (+ send now / schedule); validates params |
| GET | `/campaigns` | list (status filter, paginate) |
| GET | `/campaigns/:id` | detail with recipient `stats` |
| POST | `/campaigns/:id/launch` | dispatch a draft/scheduled campaign |
| POST | `/campaigns/:id/retry` | re-send failed recipients |

## How parameter validation is wired into dispatch
`createCampaign` resolves each recipient's parameters (campaign defaults merged
with per-recipient overrides) and calls
`validateTemplateParameters(template, resolved)` (the Stage 3 util). If any
recipient is missing a `{{n}}` value, has extras, or the template's placeholders
are non-sequential, the campaign is rejected **before any send or charge**, with
`error.details = [{ contactId, missing, unexpected, nonSequential }]`.

## Testing steps
Prereqs: server running, signed up (see `STAGE_2_TESTING.md` §0.1),
`export BASE=http://localhost:3001`. A template must be **approved** to send;
since Meta approval isn't wired, approve one directly for testing:
`UPDATE "MessageTemplate" SET status='approved' WHERE id='<tid>';`

```bash
# Fund the wallet
curl -s -X POST $BASE/wallet/top-up -H "Content-Type:application/json" -d '{"amount":100}' | jq '.data.walletBalance'

# Two opted-in contacts -> C1, C2 (create via /contacts), one opted-out -> C3
# Reject: missing params (only {{1}} provided for a 3-variable template)
curl -s -X POST $BASE/campaigns -H "Content-Type:application/json" -d '{
  "name":"bad","templateId":"<tid>","recipients":[{"contactId":"<C1>"}],
  "parameters":{"{{1}}":"x"},"sendNow":false}' | jq '.error | {message, details}'
# -> details: [{ contactId, missing:["{{2}}","{{3}}"], ... }]

# Reject: opted-out recipient
curl -s -X POST $BASE/campaigns -H "Content-Type:application/json" -d '{
  "name":"x","templateId":"<tid>","recipients":[{"contactId":"<C3>"}],
  "parameters":{"{{1}}":"a","{{2}}":"b","{{3}}":"c"},"sendNow":false}' | jq '.error.message'

# Send now (valid) -> status delivered, both recipients sent, spent 1.0
curl -s -X POST $BASE/campaigns -H "Content-Type:application/json" -d '{
  "name":"Launch","templateId":"<tid>",
  "recipients":[{"contactId":"<C1>"},{"contactId":"<C2>","parameters":{"{{1}}":"Bob"}}],
  "parameters":{"{{1}}":"Alice","{{2}}":"#1042","{{3}}":"trk"},"sendNow":true}' \
  | jq '.data | {status, spent, stats, msgIds:[.recipients[].metaMessageId]}'

# Draft -> launch
CID=$(curl -s -X POST $BASE/campaigns -H "Content-Type:application/json" -d '{"name":"D","templateId":"<tid>","recipients":[{"contactId":"<C1>"}],"parameters":{"{{1}}":"a","{{2}}":"b","{{3}}":"c"},"sendNow":false}' | jq -r '.data.id')
curl -s -X POST $BASE/campaigns/$CID/launch | jq '.data.stats'

# List + detail
curl -s "$BASE/campaigns?page=1&limit=10" | jq '.data.total'
curl -s $BASE/campaigns/$CID | jq '.data.stats'
```

### Automated suite
`scripts/e2e-stage2-3.ts` covers Stage 2 + 3 + 4 (60 assertions) and is
**deterministic** — verified green 3 runs in a row:
```bash
npx tsx scripts/e2e-stage2-3.ts   # -> 60 passed, 0 failed
```
It includes campaign creation, the unapproved-template / missing-params /
opted-out / unknown-contact rejections, send + wallet debit, per-recipient
parameter storage, draft→launch, scheduling, and a real **retry of an injected
failure** (re-sends, increments attempts, no double-charge).

## Acceptance checklist
- [ ] Only approved templates can be sent
- [ ] Per-recipient parameter validation rejects with `details`
- [ ] Opted-out / unknown contacts rejected (consent + integrity gates)
- [ ] `sendNow` dispatches, sets recipient status + metaMessageId, debits wallet
- [ ] `spent` reflects messages actually sent
- [ ] Draft → `launch`; `scheduledFor` → `scheduled` status
- [ ] `retry` re-sends only failed recipients and never double-charges
- [ ] List + detail return per-status `stats`

## Known limitations / follow-ups
- **Bull queue**: dispatch runs in-process (queue-ready). The production path
  enqueues `dispatchCampaign` on the `campaign-dispatch` Bull queue (needs Redis,
  which is not running in this dev env). Logic is identical.
- **Real send** simulates success when no WABA is connected; with a connection it
  calls `sendMetaTemplateMessage` (body params only — header/button params and
  media headers are a follow-up).
- **Scheduler trigger**: `scheduledFor` is stored and `launch` dispatches; a cron
  worker that auto-launches due campaigns is not yet wired.
- **Delivered vs sent**: recipients reach `sent`; `delivered`/`read` will come
  from Stage 5 webhook status updates.
