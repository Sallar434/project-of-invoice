"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const DT = require("../logic.js");

function makeInvoice(overrides) {
  const raw = Object.assign(
    {
      id: "inv-1",
      reference: "INV-1",
      client: "Example Client",
      currency: "USD",
      amount: 100,
      paidAmount: 0,
      dueDate: "2026-10-01",
      promiseDate: "",
      nextFollowUp: "",
      status: "open",
      archived: false,
      contactName: "Ada Example",
      contactRole: "Accounts payable",
      contactEmail: "ada@example.com",
      acceptanceNote: "",
      lastMessageSummary: "",
      checklist: [],
      activity: [],
      createdAt: "2026-10-01T09:00:00.000Z",
      updatedAt: "2026-10-01T09:00:00.000Z",
    },
    overrides || {}
  );
  const result = DT.sanitizeInvoice(raw);
  if (!result.ok) throw new Error(result.summary);
  return result.invoice;
}

test("acceptance: mixed currencies stay in separate totals", function () {
  const state = DT.buildSampleState("2026-11-06");
  const totals = DT.outstandingByCurrency(state.invoices);

  assert.equal(totals.open.USD, 3790);
  assert.equal(totals.open.EUR, 1200);
  assert.equal(totals.open.PKR, 185000);
  assert.equal(totals.open.GBP, undefined);
  assert.equal(totals.disputed.GBP, 960);
  assert.equal(totals.disputed.USD, undefined);
  assert.equal(totals.total, undefined);
  assert.equal(totals.combined, undefined);

  const partial = state.invoices.find(function (invoice) {
    return invoice.reference === "INV-1033";
  });
  assert.equal(partial.currency, "EUR");
  assert.equal(DT.outstandingCents(partial), 120000);

  const paid = state.invoices.find(function (invoice) {
    return invoice.reference === "INV-1010";
  });
  assert.equal(DT.outstandingCents(paid), 0);

  const archived = makeInvoice({
    id: "arch",
    reference: "ARCH",
    currency: "USD",
    amount: 50,
    status: "open",
    archived: true,
    dueDate: "2026-01-01",
  });
  const withArchived = DT.outstandingByCurrency(state.invoices.concat([archived]));
  assert.equal(withArchived.open.USD, 3790);
});

test("acceptance: partial payments use cent math and do not mutate the original", function () {
  const invoice = makeInvoice({ amount: 10.1, paidAmount: 0.1, currency: "USD", status: "open" });
  assert.equal(DT.outstandingCents(invoice), 1000);
  const before = DT.clone(invoice);

  const tooMuch = DT.applyPayment(invoice, { amount: "10.01", at: "2026-11-06T12:00:00.000Z" });
  assert.equal(tooMuch.ok, false);
  assert.match(tooMuch.error, /larger than the outstanding/);
  assert.deepEqual(invoice, before);

  const invalid = DT.applyPayment(invoice, { amount: "10.999", at: "2026-11-06T12:00:00.000Z" });
  assert.equal(invalid.ok, false);
  assert.deepEqual(invoice, before);

  const partial = DT.applyPayment(invoice, {
    amount: "9.99",
    note: "Wire received",
    at: "2026-11-06T12:00:00.000Z",
  });
  assert.equal(partial.ok, true);
  assert.equal(partial.invoice.status, "open");
  assert.equal(DT.outstandingCents(partial.invoice), 1);
  assert.equal(partial.invoice.activity[partial.invoice.activity.length - 1].type, "partial_payment");
  assert.equal(partial.invoice.activity[partial.invoice.activity.length - 1].amount, 9.99);
  assert.deepEqual(invoice, before);

  const full = DT.applyPayment(partial.invoice, { amount: "0.01", at: "2026-11-06T13:00:00.000Z" });
  assert.equal(full.ok, true);
  assert.equal(full.invoice.status, "paid");
  assert.equal(DT.outstandingCents(full.invoice), 0);
  assert.equal(DT.canFollowUp(full.invoice), false);

  const again = DT.applyPayment(full.invoice, { amount: "0.01", at: "2026-11-06T14:00:00.000Z" });
  assert.equal(again.ok, false);

  const disputed = makeInvoice({ id: "disp", reference: "DISP", status: "disputed", amount: 40, paidAmount: 10 });
  const duringDispute = DT.applyPayment(disputed, { amount: "5", at: "2026-11-06T12:00:00.000Z" });
  assert.equal(duringDispute.ok, true);
  assert.equal(duringDispute.invoice.status, "disputed");
  assert.equal(DT.outstandingCents(duringDispute.invoice), 2500);
  assert.equal(DT.canFollowUp(duringDispute.invoice), false);
});

