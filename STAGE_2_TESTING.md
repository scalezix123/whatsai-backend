# Stage 2 — CRM Foundation: Testing Guide

End-to-end manual test steps for the Stage 2 contact/CRM endpoints. Uses `curl`
against a locally running server. Adapt the JSON to your needs.

## 0. Prerequisites

```bash
# From whatsai-backend/
npm run prisma:push      # ensure DB schema is current
npm run dev              # starts on http://localhost:3001
export BASE=http://localhost:3001
```

> **Auth note:** Protected routes use `requireSession`, which resolves the
> single "primary" `AppSession`. You become "logged in" by signing up once —
> after that the session's `currentUser` supplies the workspace context, and the
> value of the `Authorization` header is not checked. If you get
> `{"error":{"message":"Session required"}}`, run the signup step first.

### 0.1 Establish a session

```bash
curl -s -X POST $BASE/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"name":"Tester","email":"tester@example.com","password":"Password123!"}' | jq
```

A successful signup sets the primary session. All subsequent calls below will
resolve to that user's workspace.

### 0.2 Sanity checks (no auth)

```bash
curl -s $BASE/health | jq                  # { status: "ok", ... }
curl -s $BASE/api-spec.json | jq '.info'    # OpenAPI document
# open in browser: $BASE/api-docs           # Swagger UI
```

---

## 1. Contact CRUD

### 1.1 Create a contact
```bash
curl -s -X POST $BASE/contacts \
  -H "Content-Type: application/json" \
  -d '{"name":"Alice Smith","phone":"+1 (555) 123-4567","email":"alice@example.com","optInStatus":"opt_in"}' | jq
```
**Expect:** `201`, `data.id` present, `phone` normalized to `+15551234567`.

### 1.2 Duplicate phone is rejected
```bash
curl -s -X POST $BASE/contacts \
  -H "Content-Type: application/json" \
  -d '{"name":"Alice Dup","phone":"+15551234567"}' | jq
```
**Expect:** error about an existing phone in the workspace.

### 1.3 Validation failure (short phone)
```bash
curl -s -X POST $BASE/contacts \
  -H "Content-Type: application/json" \
  -d '{"name":"Bad","phone":"123"}' | jq
```
**Expect:** Zod validation error ("Phone must be at least 10 digits").

### 1.4 List with pagination + search + filter
```bash
curl -s "$BASE/contacts?page=1&limit=20" | jq '.data | {total, page, limit}'
curl -s "$BASE/contacts?search=alice" | jq '.data.contacts[].name'
curl -s "$BASE/contacts?optInStatus=opt_in" | jq '.data.total'
```
**Expect:** `total` count, paginated `contacts[]`, search matches by name/phone/email.

### 1.5 Get one (save the id)
```bash
CID=$(curl -s "$BASE/contacts?search=alice" | jq -r '.data.contacts[0].id')
curl -s $BASE/contacts/$CID | jq '.data | {id, name, phone, optInStatus}'
```

### 1.6 Update
```bash
curl -s -X PATCH $BASE/contacts/$CID \
  -H "Content-Type: application/json" \
  -d '{"name":"Alice S. Updated"}' | jq '.data.name'
```
**Expect:** `"Alice S. Updated"`.

### 1.7 Delete (run last, or recreate after)
```bash
curl -s -o /dev/null -w "%{http_code}\n" -X DELETE $BASE/contacts/$CID
```
**Expect:** `204`.

---

## 2. Tags

```bash
# Create tag definitions
curl -s -X POST $BASE/contacts/tags -H "Content-Type: application/json" \
  -d '{"name":"VIP","color":"#FF0000"}' | jq
curl -s -X POST $BASE/contacts/tags -H "Content-Type: application/json" \
  -d '{"name":"Lead"}' | jq

# List tags
curl -s "$BASE/contacts/tags/list" | jq '.data'

# Assign a tag to a contact
curl -s -X POST $BASE/contacts/$CID/tags/VIP | jq

# Filter contacts by tag
curl -s "$BASE/contacts?tags=VIP" | jq '.data.total'

# Remove a tag
curl -s -o /dev/null -w "%{http_code}\n" -X DELETE $BASE/contacts/$CID/tags/VIP
```
**Expect:** tag created, listed, assignable, filterable; removal returns `204`.

