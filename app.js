"use strict";

/*
 * DueTrail UI. User-provided strings are assigned with textContent or input values.
 * Do not interpolate them into HTML.
 */
(function () {
  const DT = window.DueTrail;
  if (!DT) return;

  const COMMON_CHECKS = [
    "Purchase order or reference number",
    "Delivery or timesheet accepted",
    "Invoice uploaded to their portal",
  ];

  const mobileQuery = window.matchMedia("(max-width: 860px)");
  const storageInfo = browserStorage();
  const storage = storageInfo.storage;
  let boot = DT.initialState(storage, DT.todayISO());
  let state = boot.state;
  let storageBlocked = boot.blocked;
  let selectedId = null;
  let pane = "queue";
  let editingId = null;
  let showDispute = false;
  let detailMessage = "";
  let reminderState = { invoiceId: null, tone: "friendly", dirty: false, text: "" };

  const els = {
    alert: document.getElementById("app-alert"),
    storageStatus: document.getElementById("storage-status"),
    listPane: document.getElementById("list-pane"),
    home: document.getElementById("home-view"),
    detail: document.getElementById("detail-view"),
    switcher: document.getElementById("mobile-switch"),
    tabQueue: document.getElementById("tab-queue"),
    tabInvoices: document.getElementById("tab-invoices"),
    search: document.getElementById("search"),
    filter: document.getElementById("status-filter"),
    list: document.getElementById("invoice-list"),
    listEmpty: document.getElementById("list-empty"),
    listCount: document.getElementById("list-count"),
    totals: document.getElementById("totals"),
    disputedTotals: document.getElementById("disputed-totals"),
    disputedLabel: document.getElementById("disputed-label"),
    totalsNote: document.getElementById("totals-note"),
    queue: document.getElementById("queue-list"),
    queueEmpty: document.getElementById("queue-empty"),
    queueCount: document.getElementById("queue-count"),
    queueHeading: document.getElementById("queue-heading"),
    homeSender: document.getElementById("home-sender"),
    live: document.getElementById("live"),
    invoiceDialog: document.getElementById("invoice-dialog"),
    templateDialog: document.getElementById("template-dialog"),
    confirmDialog: document.getElementById("confirm-dialog"),
  };

  function browserStorage() {
    try {
      const probe = "__duetrail_probe__";
      window.localStorage.setItem(probe, "1");
      window.localStorage.removeItem(probe);
      return { storage: window.localStorage, persistent: true };
    } catch (err) {
      return { storage: DT.createMemoryStorage(), persistent: false };
    }
  }

  function h(tag, attrs, children) {
    const node = document.createElement(tag);
    const props = attrs || {};
    Object.keys(props).forEach(function (key) {
      const value = props[key];
      if (key === "class") node.className = value;
      else if (key === "text") node.textContent = value == null ? "" : String(value);
      else if (key === "checked" || key === "disabled") node[key] = !!value;
      else if (key === "value") node.value = value == null ? "" : String(value);
      else if (key === "dataset") {
        Object.keys(value).forEach(function (name) { node.dataset[name] = value[name]; });
      } else if (value === false || value == null) return;
      else node.setAttribute(key, value === true ? "" : String(value));
    });
    (children || []).forEach(function (child) {
      if (child == null || child === false) return;
      node.append(child.nodeType ? child : document.createTextNode(String(child)));
    });
    return node;
  }

  function today() {
    return DT.todayISO();
  }

  function findInvoice(id) {
    for (let i = 0; i < state.invoices.length; i += 1) {
      if (state.invoices[i].id === id) return state.invoices[i];
    }
    return null;
  }

  function replaceInvoice(invoice) {
    state.invoices = state.invoices.map(function (item) {
      return item.id === invoice.id ? invoice : item;
    });
  }

  function persist() {
    if (storageBlocked) return false;
    try {
      DT.saveState(storage, state);
      return true;
    } catch (err) {
      storageBlocked = true;
      showAlert("This browser refused to save. Download a backup before you close the tab. Nothing was uploaded.");
      return false;
    }
  }

  function showAlert(message) {
    if (!message) {
      els.alert.hidden = true;
      els.alert.textContent = "";
      return;
    }
    els.alert.hidden = false;
    els.alert.textContent = message;
  }

  function announce(message) {
    els.live.textContent = "";
    window.setTimeout(function () { els.live.textContent = message; }, 30);
  }

  function isMobile() {
    return mobileQuery.matches;
  }

  function syncPane() {
    const mobile = isMobile();
    const showList = mobile ? pane === "invoices" : true;
    const showHome = mobile ? pane === "queue" : !selectedId;
    const showDetail = mobile ? pane === "detail" : !!selectedId;
    els.listPane.hidden = !showList;
    els.home.hidden = !showHome;
    els.detail.hidden = !showDetail;
    els.switcher.hidden = !mobile || pane === "detail";
    els.tabQueue.setAttribute("aria-selected", pane === "queue" ? "true" : "false");
    els.tabInvoices.setAttribute("aria-selected", pane === "invoices" ? "true" : "false");
  }

  function setPane(next) {
    pane = next;
    syncPane();
    if (next === "queue") els.queueHeading.focus();
    if (next === "invoices") els.search.focus();
  }

  function statusLabel(status) {
    if (status === "paid") return "Paid";
    if (status === "disputed") return "Disputed";
    return "Open";
  }

  function renderTotals() {
    const summary = DT.summarizeMoney(state.invoices);
    const openCodes = DT.sortCurrencies(Object.keys(summary.totals.open));
    els.totals.replaceChildren();
    if (!openCodes.length) {
      els.totals.append(h("li", { class: "total-card" }, [
        h("p", { class: "eyebrow", text: "Outstanding" }),
        h("p", { class: "figure", text: "Nothing open" }),
        h("p", { class: "muted", text: "Paid invoices are left out. Disputed balances are listed apart." }),
      ]));
    }
    openCodes.forEach(function (code) {
      const count = summary.counts.open[code] || 0;
      els.totals.append(h("li", { class: "total-card" }, [
        h("p", { class: "eyebrow", text: "Outstanding · " + code }),
        h("p", { class: "figure", text: DT.formatMoney(code, summary.totals.open[code]) }),
        h("p", { class: "muted", text: count + (count === 1 ? " open invoice" : " open invoices") }),
      ]));
    });
    const disputedCodes = DT.sortCurrencies(Object.keys(summary.totals.disputed));
    els.disputedTotals.replaceChildren();
    els.disputedLabel.hidden = disputedCodes.length === 0;
    disputedCodes.forEach(function (code) {
      const count = summary.counts.disputed[code] || 0;
      els.disputedTotals.append(h("li", { class: "total-card is-disputed" }, [
        h("p", { class: "eyebrow", text: "Disputed · " + code }),
        h("p", { class: "figure", text: DT.formatMoney(code, summary.totals.disputed[code]) }),
        h("p", { class: "muted", text: count + (count === 1 ? " invoice, not chased" : " invoices, not chased") }),
      ]));
    });
    els.totalsNote.textContent = "Totals stay in their own currency. PKR, USD, EUR, and the rest are never folded into one number.";
  }

  function renderQueue() {
    const items = DT.actionQueue(state.invoices, today());
    els.queue.replaceChildren();
    els.queueCount.textContent = items.length
      ? items.length + (items.length === 1 ? " invoice needs a next step." : " invoices need a next step.")
      : "";
    els.queueEmpty.replaceChildren();
    els.queueEmpty.hidden = items.length !== 0;
    if (!items.length) {
      els.queueEmpty.append(h("p", {
        text: state.invoices.length
          ? "Nothing to chase right now. Overdue invoices, missed promises, and scheduled check-ins show up here. Paid and disputed invoices stay in the list and off this queue."
          : "The queue is empty because this browser has no invoices yet. Load the sample to see a missed promise, a partial payment, and a disputed invoice.",
      }));
      if (!state.invoices.length) els.queueEmpty.append(sampleButton());
    }
    items.forEach(function (item) {
      const button = h("button", {
        type: "button",
        class: "queue-item",
        "data-reason": item.primaryReason,
      }, [
        h("span", { class: "badge badge-" + item.primaryReason, text: DT.reasonLabel(item.primaryReason) }),
        h("span", { class: "queue-client", text: item.client }),
        h("span", { class: "queue-money", text: DT.formatMoney(item.currency, item.outstanding) }),
        h("span", { class: "queue-meta", text: item.reference + " · " + DT.queueSummary(item, today()) }),
      ]);
      button.addEventListener("click", function () { openInvoice(item.id); });
      els.queue.append(h("li", {}, [button]));
    });
  }

  function renderList() {
    const visible = DT.filterInvoices(state.invoices, {
      query: els.search.value,
      status: els.filter.value,
    });
    const noun = visible.length === 1 ? "invoice" : "invoices";
    els.listCount.textContent = visible.length + " " + noun;
    els.list.replaceChildren();
    const query = els.search.value.trim();
    els.listEmpty.replaceChildren();
    els.listEmpty.hidden = visible.length !== 0;
    if (!visible.length) {
      let message = "No invoices match that search.";
      if (!query && els.filter.value !== "all" && state.invoices.length) {
        message = "Nothing in this filter. Paid and disputed invoices are still on the other views.";
      } else if (!query && !state.invoices.length) {
        message = "No invoices in this browser yet. Load the fictitious sample, or add one you are willing to keep on this device only.";
      }
      els.listEmpty.append(h("p", { text: message }));
      if (!query && !state.invoices.length) els.listEmpty.append(sampleButton());
    }
    visible.forEach(function (invoice) {
      const outstanding = DT.outstandingCents(invoice);
      const money = invoice.status === "paid"
        ? "Paid " + DT.formatMoney(invoice.currency, invoice.amount)
        : DT.formatMoney(invoice.currency, DT.centsToAmount(outstanding)) + " outstanding";
      const chips = [
        h("span", { class: "badge badge-" + invoice.status, text: statusLabel(invoice.status) }),
      ];
      if (invoice.archived) chips.push(h("span", { class: "badge badge-archived", text: "Archived" }));
      if (DT.isSampleId(invoice.id)) chips.push(h("span", { class: "badge badge-sample", text: "Sample" }));
      const button = h("button", { type: "button", class: "invoice-button" }, [
        h("span", { class: "invoice-topline" }, chips),
        h("span", { class: "invoice-client", text: invoice.client }),
        h("span", { class: "invoice-meta", text: invoice.reference + " · " + money + " · due " + DT.formatLongDate(invoice.dueDate) }),
      ]);
      if (invoice.id === selectedId) button.setAttribute("aria-current", "true");
      button.addEventListener("click", function () { openInvoice(invoice.id); });
      els.list.append(h("li", {}, [button]));
    });
  }

  function formFromInvoice(invoice, extras) {
    return Object.assign({
      reference: invoice.reference,
      client: invoice.client,
      currency: invoice.currency,
      amount: DT.formatAmount(DT.moneyCents(invoice.amount)),
      paidAmount: DT.formatAmount(DT.moneyCents(invoice.paidAmount)),
      dueDate: invoice.dueDate,
      promiseDate: invoice.promiseDate || "",
      nextFollowUp: invoice.nextFollowUp || "",
      status: invoice.status,
      contactName: invoice.contactName || "",
      contactRole: invoice.contactRole || "",
      contactEmail: invoice.contactEmail || "",
      acceptanceNote: invoice.acceptanceNote || "",
      lastMessageSummary: invoice.lastMessageSummary || "",
      checklist: invoice.checklist,
      disputeNote: "",
    }, extras || {});
  }

function fieldValue(id) {
  const el = document.getElementById(id);
  return el ? el.value : null;
}

function paintDetail(invoice, options) {
  const activeId = document.activeElement && document.activeElement.id;
  const preserved = options && options.preserve ? {
    "log-note": fieldValue("log-note"),
    "log-promise": fieldValue("log-promise"),
    "log-follow": fieldValue("log-follow"),
    "pay-amount": fieldValue("pay-amount"),
    "pay-note": fieldValue("pay-note"),
    "inline-dispute": fieldValue("inline-dispute"),
  } : null;
    const day = today();
    const outstanding = DT.formatMoney(invoice.currency, DT.outstandingOf(invoice));
    const root = h("div", {});
    const back = h("button", { type: "button", class: "button", id: "back-button", text: "Back to queue" });
    back.addEventListener("click", function () {
      selectedId = null;
      pane = "queue";
      showDispute = false;
      detailMessage = "";
      renderAll();
      els.queueHeading.focus();
    });
    root.append(back);

    const kicker = h("p", { class: "detail-kicker" });
    kicker.append(
      h("span", { class: "badge badge-" + invoice.status, text: statusLabel(invoice.status) }),
      " ",
      h("span", { text: invoice.reference })
    );
    if (DT.isSampleId(invoice.id)) kicker.append(" ", h("span", { class: "badge badge-sample", text: "Sample" }));
    if (invoice.archived) kicker.append(" ", h("span", { class: "badge badge-archived", text: "Archived" }));
    root.append(kicker);

    const heading = h("h2", { id: "detail-heading", tabindex: "-1", text: invoice.client });
    root.append(heading);
    if (invoice.status !== "paid") {
      root.append(h("p", { class: "eyebrow", text: "Outstanding" }));
    }
    root.append(h("p", { class: "detail-money", text: invoice.status === "paid"
      ? DT.formatMoney(invoice.currency, invoice.amount)
      : outstanding }));
    let dueLine = "Due " + DT.formatLongDate(invoice.dueDate);
    if (invoice.status === "open" && invoice.dueDate < day) {
      const days = DT.daysBetween(invoice.dueDate, day);
      dueLine += " · " + days + (days === 1 ? " day overdue" : " days overdue");
    }
    if (invoice.promiseDate) {
      dueLine += " · promised " + DT.formatLongDate(invoice.promiseDate);
      if (invoice.promiseDate < day && invoice.status === "open") dueLine += " (missed)";
    }
    root.append(h("p", { class: "muted", text: dueLine }));

    const actions = h("div", { class: "row-actions" });
    const edit = h("button", { type: "button", class: "button", text: "Edit" });
    edit.addEventListener("click", function () { openEditor(invoice); });
    actions.append(edit);
    if (!invoice.archived && invoice.status === "open" && DT.outstandingCents(invoice) > 0) {
      const paid = h("button", { type: "button", class: "button", text: "Mark paid" });
      paid.addEventListener("click", function () { markPaid(invoice); });
      actions.append(paid);
      const dispute = h("button", { type: "button", class: "button", text: "Mark disputed" });
      dispute.addEventListener("click", function () {
        showDispute = true;
        detailMessage = "";
        paintDetail(findInvoice(invoice.id));
        const box = document.getElementById("inline-dispute");
        if (box) box.focus();
      });
      actions.append(dispute);
    }
    if (!invoice.archived && invoice.status === "disputed") {
      const reopen = h("button", { type: "button", class: "button", text: "Reopen follow-ups" });
      reopen.addEventListener("click", function () { reopenInvoice(invoice); });
      actions.append(reopen);
    }
    const archive = h("button", {
      type: "button",
      class: "button",
      text: invoice.archived ? "Restore from archive" : "Archive",
    });
    archive.addEventListener("click", function () { toggleArchive(invoice); });
    actions.append(archive);
    root.append(actions);

    const message = h("p", { id: "detail-error", class: "alert", role: "alert", tabindex: "-1" });
    if (detailMessage) message.textContent = detailMessage;
    else message.hidden = true;
    root.append(message);

    if (invoice.archived) {
      root.append(h("div", { class: "callout" }, [
        h("p", { text: "This invoice is archived. It is hidden from the queue and from outstanding totals. Restore it to chase it again." }),
      ]));
    } else if (invoice.status === "paid") {
      root.append(h("div", { class: "callout callout-paid" }, [
        h("p", { text: "Follow-ups are off because this invoice is paid. To chase a balance again, edit the paid amount so it is below the total and set the status to open." }),
      ]));
    } else if (invoice.status === "disputed") {
      root.append(h("div", { class: "callout callout-dispute" }, [
        h("p", { text: "Follow-ups are paused while this invoice is disputed. Reopen it when you are ready to chase the balance again. Recording a payment does not resume reminders unless the invoice is paid in full or you reopen it." }),
      ]));
    }

    if (showDispute && invoice.status === "open" && !invoice.archived) {
      const form = h("form", { class: "card", id: "dispute-inline-form" }, [
        h("h3", { text: "Why is this disputed?" }),
        h("label", { for: "inline-dispute", text: "Dispute note" }),
        h("textarea", { id: "inline-dispute", maxlength: "2000" }),
        h("div", { class: "row-actions" }, [
          h("button", { type: "submit", class: "button button-primary", text: "Pause follow-ups" }),
          h("button", { type: "button", class: "button", id: "dispute-cancel", text: "Cancel" }),
        ]),
      ]);
      form.addEventListener("submit", function (event) {
        event.preventDefault();
        const note = document.getElementById("inline-dispute").value;
        const result = DT.saveInvoiceEdits(invoice, formFromInvoice(invoice, { status: "disputed", disputeNote: note }), {
          at: new Date().toISOString(),
        });
        if (!result.ok) {
          detailMessage = result.summary;
          paintDetail(invoice);
          return;
        }
        replaceInvoice(result.invoice);
        persist();
        showDispute = false;
        detailMessage = "";
        announce("Invoice marked disputed. It left the follow-up queue.");
        renderAll({ focusHeading: true });
      });
      form.querySelector("#dispute-cancel").addEventListener("click", function () {
        showDispute = false;
        paintDetail(findInvoice(invoice.id));
      });
      root.append(form);
    }

    root.append(renderContext(invoice, day));
    root.append(renderChecklist(invoice));
    if (!invoice.archived && invoice.status !== "paid" && DT.outstandingCents(invoice) > 0) {
      root.append(renderPayment(invoice));
    }
    root.append(renderLog(invoice));
    root.append(renderReminder(invoice));
    root.append(renderActivity(invoice));

els.detail.replaceChildren(root);
  if (preserved) {
    Object.keys(preserved).forEach(function (id) {
      const el = document.getElementById(id);
      if (el && preserved[id] != null) el.value = preserved[id];
    });
  }
  if (options && options.focusHeading) heading.focus();
  else if (activeId && activeId !== "detail-heading") {
    const again = document.getElementById(activeId);
    if (again) again.focus();
  }
}

  function renderContext(invoice, day) {
    const card = h("section", { class: "card" }, [h("h3", { text: "Payment context" })]);
    const list = h("dl");
    const contact = [invoice.contactName, invoice.contactRole].filter(Boolean).join(" · ");
    const contactValue = h("div");
    contactValue.append(h("p", { class: "prose", text: contact || "Not recorded" }));
    if (invoice.contactEmail) {
      const copyEmail = h("button", { type: "button", class: "button button-quiet", text: "Copy address" });
      copyEmail.addEventListener("click", function () {
        copyText(invoice.contactEmail).then(function (ok) {
          announce(ok ? "Email address copied. Nothing was sent." : "Could not copy the address. Select it from the page instead.");
        });
      });
      contactValue.append(h("p", { text: invoice.contactEmail }));
      contactValue.append(copyEmail);
    }
    list.append(h("div", {}, [h("dt", { text: "Payment contact" }), h("dd", {}, [contactValue])]));

    const blockers = DT.blockerLabels(invoice);
    const blockerNode = h("div");
    if (!blockers.length) {
      blockerNode.append(h("p", { text: invoice.checklist.length ? "Nothing is marked as blocking submission." : "No submission checklist yet." }));
    } else {
      const ul = h("ul");
      blockers.forEach(function (label) { ul.append(h("li", { text: label })); });
      blockerNode.append(ul);
    }
    list.append(h("div", {}, [h("dt", { text: "Blocking payment" }), h("dd", {}, [blockerNode])]));
    list.append(defText("Acceptance", invoice.acceptanceNote));
    list.append(defText("Last message", invoice.lastMessageSummary));
    let promise = "Not recorded";
    if (invoice.promiseDate) {
      promise = DT.formatLongDate(invoice.promiseDate);
      if (invoice.promiseDate < day) promise += " · missed";
      else if (invoice.promiseDate === day) promise += " · due today";
    }
    list.append(defText("Promise date", promise));
    list.append(defText("Next follow-up", invoice.nextFollowUp ? DT.formatLongDate(invoice.nextFollowUp) : "Not scheduled"));
    card.append(list);
    return card;
  }

  function defText(term, text) {
    return h("div", {}, [
      h("dt", { text: term }),
      h("dd", { class: "prose", text: text || "Not recorded" }),
    ]);
  }

  function renderChecklist(invoice) {
    const card = h("section", { class: "card" }, [h("h3", { text: "Submission checklist" })]);
    if (!invoice.checklist.length) {
      card.append(h("p", { class: "muted", text: "No checklist yet. Edit the invoice to add a purchase order, portal upload, or acceptance step." }));
      return card;
    }
    const list = h("div", { class: "check-list" });
    invoice.checklist.forEach(function (item) {
      const id = "chk-" + item.id;
      const box = h("input", { type: "checkbox", id: id, checked: item.done });
      box.addEventListener("change", function () { toggleCheck(invoice.id, item.id, box.checked); });
      const label = h("label", { for: id, text: item.label });
      list.append(h("div", { class: "check-line" }, [box, label]));
    });
    card.append(list);
    return card;
  }

  function renderPayment(invoice) {
    const form = h("form", { class: "card", id: "payment-form" }, [
      h("h3", { text: "Record a payment" }),
      h("p", { class: "help", text: "Partial payments reduce the outstanding balance. A payment that covers the rest marks the invoice paid and removes it from the queue." }),
      h("label", { for: "pay-amount", text: "Amount received" }),
      h("input", { id: "pay-amount", inputmode: "decimal", maxlength: "13", autocomplete: "off" }),
      h("label", { for: "pay-note", text: "Note (optional)" }),
      h("input", { id: "pay-note", maxlength: "2000", autocomplete: "off" }),
      h("div", { class: "row-actions" }, [
        h("button", { type: "submit", class: "button button-primary", text: "Record payment" }),
      ]),
    ]);
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      const current = findInvoice(invoice.id);
      const result = DT.applyPayment(current, {
        amount: document.getElementById("pay-amount").value.trim(),
        note: document.getElementById("pay-note").value,
        at: new Date().toISOString(),
      });
      if (!result.ok) {
        detailMessage = result.error;
        paintDetail(current);
        const err = document.getElementById("detail-error");
        if (err) err.focus();
        return;
      }
      replaceInvoice(result.invoice);
      persist();
      detailMessage = "";
      const left = DT.outstandingOf(result.invoice);
      announce(result.invoice.status === "paid"
        ? "Payment recorded. This invoice is paid and left the follow-up queue."
        : "Partial payment recorded. Outstanding is now " + DT.formatMoney(result.invoice.currency, left) + ".");
      renderAll({ focusHeading: true });
    });
    return form;
  }

  function renderLog(invoice) {
    const can = DT.canFollowUp(invoice);
    const children = [
      h("h3", { text: "Log what happened" }),
      h("p", { class: "help", text: can
        ? "Write what you did after you send the reminder yourself. A new promise date or follow-up date is saved with the note."
        : "A note is saved in the history. Reminder follow-ups stay off while this invoice is paid, disputed, or archived." }),
      h("label", { for: "log-note", text: "What happened" }),
      h("textarea", { id: "log-note", maxlength: "2000" }),
    ];
    if (can) {
      children.push(
        h("label", { for: "log-promise", text: "Promise date" }),
        h("input", { id: "log-promise", type: "date", value: invoice.promiseDate || "", min: "1990-01-01", max: "9999-12-31" }),
        h("p", { class: "help", text: "Clear the date to remove a promise." }),
        h("label", { for: "log-follow", text: "Next follow-up" }),
        h("input", { id: "log-follow", type: "date", value: invoice.nextFollowUp || "", min: "1990-01-01", max: "9999-12-31" })
      );
    }
    children.push(h("div", { class: "row-actions" }, [
      h("button", { type: "submit", class: "button button-primary", text: "Save to history" }),
    ]));
    const form = h("form", { class: "card", id: "log-form" }, children);
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      const current = findInvoice(invoice.id);
      const note = document.getElementById("log-note").value;
      const at = new Date().toISOString();
      let result;
      if (DT.canFollowUp(current)) {
        const promiseValue = document.getElementById("log-promise").value;
        const followValue = document.getElementById("log-follow").value;
        const promiseChanged = promiseValue !== (current.promiseDate || "");
        const followChanged = followValue !== (current.nextFollowUp || "");
        result = DT.logFollowUp(current, {
          note: note,
          at: at,
          promiseDate: promiseChanged && promiseValue ? promiseValue : "",
          clearPromise: promiseChanged && !promiseValue,
          nextFollowUp: followChanged && followValue ? followValue : "",
          clearFollowUp: followChanged && !followValue,
        });
      } else {
        result = DT.addNote(current, { note: note, at: at });
      }
      if (!result.ok) {
        detailMessage = result.error;
        paintDetail(current);
        const err = document.getElementById("detail-error");
        if (err) err.focus();
        return;
      }
      replaceInvoice(result.invoice);
      persist();
      detailMessage = "";
      if (!DT.canFollowUp(current)) reminderState.dirty = false;
      announce("Saved to the invoice history in this browser.");
      renderAll({ focusHeading: true });
    });
    return form;
  }

  function renderReminder(invoice) {
    const card = h("section", { class: "card", id: "reminder-card" }, [h("h3", { text: "Reminder draft" })]);
    if (!DT.canFollowUp(invoice)) {
      card.append(h("p", { text: invoice.status === "disputed"
        ? "Follow-ups are paused while this invoice is disputed."
        : "Follow-ups are paused because this invoice is paid, archived, or has nothing outstanding." }));
      return card;
    }
    const tone = reminderState.invoiceId === invoice.id ? reminderState.tone : "friendly";
    reminderState.invoiceId = invoice.id;
    reminderState.tone = tone;
    const fieldset = h("fieldset", { class: "tone-row" }, [h("legend", { text: "Tone" })]);
    ["friendly", "direct", "final"].forEach(function (name) {
      const id = "tone-" + name;
      const input = h("input", { type: "radio", name: "tone", id: id, value: name, checked: name === tone });
      input.addEventListener("change", function () {
        if (!input.checked) return;
        reminderState.tone = name;
        reminderState.dirty = false;
        const built = DT.buildReminder(findInvoice(invoice.id), name, state.templates, state.senderName, today());
        const area = document.getElementById("reminder-draft");
        if (area && built.ok) {
          area.value = built.text;
          reminderState.text = built.text;
        }
      });
      const label = name.charAt(0).toUpperCase() + name.slice(1);
      fieldset.append(h("label", { for: id }, [input, label]));
    });
    card.append(fieldset);
    card.append(h("label", { for: "sender-name", text: "Sign reminders as" }));
    const sender = h("input", { id: "sender-name", maxlength: "80", value: state.senderName || "", autocomplete: "name" });
    sender.addEventListener("change", function () {
      state.senderName = sender.value.trim().slice(0, 80);
      sender.value = state.senderName;
      els.homeSender.value = state.senderName;
      persist();
      if (!reminderState.dirty) {
        const built = DT.buildReminder(findInvoice(invoice.id), reminderState.tone, state.templates, state.senderName, today());
        const area = document.getElementById("reminder-draft");
        if (area && built.ok) {
          area.value = built.text;
          reminderState.text = built.text;
        }
      }
    });
    card.append(sender);
    card.append(h("label", { for: "reminder-draft", text: "Draft" }));
    const built = DT.buildReminder(invoice, tone, state.templates, state.senderName, today());
    let text = built.ok ? built.text : "";
    if (reminderState.dirty && reminderState.invoiceId === invoice.id) text = reminderState.text;
    else reminderState.text = text;
    const area = h("textarea", { id: "reminder-draft", maxlength: "8000", value: text });
    area.addEventListener("input", function () {
      reminderState.dirty = true;
      reminderState.text = area.value;
      reminderState.invoiceId = invoice.id;
    });
    card.append(area);
    card.append(h("p", { class: "help", text: "Edit the draft if you want. Copy puts this text on the clipboard. DueTrail does not send it." }));
    const reset = h("button", { type: "button", class: "button", text: "Reset draft" });
    reset.addEventListener("click", function () {
      reminderState.dirty = false;
      const fresh = DT.buildReminder(findInvoice(invoice.id), reminderState.tone, state.templates, state.senderName, today());
      if (fresh.ok) {
        area.value = fresh.text;
        reminderState.text = fresh.text;
      }
      area.focus();
    });
    const copy = h("button", { type: "button", class: "button button-primary", text: "Copy message" });
    copy.addEventListener("click", function () {
      copyText(area.value).then(function (ok) {
        announce(ok ? "Reminder copied. Nothing was sent." : "Could not copy. Select the draft and copy it manually.");
      });
    });
    const templates = h("button", { type: "button", class: "button", text: "Edit templates" });
    templates.addEventListener("click", openTemplates);
    card.append(h("div", { class: "row-actions" }, [copy, reset, templates]));
    return card;
  }

  function renderActivity(invoice) {
    const card = h("section", { class: "card" }, [h("h3", { text: "Activity" })]);
    if (!invoice.activity.length) {
      card.append(h("p", { class: "muted", text: "No history yet." }));
      return card;
    }
    const list = h("ol", { class: "activity" });
    invoice.activity.slice().reverse().forEach(function (entry) {
      const label = DT.ACTIVITY_LABELS[entry.type] || entry.type;
      const title = entry.amount != null ? label + " · " + DT.formatMoney(invoice.currency, entry.amount) : label;
      list.append(h("li", {}, [
        h("span", { class: "activity-type", text: title }),
        h("time", { datetime: entry.at, text: DT.formatWhen(entry.at) }),
        entry.note ? h("p", { class: "prose", text: entry.note }) : null,
      ]));
    });
    card.append(list);
    return card;
  }

  function toggleCheck(invoiceId, itemId, done) {
    const current = findInvoice(invoiceId);
    if (!current) return;
    const next = DT.clone(current);
    const item = next.checklist.filter(function (entry) { return entry.id === itemId; })[0];
    if (!item || item.done === done) return;
    item.done = done;
    const at = new Date().toISOString();
    next.activity = next.activity.concat([{
      id: DT.generateId("act"),
      type: "edited",
      at: at,
      note: (done ? "Marked done: " : "Marked still open: ") + item.label,
    }]);
    next.updatedAt = at;
    const sanitized = DT.sanitizeInvoice(next);
    if (!sanitized.ok) {
      detailMessage = sanitized.summary;
      paintDetail(current);
      return;
    }
    replaceInvoice(sanitized.invoice);
    persist();
    detailMessage = "";
    renderTotals();
    renderQueue();
    renderList();
    paintDetail(sanitized.invoice, { preserve: true });
  }

  function markPaid(invoice) {
    const money = DT.formatMoney(invoice.currency, DT.outstandingOf(invoice));
    confirmAction({
      title: "Mark this invoice paid?",
      body: "The remaining " + money + " will be recorded as paid, and the invoice will leave the follow-up queue. This only changes data in this browser.",
      confirmLabel: "Mark paid",
    }).then(function (ok) {
      if (!ok) return;
      const current = findInvoice(invoice.id);
      const result = DT.applyPayment(current, {
        amount: DT.formatAmount(DT.outstandingCents(current)),
        note: "Marked paid in full.",
        at: new Date().toISOString(),
      });
      if (!result.ok) {
        detailMessage = result.error;
        paintDetail(current);
        return;
      }
      replaceInvoice(result.invoice);
      persist();
      detailMessage = "";
      reminderState.dirty = false;
      announce("Marked paid. Follow-ups for this invoice are off.");
      renderAll({ focusHeading: true });
    });
  }

  function reopenInvoice(invoice) {
    const result = DT.saveInvoiceEdits(invoice, formFromInvoice(invoice, { status: "open" }), {
      at: new Date().toISOString(),
    });
    if (!result.ok || result.invoice.status !== "open") {
      detailMessage = result.ok
        ? "Reduce the paid amount in Edit before reopening a fully paid invoice."
        : result.summary;
      paintDetail(invoice);
      return;
    }
    replaceInvoice(result.invoice);
    persist();
    detailMessage = "";
    announce("Follow-ups are available again.");
    renderAll({ focusHeading: true });
  }

  function toggleArchive(invoice) {
    const run = function () {
      const result = DT.setArchived(findInvoice(invoice.id), !invoice.archived, new Date().toISOString());
      if (!result.ok) {
        detailMessage = result.error;
        paintDetail(invoice);
        return;
      }
      replaceInvoice(result.invoice);
      persist();
      detailMessage = "";
      announce(result.invoice.archived ? "Invoice archived." : "Invoice restored from the archive.");
      renderAll({ focusHeading: true });
    };
    if (invoice.archived) {
      run();
      return;
    }
    confirmAction({
      title: "Archive this invoice?",
      body: "Archived invoices leave the queue and the outstanding totals. You can restore them later. This stays in this browser.",
      confirmLabel: "Archive",
    }).then(function (ok) { if (ok) run(); });
  }

  function sampleButton() {
  const button = h("button", { type: "button", class: "button button-primary", text: "Load sample invoices" });
  button.addEventListener("click", requestSampleReset);
  return button;
}

