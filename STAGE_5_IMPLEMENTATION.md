# Stage 5 — Inbox Operations + Leads + Webhook Loop

Rewrites the two runtime-broken modules (`conversations`, `leads`) to match the
real Prisma schema and **closes the campaign delivery loop**: outbound sends are
mirrored into conversations, and inbound/status webhooks update them.

## What was broken (and is now fixed)
Both modules were stubbed against an imagined schema and would throw at runtime:
- **leads**: referenced a non-existent `leadNote` model and `value`/`metadata`/
  `reason` fields and an `assignedUser` relation.
- **conversations**: referenced `subject`, `tags`, an `assignedUser` relation,
  and message fields `isFromUser`/`mediaUrl`/`mediaType`/`templateId`/`templateParams`.

No schema change was needed — the real models already existed; the code was wrong.

## Code

### `src/modules/leads/`
- Schemas/service/routes rewritten against the real `Lead` model
  (`fullName`, `phone`, `email`, `status` `AppLeadStatus`, `source` `AppLeadSource`,
  single `notes` text field).
- `createLead` accepts a `contactId` (derives name/phone) **or** explicit
  `fullName`+`phone`. Notes are kept as a timestamped, newline-separated log
  (`appendNote`) since there is no separate note model. Status updates can append
  a note; `assign` validates the user is in the workspace.
- Endpoints: `GET /leads`, `POST /leads`, `GET /leads/:id`,
  `PATCH /leads/:id/status`, `POST /leads/:id/notes`, `POST /leads/:id/assign`,
  `GET /leads/contact/:contactId`.

### `src/modules/conversations/`
- Schemas/service/routes rewritten against `Conversation` / `ConversationMessage`
  / `ConversationNote` / `ConversationEvent` (status enum `open|pending|resolved`,
  `direction` enum, `unreadCount`, `lastMessagePreview`/`lastMessageAt`).
- `assignConversation` / `updateConversation` write a `ConversationEvent` for the
  timeline; `addMessage` records an agent outbound message; `markConversationAsRead`
  zeroes `unreadCount`.
- Endpoints: `GET /conversations`, `GET /:id` (timeline: messages + notes +
  events), `PATCH /:id`, `POST /:id/messages`, `POST /:id/assign`,
  `POST /:id/notes`, `POST /:id/mark-read`.

### `src/modules/conversations/conversations.ingest.ts` (new — shared ingest)
The single place inbound/outbound messages and delivery status are reconciled, so
webhook and campaign code stay consistent:
- `resolveWorkspaceIdByPhoneNumberId` — map `phone_number_id` → workspace.
- `findOrCreateConversation` — upsert a conversation by `(workspaceId, phone)`,
  linking a matching contact.
- `recordInboundMessage` — append inbound message (idempotent by `metaMessageId`),
  bump unread/preview, refresh contact recency, and honor **STOP/UNSUBSCRIBE**
  opt-out keywords (Stage 2 consent integration).
- `recordOutboundMessage` — mirror a sent message into the timeline.
- `applyMessageStatusByMetaId` — apply a Meta status to **both** the
  `CampaignRecipient` (mapped to `sent|delivered|failed`) and the
  `ConversationMessage` (raw status), matched by `metaMessageId`.

### Webhook wiring (`src/metaWebhook.ts`)
The previously no-op `persistWhatsAppWebhookEvent` / `persistLeadgenWebhookEvent`
are implemented:
- WhatsApp: resolve workspace → ingest inbound messages → apply delivery statuses.
- Leadgen: resolve workspace via `MetaLeadSourceMapping` (page/ad) → create a
  `Lead` (idempotent on the unique `metaLeadId`).

### Campaign engine (`src/modules/campaigns/campaigns.service.ts`)
On each successful send, `dispatchCampaign` now calls `recordOutboundMessage`, so
the template appears in the contact's conversation and the delivery webhook can
flip it to `delivered`.

## The delivery loop (end to end)
1. Campaign send → `CampaignRecipient.metaMessageId` stored + outbound
   `ConversationMessage` created with the same id.
2. Meta posts a status webhook (`{ id: <metaMessageId>, status: "delivered" }`).
3. `applyMessageStatusByMetaId` flips the recipient to `delivered` and the
   conversation message status to `delivered`.

## Testing
`scripts/e2e-stage2-3.ts` now covers Stage 2 + 3 + 4 + 5 — **80 assertions**,
green and deterministic across repeated runs:
```bash
npx tsx scripts/e2e-stage2-3.ts   # -> 80 passed, 0 failed
```
Stage 5 assertions: leads CRUD (create-from-contact, status+note, assign,
by-contact, rejections); conversations (list/detail timeline, note, agent message,
assign, status, mark-read); webhooks (inbound message recorded, **delivery status
→ recipient + conversation message delivered**, inbound **STOP → contact opted out**).

> The suite seeds a `WhatsAppConnection` (phone_number_id → workspace) via Prisma
> so the webhook can resolve the workspace, then posts synthetic Meta webhook
> envelopes to `POST /meta/webhook` (no signature header needed unless
> `META_APP_SECRET` is set). Processing is async, so assertions poll.

## Known limitations / follow-ups
- Webhook dedup uses an in-memory stub (`claimWebhookEvent`); idempotency is
  enforced downstream (message `metaMessageId` check, recipient `updateMany`,
  unique `metaLeadId`). Persistent dedup via `ProcessedWebhookEvent` is a Stage 1
  follow-up.
- `addMessage` / agent replies record into the timeline but do not send via Meta
  (use `POST /meta/send-reply` for real sends).
- Lead auto-creation from inbound WhatsApp conversations is not automatic (only
  via leadgen ads or the API); wire into automation rules later.
- `delivered` covers Meta `delivered` and `read` for the recipient enum (no
  separate `read` state on `CampaignRecipient`).