test("acceptance: invalid dates are rejected", function () {
  const base = {
    id: "date-1",
    reference: "INV-9",
    client: "Date Client",
    currency: "PKR",
    amount: "1500",
    paidAmount: "0",
    dueDate: "2026-11-06",
    promiseDate: "",
    nextFollowUp: "",
    status: "open",
    contactName: "",
    contactRole: "",
    contactEmail: "",
    acceptanceNote: "",
    lastMessageSummary: "",
    checklist: [],
    activity: [],
    createdAt: "2026-11-01T09:00:00.000Z",
    updatedAt: "2026-11-01T09:00:00.000Z",
  };

  function due(value) {
    return DT.sanitizeInvoice(Object.assign({}, base, { dueDate: value }));
  }

  assert.equal(due("2026-02-31").ok, false);
  assert.match(due("2026-02-31").summary, /due date/i);
  assert.equal(due("2026-02-29").ok, false);
  assert.equal(due("2026-13-01").ok, false);
  assert.equal(due("06-11-2026").ok, false);
  assert.equal(due("").ok, false);
  assert.equal(due("2026-11-06T00:00:00.000Z").ok, false);
  assert.equal(due("2024-02-29").ok, true);

  const badPromise = DT.sanitizeInvoice(Object.assign({}, base, { promiseDate: "nope" }));
  assert.equal(badPromise.ok, false);
  assert.equal(badPromise.errors.promiseDate != null, true);

  const badFollow = DT.sanitizeInvoice(Object.assign({}, base, { nextFollowUp: "2026-00-10" }));
  assert.equal(badFollow.ok, false);

  const blankPromise = DT.sanitizeInvoice(Object.assign({}, base, { promiseDate: "" }));
  assert.equal(blankPromise.ok, true);

  const logged = makeInvoice();
  const badLog = DT.logFollowUp(logged, {
    note: "Called them",
    at: "2026-11-06T09:00:00.000Z",
    promiseDate: "2026-02-31",
  });
  assert.equal(badLog.ok, false);
  assert.match(badLog.error, /Promise date/);
});

test("acceptance: promise sorting puts missed promises ahead of other overdue work", function () {
  function open(partial) {
    return makeInvoice(
      Object.assign(
        {
          amount: 100,
          paidAmount: 0,
          status: "open",
          currency: "USD",
        },
        partial
      )
    );
  }

  const today = "2026-11-06";
  const invoices = [
    open({ id: "a", reference: "A", client: "A", promiseDate: "2026-10-20", dueDate: "2026-10-01" }),
    open({ id: "b", reference: "B", client: "B", promiseDate: "2026-09-01", dueDate: "2026-08-01" }),
    open({ id: "c", reference: "C", client: "C", promiseDate: "", dueDate: "2026-07-01" }),
    open({ id: "d", reference: "D", client: "D", promiseDate: "", dueDate: "2026-10-15" }),
    open({ id: "e", reference: "E", client: "E", promiseDate: "2026-11-20", dueDate: "2026-09-01" }),
    open({
      id: "f",
      reference: "F",
      client: "F",
      promiseDate: "2026-08-01",
      dueDate: "2026-07-01",
      status: "paid",
      paidAmount: 100,
    }),
    open({
      id: "g",
      reference: "G",
      client: "G",
      promiseDate: "2026-08-01",
      dueDate: "2026-07-01",
      status: "disputed",
    }),
    open({
      id: "h",
      reference: "H",
      client: "H",
      promiseDate: "2026-11-10",
      dueDate: "2026-11-20",
      nextFollowUp: "2026-11-06",
    }),
    open({ id: "i", reference: "I", client: "I", promiseDate: "2026-11-06", dueDate: "2026-11-20" }),
  ];

  const order = DT.actionQueue(invoices, today).map(function (item) {
    return item.reference;
  });
  assert.deepEqual(order, ["B", "A", "I", "C", "E", "D", "H"]);

  const sample = DT.buildSampleState("2026-11-06");
  const sampleOrder = DT.actionQueue(sample.invoices, "2026-11-06").map(function (item) {
    return item.reference;
  });
  assert.deepEqual(sampleOrder, ["INV-1038", "INV-1042", "INV-1033", "INV-1055", "INV-1048"]);
  assert.equal(DT.actionQueue(sample.invoices, "2026-11-06")[0].primaryReason, "missed_promise");
  assert.equal(DT.actionQueue(sample.invoices, "2026-11-06")[4].primaryReason, "follow_up");
});