function renderSampleGuide() {
  const steps = document.getElementById("sample-steps");
  const note = document.getElementById("sample-note");
  if (!steps || !note) return;
  const queue = DT.actionQueue(state.invoices, today());
  const samples = state.invoices.filter(function (invoice) { return DT.isSampleId(invoice.id); });
  const first = queue[0];
  steps.replaceChildren();
  if (!state.invoices.length) {
    steps.append(
      h("li", { text: "Load the sample. It is a fictitious freelancer in Pakistan chasing overseas clients, with USD, EUR, PKR, and a disputed GBP invoice." }),
      h("li", { text: "Open the first follow-up, read what is blocking payment, and copy a reminder. You send it yourself." }),
      h("li", { text: "Log a promise or a partial payment. Paid and disputed invoices leave the queue." })
    );
    note.textContent = "The sample stays in this browser only. It is not a client list to reuse.";
    return;
  }
  steps.append(
    h("li", { text: first
      ? "Open " + first.client + " (" + first.reference + ") at the top of Today's follow-ups."
      : "Nothing is waiting in the queue. Open a paid or disputed invoice in the list to see why follow-ups are paused." }),
    h("li", { text: "Read the payment contact and the submission checklist. Edit a reminder, then copy it. DueTrail does not send it." }),
    h("li", { text: "Log what happened, record a partial payment, or mark the invoice disputed. The outstanding totals update in each currency on its own." })
  );
  note.textContent = samples.length
    ? "These clients are fictional. Do not replace them with real client or bank details."
    : "You are past the sample set. The same loop works on invoices you add. Planned Solo and Team prices are on the overview, and checkout is not open.";
}