---

## 3. Custom Attributes

```bash
# Define an attribute
curl -s -X POST $BASE/contacts/attributes -H "Content-Type: application/json" \
  -d '{"name":"company","type":"string","isRequired":false}' | jq

# Set a value on a contact
curl -s -X POST $BASE/contacts/$CID/attributes -H "Content-Type: application/json" \
  -d '{"contactId":"'$CID'","attributeName":"company","value":"Acme Inc"}' | jq

# Verify it shows on the contact
curl -s $BASE/contacts/$CID | jq '.data.attributes'
```
**Expect:** attribute defined, value stored and visible on the contact.

---

## 4. Consent Management

```bash
# Opt a contact out (with a reason)
curl -s -X POST $BASE/contacts/$CID/opt-out -H "Content-Type: application/json" \
  -d '{"reason":"user_request"}' | jq '.data | {optInStatus, optedOutAt, optOutSource}'

# Opt a contact back in
curl -s -X POST $BASE/contacts/$CID/opt-in | jq '.data | {optInStatus, optedInAt}'

# Bulk update
curl -s -X POST $BASE/contacts/bulk/update-opt-in -H "Content-Type: application/json" \
  -d '{"contactIds":["'$CID'"],"optInStatus":"opt_out"}' | jq
```
**Expect:** status transitions with correct timestamps; bulk returns a count.

---

## 5. CSV Import

> Current import takes rows as a JSON array in the body (Multer file upload is a
> planned enhancement). `columnMapping` maps source columns to `name`/`phone`/etc.

```bash
# Start an import
BATCH=$(curl -s -X POST $BASE/contacts/import/start -H "Content-Type: application/json" -d '{
  "fileName":"contacts.csv",
  "columnMapping":{"Full Name":"name","Mobile":"phone"},
  "skipDuplicates":true,
  "rows":[
    {"Full Name":"Bob Jones","Mobile":"+15550000001"},
    {"Full Name":"Carol Lee","Mobile":"+15550000002"},
    {"Full Name":"NoPhone Person","Mobile":""}
  ]
}' | jq -r '.data.id')
echo "batch=$BATCH"

# Poll the batch (import runs async)
sleep 1
curl -s $BASE/contacts/import/batches/$BATCH | jq '.data | {status, totalRows, successCount, errorCount}'

# List all batches
curl -s "$BASE/contacts/import/batches" | jq '.data'

# Download the per-row error report (the empty-phone row should appear)
curl -s "$BASE/contacts/import/batches/$BATCH/errors.csv"
```
**Expect:** batch reaches `completed`, 2 successes + 1 error; the error CSV lists
the empty-phone row with a reason. Re-running the same import with
`skipDuplicates:true` should skip the already-imported phones.

---

## 6. Acceptance checklist

- [ ] Create / list / get / update / delete a contact
- [ ] Phone is normalized; duplicate phone rejected
- [ ] List supports pagination, `search`, `optInStatus`, `tags`
- [ ] Tag definition create / list / assign / remove
- [ ] Attribute definition create + set value on contact
- [ ] Opt-in / opt-out with timestamps + reason
- [ ] Bulk opt-in/out update
- [ ] CSV import: success + error counts, async completion, error CSV export
- [ ] `/api-docs` renders; `/api-spec.json` returns the OpenAPI document

---

## Troubleshooting

| Symptom | Cause / Fix |
|---|---|
| `Session required` | Run the signup step (0.1) to set the primary session. |
| `[Queue] Error: ECONNREFUSED 127.0.0.1:6379` | Redis not running locally; harmless for Stage 2 — import runs in-process, not via Bull. |
| `DATABASE_URL is not set` | Ensure `.env` is present in `whatsai-backend/`. |
| Import batch stuck `processing` | Check server logs; row processing errors are written to `ContactImportError`. |
