/**
 * End-to-end smoke test for Stage 2 (CRM) + Stage 3 (Templates) + Stage 4
 * (Campaign Engine) against a running server. Run: npx tsx scripts/e2e-stage2-3.ts
 * Uses a unique run id so it can be re-run without duplicate-phone collisions.
 * Uses Prisma directly only to simulate Meta approving a template (no WABA in dev).
 */
import "dotenv/config";
import { prisma } from "../src/prisma";

const BASE = process.env.BASE ?? "http://localhost:3001";
const RUN = Date.now().toString().slice(-9); // unique per run
const J = { "Content-Type": "application/json" };

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    console.log(`  ❌ ${name}`, detail !== undefined ? JSON.stringify(detail) : "");
  }
}

async function req(method: string, path: string, body?: unknown) {
  const res = await fetch(BASE + path, {
    method,
    headers: J,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json: any = null;
  const text = await res.text();
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, json };
}

async function main() {
  console.log(`\n=== E2E Stage 2 + 3 (run ${RUN}) ===`);

  // --- session ---
  console.log("\n[auth]");
  const signup = await req("POST", "/auth/signup", {
    name: "E2E",
    email: `e2e${RUN}@example.com`,
    password: "Password123!",
  });
  check("signup 201", signup.status === 201, signup.status);
  const gate = await req("GET", "/contacts?page=1&limit=1");
  check("session resolves (contacts 200)", gate.status === 200, gate.status);

  // ============ STAGE 2: CONTACTS ============
  console.log("\n[contacts]");
  const phoneFmt = `+1 (555) ${RUN.slice(0, 3)}-${RUN.slice(3, 7)}`;
  const phoneNorm = ("+1555" + RUN.slice(0, 3) + RUN.slice(3, 7)).replace(/[\s\-()]/g, "");
  const create = await req("POST", "/contacts", {
    name: "Alice",
    phone: phoneFmt,
    email: `alice${RUN}@example.com`,
    optInStatus: "opt_in",
  });
  check("create 201", create.status === 201, create.json);
  check("phone normalized on create", create.json?.data?.phone === phoneNorm, create.json?.data?.phone);
  const cid = create.json?.data?.id;

  const dup = await req("POST", "/contacts", { name: "Dup", phone: phoneNorm });
  check("duplicate (diff formatting) rejected", dup.status >= 400, dup.status);

  const bad = await req("POST", "/contacts", { name: "Bad", phone: "123" });
  check("short phone rejected (validation)", bad.status >= 400, bad.status);

  const list = await req("GET", "/contacts?page=1&limit=20");
  check("list with string page/limit works", list.status === 200 && typeof list.json?.data?.total === "number", list.json);
  check("list pageCount present", typeof list.json?.data?.pageCount === "number", list.json?.data?.pageCount);

  const search = await req("GET", `/contacts?search=alice${RUN}`);
  check("search by email finds contact", (search.json?.data?.total ?? 0) >= 1, search.json?.data?.total);

  const filtered = await req("GET", "/contacts?optInStatus=opt_in");
  check("filter optInStatus=opt_in 200", filtered.status === 200, filtered.status);

  const tagFilter = await req("GET", "/contacts?tags=Nope");
  check("single ?tags= value no longer 500s", tagFilter.status === 200, tagFilter.status);

  const upd = await req("PATCH", `/contacts/${cid}`, { name: "Alice Updated" });
  check("update name", upd.json?.data?.name === "Alice Updated", upd.json?.data?.name);

  // --- tags ---
  console.log("\n[tags]");
  const tagName = `VIP${RUN}`;
  const tagDef = await req("POST", "/contacts/tags", { name: tagName, color: "#0AF" });
  check("create tag def 201", tagDef.status === 201, tagDef.json);
  const tagList = await req("GET", "/contacts/tags/list");
  check("list tags 200", tagList.status === 200, tagList.status);
  const assign = await req("POST", `/contacts/${cid}/tags/${tagName}`);
  check("assign tag 2xx", assign.status < 300, assign.status);
  const byTag = await req("GET", `/contacts?tags=${tagName}`);
  check("filter by assigned tag finds 1", (byTag.json?.data?.total ?? 0) >= 1, byTag.json?.data?.total);
  const rmTag = await req("DELETE", `/contacts/${cid}/tags/${tagName}`);
  check("remove tag 204", rmTag.status === 204, rmTag.status);

  // --- attributes ---
  console.log("\n[attributes]");
  const attrName = `plan${RUN}`;
  const attrDef = await req("POST", "/contacts/attributes", { name: attrName, type: "string" });
  check("create attribute def 201", attrDef.status === 201, attrDef.json);
  const setAttr = await req("POST", `/contacts/${cid}/attributes`, {
    contactId: cid,
    attributeName: attrName,
    value: "gold",
  });
  check("set attribute value 2xx", setAttr.status < 300, setAttr.json);
  const withAttr = await req("GET", `/contacts/${cid}`);
  const attrs = withAttr.json?.data?.attributes ?? [];
  check("attribute readable on contact", attrs.some((a: any) => a.value === "gold"), attrs);

  // --- consent ---
  console.log("\n[consent]");
  const out = await req("POST", `/contacts/${cid}/opt-out`, { reason: "user_request" });
  check("opt-out sets status+source", out.json?.data?.optInStatus === "opt_out" && out.json?.data?.optOutSource === "user_request", out.json?.data);
  const inn = await req("POST", `/contacts/${cid}/opt-in`);
  check("opt-in sets status+timestamp", inn.json?.data?.optInStatus === "opt_in" && !!inn.json?.data?.optedInAt, inn.json?.data);
  const bulk = await req("POST", "/contacts/bulk/update-opt-in", { contactIds: [cid], optInStatus: "opt_out" });
  check("bulk opt-out 2xx", bulk.status < 300, bulk.json);

  // --- CSV import ---
  console.log("\n[import]");
  const imp = await req("POST", "/contacts/import/start", {
    fileName: "e2e.csv",
    columnMapping: { "Full Name": "name", Mobile: "phone" },
    skipDuplicates: true,
    rows: [
      { "Full Name": "Imp One", Mobile: `+1666${RUN}01` },
      { "Full Name": "Imp Two", Mobile: `+1666${RUN}02` },
      { "Full Name": "No Phone", Mobile: "" },
    ],
  });
  check("import start 201", imp.status === 201, imp.json);
  const batchId = imp.json?.data?.id;
  // poll for completion
  let batch: any = null;
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 300));
    const b = await req("GET", `/contacts/import/batches/${batchId}`);
    batch = b.json?.data;
    if (batch?.status === "completed" || batch?.status === "failed") break;
  }
  check("import completes", batch?.status === "completed", batch?.status);
  check("import 2 success", batch?.successCount === 2, batch?.successCount);
  check("import 1 error (empty phone)", batch?.errorCount === 1, batch?.errorCount);
  const errCsv = await req("GET", `/contacts/import/batches/${batchId}/errors.csv`);
  check("error CSV downloadable", errCsv.status === 200 && typeof errCsv.json === "string" && errCsv.json.includes("required"), errCsv.json);
  const batchList = await req("GET", "/contacts/import/batches?page=1&limit=10");
  check("list import batches (string paging) 200", batchList.status === 200, batchList.status);

  // ============ STAGE 3: TEMPLATES ============
  console.log("\n[templates]");
  const tpl = await req("POST", "/templates", {
    name: `order_update_${RUN}`,
    category: "utility",
    language: "en",
    headerType: "text",
    headerText: "Order update for {{1}}",
    body: "Hi {{1}}, your order {{2}} ships today. Reply STOP to opt out.",
    footerText: "Acme Inc",
    buttons: [{ type: "URL", text: "Track", url: "https://acme.io/t/{{3}}" }],
    exampleValues: { "{{1}}": "Alice", "{{2}}": "#1042", "{{3}}": "abc123" },
  });
  check("create template 201, status draft", tpl.status === 201 && tpl.json?.data?.status === "draft", tpl.json);
  check("variableCount=3 from header+body+button", tpl.json?.data?.variableCount === 3, tpl.json?.data?.variableCount);
  const tid = tpl.json?.data?.id;

  const vars = await req("GET", `/templates/${tid}/variables`);
  check("variables endpoint lists {{1}},{{2}},{{3}}", JSON.stringify(vars.json?.data?.variables) === JSON.stringify(["{{1}}", "{{2}}", "{{3}}"]), vars.json?.data);

  const vOk = await req("POST", `/templates/${tid}/validate`, { parameters: { "{{1}}": "Bob", "{{2}}": "#9", "{{3}}": "z9" } });
  check("validate complete -> valid:true", vOk.json?.data?.valid === true, vOk.json?.data);
  const vBad = await req("POST", `/templates/${tid}/validate`, { parameters: { "{{1}}": "Bob" } });
  check("validate incomplete -> missing {{2}},{{3}}", JSON.stringify(vBad.json?.data?.missing) === JSON.stringify(["{{2}}", "{{3}}"]), vBad.json?.data);

  const prev = await req("POST", `/templates/${tid}/preview`, {});
  check("preview substitutes examples", prev.json?.data?.body?.includes("Alice") && prev.json?.data?.body?.includes("#1042"), prev.json?.data);

  const submit = await req("POST", `/templates/${tid}/submit`);
  check("submit draft -> pending", submit.json?.data?.status === "pending", submit.json);
  const editPending = await req("PATCH", `/templates/${tid}`, { body: "changed" });
  check("editing pending blocked", editPending.status >= 400, editPending.status);

  const noEx = await req("POST", "/templates", { name: `no_example_${RUN}`, category: "marketing", body: "Hi {{1}}" });
  const submitNoEx = await req("POST", `/templates/${noEx.json?.data?.id}/submit`);
  check("submit blocked without example value", submitNoEx.status >= 400, submitNoEx.json);

  const listTpl = await req("GET", "/templates?status=pending&category=utility");
  check("template list filter 200", listTpl.status === 200, listTpl.status);
  const sync = await req("POST", "/templates/sync/meta");
  check("meta sync stub 200", sync.status === 200 && typeof sync.json?.data?.synced === "number", sync.json);

  // ============ STAGE 4: CAMPAIGN ENGINE ============
  console.log("\n[campaigns]");

  // Precondition: simulate Meta approving the template (no WABA in dev).
  await prisma.messageTemplate.update({ where: { id: tid }, data: { status: "approved" } });

  // Fund the wallet so sends can be charged.
  const topup = await req("POST", "/wallet/top-up", { amount: 100, source: "e2e" });
  check("wallet top-up 200", topup.status === 200, topup.status);

  // Two opted-in recipient contacts.
  const r1 = (await req("POST", "/contacts", { name: "Rcpt1", phone: `+1888${RUN}1`, optInStatus: "opt_in" })).json?.data?.id;
  const r2 = (await req("POST", "/contacts", { name: "Rcpt2", phone: `+1888${RUN}2`, optInStatus: "opt_in" })).json?.data?.id;
  // An opted-out contact (should be blocked).
  const rOut = (await req("POST", "/contacts", { name: "OptOut", phone: `+1888${RUN}3`, optInStatus: "opt_out" })).json?.data?.id;

  const goodParams = { parameters: { "{{1}}": "Alice", "{{2}}": "#1042", "{{3}}": "trk" } };

  // Reject: template not approved
  const draftTpl = (await req("POST", "/templates", { name: `draft_${RUN}`, category: "marketing", body: "Hi {{1}}", exampleValues: { "{{1}}": "x" } })).json?.data?.id;
  const cNotApproved = await req("POST", "/campaigns", { name: "c", templateId: draftTpl, recipients: [{ contactId: r1 }], parameters: { "{{1}}": "x" }, sendNow: false });
  check("reject unapproved template", cNotApproved.status >= 400, cNotApproved.status);

  // Reject: missing parameters (validateTemplateParameters wired in)
  const cMissing = await req("POST", "/campaigns", { name: "c", templateId: tid, recipients: [{ contactId: r1 }], parameters: { "{{1}}": "only" }, sendNow: false });
  check("reject missing params w/ details", cMissing.status >= 400 && Array.isArray(cMissing.json?.error?.details), cMissing.json?.error);

  // Reject: opted-out recipient
  const cOptOut = await req("POST", "/campaigns", { name: "c", templateId: tid, recipients: [{ contactId: rOut }], ...goodParams, sendNow: false });
  check("reject opted-out recipient", cOptOut.status >= 400, cOptOut.json?.error?.message);

  // Reject: unknown contact
  const cUnknown = await req("POST", "/campaigns", { name: "c", templateId: tid, recipients: [{ contactId: "does-not-exist" }], ...goodParams, sendNow: false });
  check("reject unknown contact", cUnknown.status >= 400, cUnknown.status);

  // Send now (valid): dispatch + wallet debit
  const cSend = await req("POST", "/campaigns", { name: `Send ${RUN}`, templateId: tid, recipients: [{ contactId: r1 }, { contactId: r2 }], ...goodParams, sendNow: true });
  check("create+send 201", cSend.status === 201, cSend.json?.error ?? cSend.status);
  check("campaign status delivered", cSend.json?.data?.status === "delivered", cSend.json?.data?.status);
  check("both recipients sent", cSend.json?.data?.stats?.sent === 2 && cSend.json?.data?.stats?.total === 2, cSend.json?.data?.stats);
  check("recipients have metaMessageId", cSend.json?.data?.recipients?.every((r: any) => !!r.metaMessageId), cSend.json?.data?.recipients?.map((r: any) => r.metaMessageId));
  check("spent = 2 * 0.5", cSend.json?.data?.spent === 1, cSend.json?.data?.spent);
  const sentCampaignId = cSend.json?.data?.id;

  // Per-recipient parameter override is stored
  check("recipient parameters stored", cSend.json?.data?.recipients?.[0]?.parameters?.["{{1}}"] === "Alice", cSend.json?.data?.recipients?.[0]?.parameters);

  // Draft then launch
  const cDraft = await req("POST", "/campaigns", { name: `Draft ${RUN}`, templateId: tid, recipients: [{ contactId: r1 }], ...goodParams, sendNow: false });
  check("draft created (status draft)", cDraft.json?.data?.status === "draft", cDraft.json?.data?.status);
  const launch = await req("POST", `/campaigns/${cDraft.json?.data?.id}/launch`);
  check("launch -> delivered, 1 sent", launch.json?.data?.status === "delivered" && launch.json?.data?.stats?.sent === 1, launch.json?.data?.stats);

  // Scheduled campaign
  const cSched = await req("POST", "/campaigns", { name: `Sched ${RUN}`, templateId: tid, recipients: [{ contactId: r2 }], ...goodParams, scheduledFor: new Date(Date.now() + 3600_000).toISOString(), sendNow: false });
  check("scheduled status", cSched.json?.data?.status === "scheduled", cSched.json?.data?.status);

  // Inject a delivery failure on one recipient, then verify retry re-sends it.
  const oneRcpt = await prisma.campaignRecipient.findFirst({ where: { campaignId: sentCampaignId } });
  await prisma.campaignRecipient.update({ where: { id: oneRcpt!.id }, data: { status: "failed", error: "injected" } });
  // Poll the server (read-after-write through its own connection) until it sees
  // the injected failure, so the retry is deterministic and not racy.
  let injectedVisible = false;
  for (let i = 0; i < 20; i++) {
    const g = await req("GET", `/campaigns/${sentCampaignId}`);
    if (g.json?.data?.stats?.failed === 1) { injectedVisible = true; break; }
    await new Promise((r) => setTimeout(r, 200));
  }
  check("injected failure visible to server", injectedVisible);
  const retryOk = await req("POST", `/campaigns/${sentCampaignId}/retry`);
  check("retry re-sends failed recipient", retryOk.json?.data?.stats?.failed === 0 && retryOk.json?.data?.stats?.sent === 2, retryOk.json?.data?.stats);
  check("retried recipient attempts incremented", (retryOk.json?.data?.recipients?.find((r: any) => r.id === oneRcpt!.id)?.attempts ?? 0) >= 2, retryOk.json?.data?.recipients?.find((r: any) => r.id === oneRcpt!.id)?.attempts);

  // Retry again with no failures -> rejected (simulate mode never fails)
  const retry = await req("POST", `/campaigns/${sentCampaignId}/retry`);
  check("retry with no failures rejected", retry.status >= 400, retry.json?.error?.message);

  // List + get
  const cList = await req("GET", "/campaigns?page=1&limit=10");
  check("list campaigns (string paging)", cList.status === 200 && typeof cList.json?.data?.total === "number", cList.json);
  const cGet = await req("GET", `/campaigns/${sentCampaignId}`);
  check("get campaign detail w/ stats", cGet.status === 200 && cGet.json?.data?.stats?.sent === 2, cGet.json?.data?.stats);

  // ============ STAGE 5: LEADS + INBOX + WEBHOOKS ============
  const workspaceRow = await prisma.contact.findUnique({ where: { id: r1 }, select: { workspaceId: true } });
  const workspaceId = workspaceRow!.workspaceId;
  const sessionUser = await prisma.user.findFirst({ where: { workspaceId }, select: { id: true } });

  console.log("\n[leads]");
  const leadCreate = await req("POST", "/leads", { contactId: r1, source: "manual", notes: "initial" });
  check("create lead from contact 201", leadCreate.status === 201 && !!leadCreate.json?.data?.fullName && !!leadCreate.json?.data?.phone, leadCreate.json);
  const leadId = leadCreate.json?.data?.id;
  check("lead create rejects no identity", (await req("POST", "/leads", { source: "manual" })).status >= 400);
  const leadList = await req("GET", "/leads?page=1&limit=10&status=new");
  check("list leads (string paging + filter)", leadList.status === 200 && typeof leadList.json?.data?.total === "number", leadList.json);
  const leadStatus = await req("PATCH", `/leads/${leadId}/status`, { status: "qualified", note: "spoke on call" });
  check("update lead status + note appended", leadStatus.json?.data?.status === "qualified" && leadStatus.json?.data?.notes?.includes("spoke on call"), leadStatus.json?.data);
  const leadNote = await req("POST", `/leads/${leadId}/notes`, { content: "follow up next week", authorName: "Agent" });
  check("add lead note appends", leadNote.json?.data?.notes?.includes("follow up next week"), leadNote.json?.data?.notes);
  const leadAssign = await req("POST", `/leads/${leadId}/assign`, { userId: sessionUser!.id });
  check("assign lead to user", leadAssign.json?.data?.assignedTo === sessionUser!.id, leadAssign.json?.data?.assignedTo);
  check("assign lead rejects unknown user", (await req("POST", `/leads/${leadId}/assign`, { userId: "nope" })).status >= 400);
  const leadByContact = await req("GET", `/leads/contact/${r1}`);
  check("leads by contact >= 1", (leadByContact.json?.data?.length ?? 0) >= 1, leadByContact.json?.data?.length);

  console.log("\n[conversations]");
  // Campaign sends already created outbound conversation messages for r1/r2.
  const convSearch = await req("GET", `/conversations?search=1888${RUN}1`);
  check("conversation exists for r1 (from campaign)", (convSearch.json?.data?.total ?? 0) >= 1, convSearch.json?.data?.total);
  const convId = convSearch.json?.data?.conversations?.[0]?.id;
  const convGet = await req("GET", `/conversations/${convId}`);
  check("conversation has outbound template message", convGet.json?.data?.messages?.some((m: any) => m.direction === "outbound" && m.messageType === "template"), convGet.json?.data?.messages?.length);
  check("list conversations (string paging)", (await req("GET", "/conversations?page=1&limit=10")).status === 200);
  const convNote = await req("POST", `/conversations/${convId}/notes`, { body: "internal note", authorName: "Agent" });
  check("add conversation note 201", convNote.status === 201 && convNote.json?.data?.body === "internal note", convNote.json);
  const convMsg = await req("POST", `/conversations/${convId}/messages`, { body: "Thanks for reaching out!" });
  check("add outbound agent message 201", convMsg.status === 201 && convMsg.json?.data?.direction === "outbound", convMsg.json);
  const convAssign = await req("POST", `/conversations/${convId}/assign`, { userId: sessionUser!.id });
  check("assign conversation to user", convAssign.json?.data?.assignedTo === sessionUser!.id, convAssign.json?.data?.assignedTo);
  check("update conversation status -> resolved", (await req("PATCH", `/conversations/${convId}`, { status: "resolved" })).json?.data?.status === "resolved");
  check("mark conversation read (unread=0)", (await req("POST", `/conversations/${convId}/mark-read`)).json?.data?.unreadCount === 0);

  console.log("\n[webhooks]");
  // Simulate a connected WABA so the webhook can resolve the workspace by phone_number_id.
  const pnid = `pnid_${RUN}`;
  await prisma.whatsAppConnection.create({
    data: { workspaceId, phone_number_id: pnid, display_phone_number: "+19990000000", business_name: "E2E", business_portfolio: "E2E" },
  });
  const ts = () => `${Math.floor(Date.now() / 1000)}`;
  const waEnvelope = (value: any) => ({
    object: "whatsapp_business_account",
    entry: [{ id: `entry_${RUN}`, changes: [{ field: "messages", value: { metadata: { phone_number_id: pnid, display_phone_number: "+19990000000" }, ...value } }] }],
  });
  const poll = async (fn: () => Promise<boolean>) => {
    for (let i = 0; i < 30; i++) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 200)); }
    return false;
  };

  // Inbound customer message -> appended to r1's conversation timeline.
  const inboundId = `wamid_in_${RUN}`;
  await req("POST", "/meta/webhook", waEnvelope({ messages: [{ id: inboundId, from: `1888${RUN}1`, type: "text", text: { body: "Hello from customer" }, timestamp: ts() }] }));
  check("inbound webhook recorded in conversation", await poll(async () => {
    const g = await req("GET", `/conversations/${convId}`);
    return g.json?.data?.messages?.some((m: any) => m.metaMessageId === inboundId && m.direction === "inbound");
  }));

  // Delivery-status webhook -> recipient + conversation message become delivered (the loop).
  // Pin to r1's recipient since convId is r1's conversation (recipient order isn't guaranteed).
  const recMsgId = cGet.json?.data?.recipients?.find((r: any) => r.contactId === r1)?.metaMessageId;
  await req("POST", "/meta/webhook", waEnvelope({ statuses: [{ id: recMsgId, status: "delivered", recipient_id: `1888${RUN}1`, timestamp: ts() }] }));
  check("delivery webhook -> recipient delivered", await poll(async () => {
    const g = await req("GET", `/campaigns/${sentCampaignId}`);
    return g.json?.data?.recipients?.find((r: any) => r.metaMessageId === recMsgId)?.status === "delivered";
  }));
  check("delivery webhook -> conversation message delivered",
    (await req("GET", `/conversations/${convId}`)).json?.data?.messages?.some((m: any) => m.metaMessageId === recMsgId && m.status === "delivered"));

  // Inbound STOP keyword -> contact opted out (Stage 2 consent integration).
  await req("POST", "/meta/webhook", waEnvelope({ messages: [{ id: `wamid_stop_${RUN}`, from: `1888${RUN}2`, type: "text", text: { body: "STOP" }, timestamp: ts() }] }));
  check("inbound STOP keyword opts contact out", await poll(async () => {
    const g = await req("GET", `/contacts/${r2}`);
    return g.json?.data?.optInStatus === "opt_out";
  }));

  // ============ STAGE 6: RBAC + OPERATIONAL/AUDIT LOGS ============
  console.log("\n[rbac]");
  // New signups are ADMIN (workspace owner), so admin/ops routes work.
  check("ADMIN can GET /admin/users", (await req("GET", "/admin/users")).status === 200);
  check("ADMIN can GET /ops/logs", (await req("GET", "/ops/logs?page=1&limit=5")).status === 200);

  // Demote to USER -> observability/admin routes must 403.
  await prisma.user.update({ where: { id: sessionUser!.id }, data: { role: "USER" } });
  check("USER denied /ops/logs (403)", (await req("GET", "/ops/logs")).status === 403);
  check("USER denied /ops/failed-sends (403)", (await req("GET", "/ops/failed-sends")).status === 403);
  check("USER denied /admin/users (403)", (await req("GET", "/admin/users")).status === 403);
  // CRUD remains open to USER role.
  check("USER can still list contacts", (await req("GET", "/contacts?page=1&limit=1")).status === 200);
  // Restore ADMIN.
  await prisma.user.update({ where: { id: sessionUser!.id }, data: { role: "ADMIN" } });
  check("ADMIN restored -> /ops/logs 200", (await req("GET", "/ops/logs")).status === 200);

  console.log("\n[logs]");
  const auditLogs = await req("GET", "/ops/logs?eventType=audit&limit=50");
  check("audit logs persisted (>=1)", (auditLogs.json?.data?.total ?? 0) >= 1, auditLogs.json?.data?.total);
  check("audit log carries actorId + audit.* type", auditLogs.json?.data?.logs?.some((l: any) => l.eventType.startsWith("audit.") && l.payload?.actorId), auditLogs.json?.data?.logs?.[0]);
  check("campaign.sent audit present", auditLogs.json?.data?.logs?.some((l: any) => l.eventType === "audit.campaign.sent"), auditLogs.json?.data?.logs?.map((l: any) => l.eventType));
  check("ops logs level filter 200", (await req("GET", "/ops/logs?level=info")).status === 200);
  const failedSends = await req("GET", "/ops/failed-sends?page=1&limit=10");
  check("list failed-sends 200", failedSends.status === 200 && typeof failedSends.json?.data?.total === "number", failedSends.json);
  const webhookEvents = await req("GET", "/ops/webhook-events?page=1&limit=10");
  check("list webhook-events 200", webhookEvents.status === 200 && typeof webhookEvents.json?.data?.total === "number", webhookEvents.json);

  console.log("\n[audit]");
  // Auditable action: create then delete a throwaway contact.
  const tmpContact = (await req("POST", "/contacts", { name: "Temp Audit", phone: `+1777${RUN}9` })).json?.data?.id;
  await req("DELETE", `/contacts/${tmpContact}`);
  check("contact.deleted audit recorded", await poll(async () => {
    const g = await req("GET", "/ops/logs?eventType=audit.contact.deleted&limit=20");
    return g.json?.data?.logs?.some((l: any) => l.payload?.contactId === tmpContact);
  }));
  check("lead.assigned audit recorded", (await req("GET", "/ops/logs?eventType=audit.lead.assigned&limit=10")).json?.data?.total >= 1);

  // ============ STAGE 7: SCHEDULER + WEBHOOK DEDUP + META TEMPLATE SYNC ============
  console.log("\n[scheduled-dispatch]");
  // A campaign scheduled in the past must fire when the sweep runs; a future one must not.
  const cPast = await req("POST", "/campaigns", {
    name: `PastSched ${RUN}`,
    templateId: tid,
    recipients: [{ contactId: r1 }],
    ...goodParams,
    scheduledFor: new Date(Date.now() - 60_000).toISOString(),
    sendNow: false,
  });
  check("past-scheduled created as scheduled", cPast.json?.data?.status === "scheduled", cPast.json?.data?.status);
  const pastId = cPast.json?.data?.id;
  const due = await req("POST", "/campaigns/dispatch-due");
  check("dispatch-due fires the due campaign", (due.json?.data?.dispatched ?? []).includes(pastId), due.json?.data);
  const pastGet = await req("GET", `/campaigns/${pastId}`);
  check("due campaign now delivered (1 sent)", pastGet.json?.data?.status === "delivered" && pastGet.json?.data?.stats?.sent === 1, pastGet.json?.data?.stats);
  const futureGet = await req("GET", `/campaigns/${cSched.json?.data?.id}`);
  check("future-scheduled untouched (still scheduled)", futureGet.json?.data?.status === "scheduled", futureGet.json?.data?.status);

  console.log("\n[webhook-dedup]");
  // Posting the exact same event twice must be processed once (persistent dedup).
  const beforeProcessed = await prisma.processedWebhookEvent.count();
  const dupId = `wamid_dup_${RUN}`;
  const dupEnvelope = waEnvelope({ messages: [{ id: dupId, from: `1888${RUN}1`, type: "text", text: { body: "duplicate test" }, timestamp: ts() }] });
  await req("POST", "/meta/webhook", dupEnvelope);
  check("first delivery processed", await poll(async () => {
    const g = await req("GET", `/conversations/${convId}`);
    return g.json?.data?.messages?.some((m: any) => m.metaMessageId === dupId);
  }));
  await req("POST", "/meta/webhook", dupEnvelope); // identical redelivery
  await new Promise((r) => setTimeout(r, 800));
  const afterProcessed = await prisma.processedWebhookEvent.count();
  check("redelivery deduped (exactly 1 ProcessedWebhookEvent)", afterProcessed - beforeProcessed === 1, { before: beforeProcessed, after: afterProcessed });
  const convAfterDup = await req("GET", `/conversations/${convId}`);
  check("redelivery -> single inbound message", (convAfterDup.json?.data?.messages?.filter((m: any) => m.metaMessageId === dupId).length) === 1);
  // Raw capture populates the ops feed.
  check("webhook-events feed populated (>=1)", ((await req("GET", "/ops/webhook-events?page=1&limit=5")).json?.data?.total ?? 0) >= 1);

  console.log("\n[template-meta]");
  // No WABA is connected (the seeded connection has no wabaId), so submit/sync fall back gracefully.
  const draftForSubmit = await req("POST", "/templates", { name: `submit_${RUN}`, category: "utility", language: "en", body: "Hi {{1}}, your code is {{2}}", exampleValues: { "{{1}}": "Sam", "{{2}}": "123" } });
  const submitId = draftForSubmit.json?.data?.id;
  const submitRes = await req("POST", `/templates/${submitId}/submit`);
  check("submit without WABA -> pending fallback", submitRes.json?.data?.status === "pending", submitRes.json);
  const syncRes = await req("POST", "/templates/sync/meta");
  check("sync without WABA -> note + updated:0", syncRes.json?.data?.note?.includes("No live") && syncRes.json?.data?.updated === 0, syncRes.json?.data);

  // ============ PHASE 2: SEGMENTS + LINKS + RETARGET + ANALYTICS + RECURRENCE ============
  console.log("\n[segments]");
  const segTag = `SEG${RUN}`;
  await req("POST", "/contacts/tags", { name: segTag, color: "#1AA" });
  const s1 = (await req("POST", "/contacts", { name: "Seg1", phone: `+1999${RUN}1`, optInStatus: "opt_in" })).json?.data?.id;
  const s2 = (await req("POST", "/contacts", { name: "Seg2", phone: `+1999${RUN}2`, optInStatus: "opt_in" })).json?.data?.id;
  const sOut = (await req("POST", "/contacts", { name: "SegOut", phone: `+1999${RUN}3`, optInStatus: "opt_out" })).json?.data?.id;
  for (const id of [s1, s2, sOut]) await req("POST", `/contacts/${id}/tags/${segTag}`);

  const segCreate = await req("POST", "/segments", {
    name: `Seg ${RUN}`,
    filters: { match: "all", conditions: [{ field: "tag", op: "hasAny", value: [segTag] }] },
  });
  check("create segment 201", segCreate.status === 201, segCreate.json);
  const segId = segCreate.json?.data?.id;
  check("duplicate segment name rejected", (await req("POST", "/segments", { name: `Seg ${RUN}`, filters: { match: "all", conditions: [] } })).status >= 400);

  const segPreview = await req("POST", `/segments/${segId}/preview`, { sampleSize: 10 });
  check("segment preview counts all 3 tagged", segPreview.json?.data?.total === 3, segPreview.json?.data?.total);
  const segList = await req("GET", "/segments");
  check("segment list carries live contactCount", segList.json?.data?.segments?.find((s: any) => s.id === segId)?.contactCount === 3, segList.json?.data);
  const adhoc = await req("POST", "/segments/preview", { filters: { match: "all", conditions: [{ field: "optInStatus", op: "eq", value: "opt_in" }, { field: "tag", op: "hasAny", value: [segTag] }] } });
  check("ad-hoc preview (opt_in AND tag) counts 2", adhoc.json?.data?.total === 2, adhoc.json?.data?.total);

  // Campaign from a segment: only the 2 opted-in tagged contacts become recipients.
  const segCampaign = await req("POST", "/campaigns", { name: `SegCamp ${RUN}`, templateId: tid, segmentId: segId, ...goodParams, sendNow: true });
  check("campaign from segment 201", segCampaign.status === 201, segCampaign.json?.error ?? segCampaign.status);
  check("segment campaign excludes opted-out (2 recipients)", segCampaign.json?.data?.stats?.total === 2, segCampaign.json?.data?.stats);
  const segCampaignId = segCampaign.json?.data?.id;
  check("reject two audience sources", (await req("POST", "/campaigns", { name: "x", templateId: tid, segmentId: segId, recipients: [{ contactId: s1 }], ...goodParams })).status >= 400);

  console.log("\n[links]");
  const linkCreate = await req("POST", "/links", { originalUrl: "https://example.com/promo", title: "Promo", campaignId: segCampaignId });
  check("create tracked link 201 + shortUrl", linkCreate.status === 201 && typeof linkCreate.json?.data?.shortUrl === "string", linkCreate.json);
  const linkCode = linkCreate.json?.data?.code;
  const linkId = linkCreate.json?.data?.id;

  const clickOnce = (cid?: string) =>
    fetch(`${BASE}/t/${linkCode}?wid=${workspaceId}${cid ? `&cid=${cid}` : ""}`, { redirect: "manual" });
  const c1 = await clickOnce(s1);
  check("public click redirects (3xx) to destination", c1.status >= 300 && c1.status < 400 && (c1.headers.get("location") || "").includes("example.com"), { status: c1.status, loc: c1.headers.get("location") });
  await clickOnce(s1); // same contact again -> total++ but unique stays
  await clickOnce(s2);

  let la: any = null;
  for (let i = 0; i < 25; i++) {
    la = (await req("GET", `/links/${linkId}/analytics`)).json?.data;
    if ((la?.totalClicks ?? 0) >= 3) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  check("link analytics totalClicks=3", la?.totalClicks === 3, la?.totalClicks);
  check("link analytics uniqueClicks=2 (by contact)", la?.uniqueClicks === 2, la?.uniqueClicks);

  console.log("\n[retarget]");
  const rtClicked = await req("POST", "/campaigns", { name: `RT-clicked ${RUN}`, templateId: tid, retarget: { fromCampaignId: segCampaignId, clicked: true }, ...goodParams, sendNow: false });
  check("retarget clicked builds audience (2)", rtClicked.status === 201 && rtClicked.json?.data?.stats?.total === 2, rtClicked.json?.error ?? rtClicked.json?.data?.stats);
  const rtSent = await req("POST", "/campaigns", { name: `RT-sent ${RUN}`, templateId: tid, retarget: { fromCampaignId: segCampaignId, statuses: ["sent"] }, ...goodParams, sendNow: false });
  check("retarget by status=sent builds audience (2)", rtSent.json?.data?.stats?.total === 2, rtSent.json?.data?.stats);
  const rtNone = await req("POST", "/campaigns", { name: `RT-none ${RUN}`, templateId: tid, retarget: { fromCampaignId: segCampaignId, statuses: ["failed"] }, ...goodParams, sendNow: false });
  check("retarget with no matches rejected", rtNone.status >= 400, rtNone.status);

  console.log("\n[campaign-analytics]");
  const analytics = await req("GET", `/campaigns/${segCampaignId}/analytics`);
  check("analytics funnel total=2", analytics.json?.data?.funnel?.total === 2, analytics.json?.data?.funnel);
  check("analytics clicks attributed (3 total / 2 unique)", analytics.json?.data?.clicks?.total === 3 && analytics.json?.data?.clicks?.unique === 2, analytics.json?.data?.clicks);
  check("analytics rates present", typeof analytics.json?.data?.rates?.clickThroughRate === "number", analytics.json?.data?.rates);

  console.log("\n[recurring]");
  const rec = await req("POST", "/campaigns", {
    name: `Recurring ${RUN}`,
    templateId: tid,
    segmentId: segId,
    ...goodParams,
    scheduledFor: new Date(Date.now() - 60_000).toISOString(),
    recurrence: { freq: "daily", interval: 1 },
    sendNow: false,
  });
  check("recurring created as scheduled", rec.json?.data?.status === "scheduled", rec.json?.data?.status);
  check("recurrence without scheduledFor rejected", (await req("POST", "/campaigns", { name: "x", templateId: tid, segmentId: segId, ...goodParams, recurrence: { freq: "daily", interval: 1 } })).status >= 400);
  const recId = rec.json?.data?.id;
  await req("POST", "/campaigns/dispatch-due");
  const recGet = await req("GET", `/campaigns/${recId}`);
  check("recurring run dispatched (delivered)", recGet.json?.data?.status === "delivered", recGet.json?.data?.status);
  const afterList = await req("GET", "/campaigns?page=1&limit=50&status=scheduled");
  const clone = afterList.json?.data?.campaigns?.find((c: any) => c.name === `Recurring ${RUN}` && c.id !== recId);
  check("recurring cloned next occurrence (future scheduled)", !!clone && new Date(clone.scheduledFor).getTime() > Date.now(), clone?.scheduledFor);

  console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===`);
  await prisma.$disconnect();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("E2E crashed:", e);
  process.exit(1);
});
