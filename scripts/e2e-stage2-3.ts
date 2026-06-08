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

  console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===`);
  await prisma.$disconnect();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("E2E crashed:", e);
  process.exit(1);
});