test("acceptance: paid and disputed invoices are suppressed from follow-ups", function () {
  const today = "2026-11-06";
  const paid = makeInvoice({
    id: "paid",
    reference: "PAID",
    status: "paid",
    paidAmount: 80,
    amount: 80,
    dueDate: "2026-01-01",
    promiseDate: "2026-01-15",
  });
  const disputed = makeInvoice({
    id: "disputed",
    reference: "DISPUTED",
    status: "disputed",
    dueDate: "2026-01-01",
    promiseDate: "2026-01-02",
  });
  const open = makeInvoice({
    id: "open",
    reference: "OPEN",
    dueDate: "2026-10-01",
    promiseDate: "2026-10-02",
  });
  const waiting = makeInvoice({
    id: "wait",
    reference: "WAIT",
    dueDate: "2026-12-01",
    promiseDate: "2026-12-15",
  });

  assert.equal(DT.canFollowUp(paid), false);
  assert.equal(DT.canFollowUp(disputed), false);
  assert.equal(DT.canFollowUp(open), true);
  assert.equal(DT.canFollowUp(waiting), true);

  const queue = DT.actionQueue([paid, disputed, open, waiting], today);
  assert.deepEqual(
    queue.map(function (item) {
      return item.reference;
    }),
    ["OPEN"]
  );

  const templates = DT.defaultTemplates();
  assert.equal(DT.buildReminder(paid, "friendly", templates, "Amina", today).ok, false);
  assert.equal(DT.buildReminder(disputed, "direct", templates, "Amina", today).ok, false);
  assert.match(DT.buildReminder(disputed, "final", templates, "Amina", today).error, /disputed/);
  const draft = DT.buildReminder(open, "friendly", templates, "Amina Qureshi", today);
  assert.equal(draft.ok, true);
  assert.match(draft.text, /OPEN/);
  assert.match(draft.text, /Amina Qureshi/);

  const logged = DT.logFollowUp(disputed, {
    note: "Chasing anyway",
    at: "2026-11-06T09:00:00.000Z",
  });
  assert.equal(logged.ok, false);

  const noted = DT.addNote(disputed, { note: "Scope call happened.", at: "2026-11-06T09:00:00.000Z" });
  assert.equal(noted.ok, true);
  assert.equal(DT.canFollowUp(noted.invoice), false);
});

test("acceptance: reload persistence round-trips browser storage", function () {
  const storage = DT.createMemoryStorage();
  const first = DT.initialState(storage, "2026-11-06");
  assert.equal(first.seeded, true);
  assert.equal(first.blocked, false);
  assert.equal(storage.getItem(DT.STORAGE_KEY) != null, true);

  first.state.senderName = "Reload Tester";
  first.state.invoices[0].acceptanceNote = "kept across reload";
  first.state.templates.friendly = "Hello {{contact}} from reload.";
  DT.saveState(storage, first.state);

  const second = DT.initialState(storage, "2026-11-06");
  assert.equal(second.ok, true);
  assert.equal(second.seeded, false);
  assert.equal(second.state.senderName, "Reload Tester");
  assert.equal(second.state.invoices[0].acceptanceNote, "kept across reload");
  assert.equal(second.state.templates.friendly, "Hello {{contact}} from reload.");
  assert.equal(second.state.invoices.length, first.state.invoices.length);

  const third = DT.loadState(storage);
  assert.deepEqual(third.state.invoices, second.state.invoices);
  assert.deepEqual(third.state.templates, second.state.templates);
});

test("acceptance: backup round trip and malformed backups", function () {
  const state = DT.buildSampleState("2026-11-06");
  state.senderName = "Amina Qureshi";
  state.templates.direct = "Direct {{reference}} {{outstanding}}";
  const json = DT.serializeBackup(state, new Date("2026-11-06T12:00:00.000Z"));
  const parsed = DT.parseBackup(json);
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.state.invoices, state.invoices);
  assert.deepEqual(parsed.state.templates, state.templates);
  assert.equal(parsed.state.senderName, "Amina Qureshi");
  assert.equal(parsed.state.exportedAt, undefined);

  const harbor = parsed.state.invoices.find(function (invoice) {
    return invoice.reference === "INV-1033";
  });
  assert.equal(harbor.paidAmount, 600);
  assert.equal(harbor.promiseDate, DT.addDaysISO("2026-11-06", 4));
  assert.equal(harbor.activity.some(function (entry) { return entry.type === "partial_payment"; }), true);

  const current = state;
  const failed = DT.restoreBackup(current, "{");
  assert.equal(failed.ok, false);
  assert.equal(failed.state, current);
  assert.match(failed.error, /Nothing was changed/);

  const samples = [
    "",
    "null",
    "[]",
    '"hi"',
    "{",
    '{"app":"Nope","version":1,"invoices":[],"templates":{}}',
    '{"app":"DueTrail","version":2,"invoices":[],"templates":{}}',
    '{"app":"DueTrail","version":1,"invoices":"nope"}',
    '{"app":"DueTrail","version":1,"invoices":[null]}',
  ];
  for (let i = 0; i < samples.length; i += 1) {
    const result = DT.parseBackup(samples[i]);
    assert.equal(result.ok, false, samples[i]);
    assert.match(result.error, /Nothing was changed/);
    assert.doesNotThrow(function () {
      DT.parseBackup(samples[i]);
    });
  }

  const broken = JSON.parse(json);
  broken.invoices[0].dueDate = "2026-02-31";
  const rejected = DT.parseBackup(JSON.stringify(broken));
  assert.equal(rejected.ok, false);
  assert.match(rejected.error, /due date/i);
  assert.equal(DT.restoreBackup(current, JSON.stringify(broken)).state, current);

  const weird = {
    app: "DueTrail",
    version: 1,
    invoices: [{ amount: "lots" }],
    templates: DT.defaultTemplates(),
  };
  assert.doesNotThrow(function () {
    const result = DT.parseBackup(JSON.stringify(weird));
    assert.equal(result.ok, false);
  });

  const storage = DT.createMemoryStorage();
  storage.setItem(DT.STORAGE_KEY, "{not json");
  const blocked = DT.initialState(storage, "2026-11-06");
  assert.equal(blocked.blocked, true);
  assert.equal(blocked.ok, false);
  assert.match(blocked.error, /valid JSON/);
  assert.equal(storage.getItem(DT.STORAGE_KEY), "{not json");
});

