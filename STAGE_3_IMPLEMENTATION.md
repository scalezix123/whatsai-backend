# Stage 3 — Template Manager

Implements the Phase 1 Stage 3 goals: variable extraction from template content,
parameter-mapping validation before send, preview rendering, an approval
workflow (draft → pending → approved/rejected), and a Meta status-sync hook.

## What changed

### Schema (`prisma/schema.prisma`)
- `TemplateStatus` enum: added `draft` (now `draft | pending | approved | rejected`).
- `MessageTemplateCategory` enum: added `authentication` (now `marketing | utility | authentication`).
- `MessageTemplate` extended with: `headerType`, `headerText`, `footerText`,
  `buttons` (Json), `variables` (Json), `variableCount`, `exampleValues` (Json),
  `metaTemplateId`, `rejectionReason`, `syncedAt`. New status default is `draft`.
  Added `@@index([workspaceId, status])` and `@@index([workspaceId, category])`.

> Applied with `npm run prisma:push` (this project uses db-push, not migrations).
> All changes are additive — existing templates/campaigns are unaffected.

### Code (`src/modules/templates/`)
- **`templates.utils.ts`** *(new)* — pure functions, no DB:
  - `extractVariables(template)` — unique ascending placeholder tokens (`{{1}}`,
    `{{2}}`...) found across **body, text header, and button URLs**.
  - `validateTemplateParameters(template, params)` — returns
    `{ valid, required, provided, missing, unexpected, nonSequential }`.
    `nonSequential` flags Meta-illegal gaps like `{{1}}, {{3}}`.
  - `renderTemplatePreview(template, params)` — substitutes values into header,
    body, and button URLs; missing values fall back to the token.
- **`templates.schemas.ts`** — rewritten to match the real DB enums
  (`marketing/utility/authentication`, lowercase) and structured header/buttons.
  Enforces Meta naming rule (`^[a-z0-9_]+$`) and field length limits.
- **`templates.service.ts`** — CRUD with derived `variables`/`variableCount`,
  status-aware editing (can't edit while `pending`; editing a `rejected` template
  resets it to `draft`), submission guard (every variable needs an example value),
  and a `syncTemplatesWithMeta` stub that stamps `syncedAt`.
- **`templates.routes.ts`** — adds `GET /:id/variables`, `POST /:id/validate`,
  `POST /:id/preview` alongside the existing CRUD/submit/sync routes.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/templates` | list (search, `category`, `status`, paginate) |
| POST | `/templates` | create (status `draft`, variables auto-derived) |
| GET | `/templates/:id` | get one |
| PATCH | `/templates/:id` | update (re-derives variables) |
| DELETE | `/templates/:id` | delete |
| GET | `/templates/:id/variables` | placeholders + stored examples |
| POST | `/templates/:id/validate` | validate a parameter map |
| POST | `/templates/:id/preview` | render preview with parameters/examples |
| POST | `/templates/:id/submit` | draft/rejected → pending |
| POST | `/templates/sync/meta` | reconcile statuses with Meta (stub) |

## Testing steps

Prereqs: `npm run dev`, `export BASE=http://localhost:3001`, and sign up once
(see `STAGE_2_TESTING.md` §0.1) to establish the session.

```bash
# 1. Create a template with header, body, footer, a URL button, and examples
TID=$(curl -s -X POST $BASE/templates -H "Content-Type: application/json" -d '{
  "name":"order_update",
  "category":"utility",
  "language":"en",
  "headerType":"text",
  "headerText":"Order update for {{1}}",
  "body":"Hi {{1}}, your order {{2}} ships today. Reply STOP to opt out.",
  "footerText":"Acme Inc",
  "buttons":[{"type":"URL","text":"Track","url":"https://acme.io/t/{{3}}"}],
  "exampleValues":{"{{1}}":"Alice","{{2}}":"#1042","{{3}}":"abc123"}
}' | jq -r '.data.id')
echo "template=$TID"
```
**Expect:** `201`; response `status:"draft"`, `variableCount:3`,
`variables:["{{1}}","{{2}}","{{3}}"]`.

```bash
# 2. Inspect extracted variables
curl -s $BASE/templates/$TID/variables | jq
# -> { variables:["{{1}}","{{2}}","{{3}}"], variableCount:3, examples:{...} }

# 3. Validate a COMPLETE parameter map
curl -s -X POST $BASE/templates/$TID/validate -H "Content-Type: application/json" \
  -d '{"parameters":{"{{1}}":"Bob","{{2}}":"#9","{{3}}":"z9"}}' | jq '.data | {valid, missing}'
# -> { valid: true, missing: [] }

# 4. Validate an INCOMPLETE map (missing {{2}}, {{3}})
curl -s -X POST $BASE/templates/$TID/validate -H "Content-Type: application/json" \
  -d '{"parameters":{"{{1}}":"Bob"}}' | jq '.data | {valid, missing, unexpected}'
# -> { valid: false, missing: ["{{2}}","{{3}}"], unexpected: [] }

# 5. Preview (uses stored examples when no params passed)
curl -s -X POST $BASE/templates/$TID/preview -H "Content-Type: application/json" \
  -d '{}' | jq
# -> header/body/buttons with example values substituted

# 6. Submit for approval -> pending
curl -s -X POST $BASE/templates/$TID/submit | jq '.data.status'   # -> "pending"

# 7. Editing while pending is blocked
curl -s -X PATCH $BASE/templates/$TID -H "Content-Type: application/json" \
  -d '{"body":"changed"}' | jq
# -> error: "Cannot edit a template that is pending Meta approval"

# 8. Submission guard: a template with a variable but NO example is rejected
T2=$(curl -s -X POST $BASE/templates -H "Content-Type: application/json" \
  -d '{"name":"no_example","category":"marketing","body":"Hi {{1}}"}' | jq -r '.data.id')
curl -s -X POST $BASE/templates/$T2/submit | jq
# -> error: "Provide example values for all variables before submitting: {{1}}"

# 9. List + filter
curl -s "$BASE/templates?status=pending" | jq '.data.total'
curl -s "$BASE/templates?category=utility&search=order" | jq '.data.templates[].name'

# 10. Meta sync stub
curl -s -X POST $BASE/templates/sync/meta | jq
# -> { synced: N, syncedAt: "...", note: "..." }
```

### Acceptance checklist
- [ ] Create derives `variables`/`variableCount` from header + body + button URLs
- [ ] `GET /:id/variables` returns the placeholder list and examples
- [ ] `POST /:id/validate` reports `missing`/`unexpected`/`nonSequential`
- [ ] `POST /:id/preview` substitutes values (params override stored examples)
- [ ] `submit` moves draft → pending; blocks editing while pending
- [ ] `submit` is blocked when any variable lacks an example value
- [ ] Editing a `rejected` template resets it to `draft`
- [ ] List filters by `category` and `status`

## Known limitations / follow-ups
- **Meta Graph API not wired.** `submit` moves to `pending` locally and
  `sync/meta` only stamps `syncedAt`. Plug the real `message_templates` POST and
  status fetch into `submitTemplateForApproval` / `syncTemplatesWithMeta`, storing
  `metaTemplateId` and `rejectionReason`.
- **Campaign send-time validation.** `validateTemplateParameters` is ready to be
  called by the Stage 4 campaign engine before dispatch — not yet wired in.
- Header media (image/video/document) is modeled via `headerType` but no media
  handle/upload is stored yet.