function renderAll(options) {
    if (selectedId && !findInvoice(selectedId)) selectedId = null;
    if (document.activeElement !== els.homeSender) els.homeSender.value = state.senderName || "";
    renderSampleGuide();
    renderTotals();
    renderQueue();
    renderList();
    syncPane();
    if (selectedId) paintDetail(findInvoice(selectedId), options || {});
  }

  function openInvoice(id) {
    if (!findInvoice(id)) return;
    selectedId = id;
    pane = "detail";
    showDispute = false;
    detailMessage = "";
    reminderState = { invoiceId: id, tone: "friendly", dirty: false, text: "" };
    renderAll({ focusHeading: true });
  }

  function valueOf(id) {
    return document.getElementById(id).value;
  }

  function currencyFromForm() {
    const selected = valueOf("field-currency");
    if (selected === "OTHER") return valueOf("field-currency-other").trim().toUpperCase();
    return selected;
  }

  function fillCurrencySelect(code) {
    const select = document.getElementById("field-currency");
    const codes = DT.CURRENCIES.slice();
    if (code && codes.indexOf(code) === -1 && /^[A-Z]{3}$/.test(code)) codes.push(code);
    select.replaceChildren();
    codes.forEach(function (item) {
      const option = h("option", { value: item, text: item });
      select.append(option);
    });
    select.append(h("option", { value: "OTHER", text: "Other" }));
    if (code && codes.indexOf(code) !== -1) select.value = code;
    else if (code) select.value = "OTHER";
    else select.value = "USD";
    syncOtherCurrency();
    if (select.value === "OTHER") document.getElementById("field-currency-other").value = code || "";
  }

  function syncOtherCurrency() {
    const other = document.getElementById("field-currency").value === "OTHER";
    document.getElementById("currency-other-wrap").hidden = !other;
  }

  function syncDisputeField() {
    const status = valueOf("field-status");
    const existing = editingId ? findInvoice(editingId) : null;
    const wrap = document.getElementById("dispute-wrap");
    wrap.hidden = status !== "disputed";
    const entering = status === "disputed" && (!existing || existing.status !== "disputed");
    document.getElementById("dispute-help").textContent = entering
      ? "Required when you move an invoice into disputed. Follow-ups pause until you reopen it."
      : "Optional while it stays disputed.";
    document.getElementById("field-paid-help").textContent = status === "paid"
      ? "Saving as paid sets the paid amount to the invoice total."
      : "Leave at 0.00 if nothing has been paid yet.";
  }

  function clearFormErrors() {
    const box = document.getElementById("form-errors");
    box.hidden = true;
    box.replaceChildren();
    els.invoiceDialog.querySelectorAll(".field-error").forEach(function (node) { node.textContent = ""; });
    els.invoiceDialog.querySelectorAll("[aria-invalid]").forEach(function (node) {
      node.removeAttribute("aria-invalid");
    });
  }

  function fieldIdFor(key) {
    if (key === "currency" && valueOf("field-currency") === "OTHER") return "field-currency-other";
    const map = {
      reference: "field-reference",
      client: "field-client",
      currency: "field-currency",
      amount: "field-amount",
      paidAmount: "field-paid",
      dueDate: "field-due",
      promiseDate: "field-promise",
      nextFollowUp: "field-follow",
      status: "field-status",
      contactName: "field-contact-name",
      contactRole: "field-contact-role",
      contactEmail: "field-contact-email",
      acceptanceNote: "field-acceptance",
      lastMessageSummary: "field-last",
      checklist: "checklist-editor",
      disputeNote: "field-dispute",
    };
    return map[key] || "form-errors";
  }

  function showFormErrors(errors) {
    const box = document.getElementById("form-errors");
    const list = h("ul");
    Object.keys(errors).forEach(function (key) {
      const id = fieldIdFor(key);
      const input = document.getElementById(id);
      if (input) input.setAttribute("aria-invalid", "true");
      const slot = document.getElementById(id + "-error") || document.getElementById("field-checklist-error");
      if (slot && id !== "form-errors") slot.textContent = errors[key];
      const button = h("button", { type: "button", text: errors[key] });
      button.addEventListener("click", function () { if (input) input.focus(); });
      list.append(h("li", {}, [button]));
    });
    box.replaceChildren(h("p", { text: "Fix the highlighted fields." }), list);
    box.hidden = false;
    box.focus();
  }

  function readChecklistEditor() {
    const rows = els.invoiceDialog.querySelectorAll("#checklist-editor .check-row");
    const checklist = [];
    rows.forEach(function (row) {
      const label = row.querySelector(".check-label").value.trim();
      if (!label) return;
      checklist.push({
        id: row.dataset.id || DT.generateId("chk"),
        label: label,
        done: row.querySelector(".check-done").checked,
      });
    });
    return checklist;
  }

  function addChecklistRow(item) {
    const row = h("div", { class: "check-row", dataset: { id: item && item.id ? item.id : "" } });
    const box = h("input", {
      type: "checkbox",
      class: "check-done",
      checked: !!(item && item.done),
      "aria-label": "Done: " + ((item && item.label) || "checklist item"),
    });
    const input = h("input", {
      type: "text",
      class: "check-label",
      value: item && item.label ? item.label : "",
      maxlength: "140",
      "aria-label": (item && item.label) || "Checklist item",
    });
    input.addEventListener("input", function () {
      const name = input.value.trim() || "checklist item";
      box.setAttribute("aria-label", "Done: " + name);
      input.setAttribute("aria-label", name);
    });
    const remove = h("button", { type: "button", class: "button button-quiet", text: "Remove" });
    remove.addEventListener("click", function () { row.remove(); });
    row.append(box, input, remove);
    document.getElementById("checklist-editor").append(row);
    return input;
  }

  function openEditor(invoice) {
    editingId = invoice ? invoice.id : null;
    clearFormErrors();
    document.getElementById("invoice-dialog-title").textContent = invoice ? "Edit invoice" : "Add invoice";
    document.getElementById("invoice-save").textContent = invoice ? "Save changes" : "Save invoice";
    const blank = {
      reference: "",
      client: "",
      currency: "USD",
      amount: "",
      paidAmount: "0.00",
      dueDate: "",
      promiseDate: "",
      nextFollowUp: "",
      status: "open",
      contactName: "",
      contactRole: "Accounts payable",
      contactEmail: "",
      acceptanceNote: "",
      lastMessageSummary: "",
      checklist: [],
    };
    const source = invoice || blank;
    document.getElementById("field-reference").value = source.reference || "";
    document.getElementById("field-client").value = source.client || "";
    fillCurrencySelect(source.currency || "USD");
    document.getElementById("field-amount").value = invoice ? DT.formatAmount(DT.moneyCents(invoice.amount)) : "";
    document.getElementById("field-paid").value = invoice ? DT.formatAmount(DT.moneyCents(invoice.paidAmount)) : "0.00";
    document.getElementById("field-due").value = source.dueDate || "";
    document.getElementById("field-promise").value = source.promiseDate || "";
    document.getElementById("field-follow").value = source.nextFollowUp || "";
    document.getElementById("field-status").value = source.status || "open";
    document.getElementById("field-contact-name").value = source.contactName || "";
    document.getElementById("field-contact-role").value = source.contactRole || "";
    document.getElementById("field-contact-email").value = source.contactEmail || "";
    document.getElementById("field-acceptance").value = source.acceptanceNote || "";
    document.getElementById("field-last").value = source.lastMessageSummary || "";
    document.getElementById("field-dispute").value = "";
    document.getElementById("checklist-editor").replaceChildren();
    (source.checklist || []).forEach(function (item) { addChecklistRow(item); });
    syncDisputeField();
    els.invoiceDialog.showModal();
    document.getElementById("field-reference").focus();
  }

  function saveEditor(event) {
    event.preventDefault();
    clearFormErrors();
    const existing = editingId ? findInvoice(editingId) : null;
    const form = {
      reference: valueOf("field-reference"),
      client: valueOf("field-client"),
      currency: currencyFromForm(),
      amount: valueOf("field-amount").trim(),
      paidAmount: valueOf("field-paid").trim() || "0",
      dueDate: valueOf("field-due"),
      promiseDate: valueOf("field-promise"),
      nextFollowUp: valueOf("field-follow"),
      status: valueOf("field-status"),
      contactName: valueOf("field-contact-name"),
      contactRole: valueOf("field-contact-role"),
      contactEmail: valueOf("field-contact-email"),
      acceptanceNote: valueOf("field-acceptance"),
      lastMessageSummary: valueOf("field-last"),
      checklist: readChecklistEditor(),
      disputeNote: valueOf("field-dispute"),
    };
    const result = DT.saveInvoiceEdits(existing, form, {
      at: new Date().toISOString(),
      id: existing ? existing.id : DT.generateId("inv"),
    });
    if (!result.ok) {
      showFormErrors(result.errors || { form: result.summary });
      return;
    }
    if (existing) replaceInvoice(result.invoice);
    else state.invoices = state.invoices.concat([result.invoice]);
    if (storageBlocked) {
      showAlert("This invoice is in the session only. Browser storage is not accepting saves, so download a backup before you close the tab.");
    } else {
      persist();
    }
    els.invoiceDialog.close();
    selectedId = result.invoice.id;
    pane = "detail";
    showDispute = false;
    detailMessage = "";
    reminderState = { invoiceId: selectedId, tone: "friendly", dirty: false, text: "" };
    announce(existing ? "Invoice updated in this browser." : "Invoice added in this browser.");
    renderAll({ focusHeading: true });
  }

  function openTemplates() {
    document.getElementById("template-friendly").value = state.templates.friendly;
    document.getElementById("template-direct").value = state.templates.direct;
    document.getElementById("template-final").value = state.templates.final;
    const box = document.getElementById("template-errors");
    box.hidden = true;
    box.textContent = "";
    els.templateDialog.showModal();
    document.getElementById("template-friendly").focus();
  }

  function saveTemplates(event) {
    event.preventDefault();
    const cleaned = DT.sanitizeTemplates({
      friendly: document.getElementById("template-friendly").value,
      direct: document.getElementById("template-direct").value,
      final: document.getElementById("template-final").value,
    });
    const box = document.getElementById("template-errors");
    if (!cleaned.ok) {
      box.hidden = false;
      box.textContent = cleaned.error;
      box.focus();
      return;
    }
    state.templates = cleaned.templates;
    persist();
    reminderState.dirty = false;
    els.templateDialog.close();
    announce("Templates saved in this browser. Nothing was sent.");
    renderAll();
  }

  function confirmAction(options) {
    return new Promise(function (resolve) {
      const opener = document.activeElement;
      document.getElementById("confirm-title").textContent = options.title;
      document.getElementById("confirm-body").textContent = options.body;
      document.getElementById("confirm-ok").textContent = options.confirmLabel || "Confirm";
      function onClose() {
        els.confirmDialog.removeEventListener("close", onClose);
        if (opener && typeof opener.focus === "function") opener.focus();
        resolve(els.confirmDialog.returnValue === "ok");
      }
      els.confirmDialog.addEventListener("close", onClose);
      els.confirmDialog.showModal();
    });
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () { return true; }).catch(function () {
        return copyWithSelection(text);
      });
    }
    return Promise.resolve(copyWithSelection(text));
  }

  function copyWithSelection(text) {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.left = "-9999px";
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch (err) { ok = false; }
    area.remove();
    return ok;
  }

  function download(filename, content, type) {
    const blob = new Blob([content], { type: type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function bootMessage() {
    if (!storageInfo.persistent) {
      els.storageStatus.textContent = "Storage is blocked in this browser, so this session forgets everything when you close the tab. Download a backup if you want a copy. Even when storage works, it is not encrypted or a backup.";
      return;
    }
    if (boot.blocked) {
      els.storageStatus.textContent = "The sample records below are not written over the unreadable save.";
      showAlert("Saved data in this browser could not be read. " + boot.error + " Reset sample data only if you mean to replace that save.");
      return;
    }
    if (boot.seeded) {
      els.storageStatus.textContent = "A fictitious sample workspace was saved in this browser so you can try the follow-up loop. Reload keeps it on this device only.";
      return;
    }
    els.storageStatus.textContent = "Your last workspace in this browser was loaded. It still lives only on this device.";
  }

  function bind() {
    document.getElementById("add-button").addEventListener("click", function () { openEditor(null); });
    document.getElementById("invoice-cancel").addEventListener("click", function () { els.invoiceDialog.close(); });
    document.getElementById("invoice-form").addEventListener("submit", saveEditor);
    document.getElementById("field-currency").addEventListener("change", syncOtherCurrency);
    document.getElementById("field-status").addEventListener("change", syncDisputeField);
    document.getElementById("add-check-item").addEventListener("click", function () {
      const input = addChecklistRow({ label: "", done: false });
      input.focus();
    });
    document.getElementById("add-common-checks").addEventListener("click", function () {
      const existing = readChecklistEditor().map(function (item) { return item.label.toLowerCase(); });
      COMMON_CHECKS.forEach(function (label) {
        if (existing.indexOf(label.toLowerCase()) === -1) addChecklistRow({ label: label, done: false });
      });
    });
    document.getElementById("template-form").addEventListener("submit", saveTemplates);
    document.getElementById("template-cancel").addEventListener("click", function () { els.templateDialog.close(); });
    document.getElementById("template-reset").addEventListener("click", function () {
      const defaults = DT.defaultTemplates();
      document.getElementById("template-friendly").value = defaults.friendly;
      document.getElementById("template-direct").value = defaults.direct;
      document.getElementById("template-final").value = defaults.final;
      announce("Default wording is in the boxes. Save templates to keep it.");
    });
    document.getElementById("backup-button").addEventListener("click", function () {
      download("duetrail-backup.json", DT.serializeBackup(state), "application/json");
      announce("Backup downloaded. It is a file on this device, not an upload.");
    });
    document.getElementById("csv-button").addEventListener("click", function () {
      download("duetrail-invoices.csv", "\uFEFF" + DT.invoicesToCsv(state.invoices), "text/csv;charset=utf-8");
      announce("CSV downloaded. Spreadsheet formulas in text fields are prefixed so they stay text.");
    });
    document.getElementById("restore-button").addEventListener("click", function () {
      document.getElementById("restore-file").click();
    });
    document.getElementById("restore-file").addEventListener("change", function (event) {
      const file = event.target.files && event.target.files[0];
      event.target.value = "";
      if (!file) return;
      file.text().then(function (text) {
        const restored = DT.restoreBackup(state, text);
        if (!restored.ok) {
          showAlert(restored.error);
          announce(restored.error);
          return;
        }
        confirmAction({
          title: "Restore this backup?",
          body: "This replaces " + state.invoices.length + " invoice(s) in this browser with " + restored.state.invoices.length + " from the file. Nothing is uploaded.",
          confirmLabel: "Restore",
        }).then(function (ok) {
          if (!ok) {
            announce("Restore cancelled. Nothing was changed.");
            return;
          }
          state = restored.state;
          storageBlocked = false;
          selectedId = null;
          pane = "queue";
          showDispute = false;
          detailMessage = "";
          if (!persist()) {
            showAlert("The backup is loaded for this session, but this browser did not keep it.");
          } else {
            showAlert("");
          }
          announce("Backup restored in this browser.");
          renderAll();
          els.queueHeading.focus();
        });
      }).catch(function () {
        showAlert("That file could not be read. Nothing was changed.");
      });
    });
    document.getElementById("reset-sample").addEventListener("click", requestSampleReset);
    els.search.addEventListener("input", renderList);
    els.filter.addEventListener("change", renderList);
    els.homeSender.addEventListener("change", function () {
      state.senderName = els.homeSender.value.trim().slice(0, 80);
      els.homeSender.value = state.senderName;
      persist();
      if (selectedId && !reminderState.dirty) renderAll();
    });
    els.tabQueue.addEventListener("click", function () { setPane("queue"); });
    els.tabInvoices.addEventListener("click", function () { setPane("invoices"); });
    els.switcher.addEventListener("keydown", function (event) {
      if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
      event.preventDefault();
      const next = pane === "invoices" ? "queue" : "invoices";
      setPane(next);
      (next === "queue" ? els.tabQueue : els.tabInvoices).focus();
    });
    document.addEventListener("keydown", function (event) {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const tag = event.target && event.target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (event.target && event.target.isContentEditable) return;
      if (document.querySelector("dialog[open]")) return;
      event.preventDefault();
      if (isMobile() && pane !== "invoices") setPane("invoices");
      els.search.focus();
    });
    if (mobileQuery.addEventListener) mobileQuery.addEventListener("change", syncPane);
    else if (mobileQuery.addListener) mobileQuery.addListener(syncPane);
  }

  function requestSampleReset() {
    const replacing = state.invoices.length > 0;
    confirmAction({
      title: replacing ? "Reset to sample data?" : "Load sample invoices?",
      body: replacing
        ? "This replaces every invoice and template in this browser with the fictitious workspace. If a save was unreadable, this overwrites it."
        : "This fills the empty workspace with fictitious invoices so you can try the follow-up loop. Nothing is uploaded.",
      confirmLabel: replacing ? "Reset sample data" : "Load sample invoices",
    }).then(function (ok) {
      if (!ok) return;
      state = DT.buildSampleState(today());
      storageBlocked = false;
      selectedId = null;
      pane = "queue";
      const saved = persist();
      showAlert(saved ? "" : "Sample data is loaded for this session, but this browser did not keep it.");
      bootMessageAfterReset(saved);
      announce("Sample workspace restored in this browser.");
      renderAll();
      els.queueHeading.focus();
    });
  }

  function bootMessageAfterReset(saved) {
    els.storageStatus.textContent = saved
      ? "The fictitious sample workspace replaced what was stored in this browser."
      : "Sample data is only in this session because storage could not be written.";
  }

  bind();
  bootMessage();
  renderAll();
})();