test("acceptance: csv formula injection is neutralized and user text is escapable", function () {
  const invoice = makeInvoice({
    id: "csv",
    reference: "+TAB",
    client: '=HYPERLINK("http://evil.example")',
    contactName: "@cmd",
    lastMessageSummary: "-note, with comma",
    currency: "USD",
    amount: 20,
    paidAmount: 0,
  });
  const wrapped = makeInvoice({
    id: "wrap",
    reference: "WRAP",
    client: "O'Neill, Birch",
    lastMessageSummary: "line\nbreak",
    currency: "EUR",
    amount: 5,
  });
  const csv = DT.invoicesToCsv([invoice, wrapped]);
  assert.match(csv, /'=HYPERLINK\(""http:\/\/evil\.example""\)/);
  assert.match(csv, /'\+TAB/);
  assert.match(csv, /'@cmd/);
  assert.match(csv, /"'-note, with comma"/);
  assert.match(csv, /"O'Neill, Birch"/);
  assert.match(csv, /"line\nbreak"/);
  assert.equal(DT.csvCell("=CMD()"), "'=CMD()");
  assert.equal(DT.csvCell("+1"), "'+1");
  assert.equal(DT.csvCell("-1"), "'-1");
  assert.equal(DT.csvCell("@SUM(1)"), "'@SUM(1)");
  assert.equal(DT.csvCell("\t=1+1"), "'\t=1+1");
  assert.equal(DT.csvCell("\r=1"), "\"'\r=1\"");
  assert.equal(DT.csvCell("normal"), "normal");
  assert.equal(DT.csvCell('say "hi"'), '"say ""hi"""');

  const hostile = makeInvoice({
    id: "xss",
    reference: "XSS",
    client: '<script>alert(1)</script>',
  });
  const draft = DT.buildReminder(hostile, "direct", DT.defaultTemplates(), "Amina", "2026-11-06");
  assert.equal(draft.ok, true);
  assert.match(draft.text, /<script>alert\(1\)<\/script>/);
  assert.equal(
    DT.escapeHtml('<img alt="x" onerror=\'alert(1)\'>'),
    "&lt;img alt=&quot;x&quot; onerror=&#39;alert(1)&#39;&gt;"
  );
});

test("editing to disputed requires a note and leaves the queue", function () {
  const invoice = makeInvoice({ dueDate: "2026-10-01", promiseDate: "2026-10-02" });
  const at = "2026-11-06T10:00:00.000Z";
  const form = {
    reference: invoice.reference,
    client: invoice.client,
    currency: invoice.currency,
    amount: String(invoice.amount),
    paidAmount: String(invoice.paidAmount),
    dueDate: invoice.dueDate,
    promiseDate: invoice.promiseDate,
    nextFollowUp: "",
    status: "disputed",
    contactName: invoice.contactName,
    contactRole: invoice.contactRole,
    contactEmail: invoice.contactEmail,
    acceptanceNote: "",
    lastMessageSummary: "",
    checklist: [],
    disputeNote: "",
  };
  const missing = DT.saveInvoiceEdits(invoice, form, { at: at });
  assert.equal(missing.ok, false);
  form.disputeNote = "They say the last round was out of scope.";
  const saved = DT.saveInvoiceEdits(invoice, form, { at: at });
  assert.equal(saved.ok, true);
  assert.equal(saved.invoice.status, "disputed");
  assert.equal(DT.actionQueue([saved.invoice], "2026-11-06").length, 0);
  assert.equal(saved.invoice.activity[saved.invoice.activity.length - 1].type, "dispute");
});
