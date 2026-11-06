"use strict";

/**
 * DueTrail domain logic. Pure functions shared by the browser UI and node tests.
 * Money is calculated in integer cents. User-facing strings are returned as text;
 * callers must render them with textContent (or escapeHtml), never innerHTML.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.DueTrail = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const STORAGE_KEY = "duetrail.v1";
  const BACKUP_APP = "DueTrail";
  const BACKUP_VERSION = 1;

  const CURRENCIES = ["USD", "EUR", "GBP", "PKR", "AED", "SAR", "CAD", "AUD", "SGD", "INR"];
  const CURRENCY_ORDER = CURRENCIES.slice();

  const ACTIVITY_TYPES = [
    "created",
    "edited",
    "follow_up",
    "promise",
    "dispute",
    "partial_payment",
    "payment",
    "note",
    "reopened",
    "archived",
    "restored",
  ];

  const ACTIVITY_LABELS = {
    created: "Added",
    edited: "Edited",
    follow_up: "Follow-up",
    promise: "Promise",
    dispute: "Dispute",
    partial_payment: "Partial payment",
    payment: "Payment",
    note: "Note",
    reopened: "Reopened",
    archived: "Archived",
    restored: "Restored",
  };

  const REASON_LABELS = {
    missed_promise: "Missed promise",
    promise_due: "Promise due",
    overdue: "Overdue",
    follow_up: "Follow-up due",
  };

  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  let idSequence = 0;

  function generateId(prefix) {
    idSequence += 1;
    const rand = Math.random().toString(36).slice(2, 8);
    const time = Date.now().toString(36);
    return prefix + "_" + time + "_" + idSequence + "_" + rand;
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function isValidISODate(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parts = value.split("-").map(Number);
    const year = parts[0];
    const month = parts[1];
    const day = parts[2];
    if (year < 1900 || year > 9999) return false;
    const utc = new Date(Date.UTC(year, month - 1, day));
    return utc.getUTCFullYear() === year && utc.getUTCMonth() === month - 1 && utc.getUTCDate() === day;
  }

  function isValidTimestamp(value) {
    if (typeof value !== "string" || value.length > 40) return false;
    if (isValidISODate(value)) return true;
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(value)) return false;
    return isValidISODate(value.slice(0, 10));
  }

  function todayISO(now) {
    const date = now instanceof Date ? now : new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return year + "-" + month + "-" + day;
  }

  function addDaysISO(iso, days) {
    if (!isValidISODate(iso)) throw new Error("Invalid date");
    const parts = iso.split("-").map(Number);
    const utc = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
    utc.setUTCDate(utc.getUTCDate() + days);
    const year = utc.getUTCFullYear();
    const month = String(utc.getUTCMonth() + 1).padStart(2, "0");
    const day = String(utc.getUTCDate()).padStart(2, "0");
    return year + "-" + month + "-" + day;
  }

  function daysBetween(fromISO, toISO) {
    if (!isValidISODate(fromISO) || !isValidISODate(toISO)) throw new Error("Invalid date");
    const from = fromISO.split("-").map(Number);
    const to = toISO.split("-").map(Number);
    const a = Date.UTC(from[0], from[1] - 1, from[2]);
    const b = Date.UTC(to[0], to[1] - 1, to[2]);
    return Math.round((b - a) / 86400000);
  }

  function formatLongDate(iso) {
    if (!isValidISODate(iso)) return "";
    const parts = iso.split("-").map(Number);
    return parts[2] + " " + MONTHS[parts[1] - 1] + " " + parts[0];
  }

  function formatWhen(at) {
    if (typeof at !== "string" || at.length < 10) return "";
    const long = formatLongDate(at.slice(0, 10));
    if (!long) return "";
    if (at.length === 10) return long;
    const time = at.slice(11, 16);
    return time ? long + " · " + time + " UTC" : long;
  }

  function parseMoney(input) {
    if (typeof input === "number") {
      if (!Number.isFinite(input) || input < 0) {
        return { ok: false, error: "Use an amount with up to 2 decimal places." };
      }
      const asText = String(input);
      if (/e/i.test(asText)) {
        return { ok: false, error: "That amount is too large." };
      }
      if (!/^\d+(\.\d+)?$/.test(asText)) {
        return { ok: false, error: "Use an amount with up to 2 decimal places." };
      }
      return parseMoney(asText);
    }
    if (typeof input !== "string") {
      return { ok: false, error: "Use an amount with up to 2 decimal places." };
    }
    const text = input.trim();
    if (!/^\d+(\.\d{1,2})?$/.test(text)) {
      return { ok: false, error: "Use an amount with up to 2 decimal places." };
    }
    const bits = text.split(".");
    const whole = bits[0];
    const frac = bits[1] || "";
    if (whole.length > 10) return { ok: false, error: "That amount is too large." };
    const cents = Number(whole) * 100 + Number((frac + "00").slice(0, 2));
    if (!Number.isSafeInteger(cents)) return { ok: false, error: "That amount is too large." };
    return { ok: true, cents: cents };
  }

  function centsToAmount(cents) {
    return Number((cents / 100).toFixed(2));
  }

  function formatAmount(cents) {
    const negative = cents < 0;
    const absolute = Math.abs(cents);
    const whole = Math.floor(absolute / 100);
    const frac = String(absolute % 100).padStart(2, "0");
    return (negative ? "-" : "") + whole + "." + frac;
  }

  function moneyCents(amount) {
    if (typeof amount === "number") {
      const parsed = parseMoney(amount);
      return parsed.ok ? parsed.cents : 0;
    }
    const parsed = parseMoney(String(amount));
    return parsed.ok ? parsed.cents : 0;
  }

  function formatMoney(currency, amount) {
    const cents = typeof amount === "number" ? moneyCents(amount) : moneyCents(String(amount));
    const numeric = centsToAmount(cents);
    const code = /^[A-Z]{3}$/.test(currency) ? currency : "USD";
    try {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: code,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(numeric);
    } catch (err) {
      return code + " " + formatAmount(cents);
    }
  }

  function rawOutstandingCents(invoice) {
    const total = moneyCents(invoice.amount);
    const paid = moneyCents(invoice.paidAmount);
    return Math.max(0, total - paid);
  }

  function outstandingCents(invoice) {
    if (!invoice || invoice.status === "paid") return 0;
    return rawOutstandingCents(invoice);
  }

  function outstandingOf(invoice) {
    return centsToAmount(outstandingCents(invoice));
  }

  function outstandingByCurrency(invoices) {
    const open = {};
    const disputed = {};
    for (let i = 0; i < invoices.length; i += 1) {
      const invoice = invoices[i];
      if (!invoice || invoice.archived) continue;
      const cents = outstandingCents(invoice);
      if (cents <= 0) continue;
      const bucket = invoice.status === "disputed" ? disputed : open;
      if (invoice.status !== "open" && invoice.status !== "disputed") continue;
      bucket[invoice.currency] = (bucket[invoice.currency] || 0) + cents;
    }
    return { open: centsMapToAmounts(open), disputed: centsMapToAmounts(disputed) };
  }

  function centsMapToAmounts(centsByCurrency) {
    const amounts = {};
    const codes = Object.keys(centsByCurrency);
    for (let i = 0; i < codes.length; i += 1) {
      amounts[codes[i]] = centsToAmount(centsByCurrency[codes[i]]);
    }
    return amounts;
  }

  function summarizeMoney(invoices) {
    const totals = outstandingByCurrency(invoices);
    const counts = { open: {}, disputed: {} };
    for (let i = 0; i < invoices.length; i += 1) {
      const invoice = invoices[i];
      if (!invoice || invoice.archived) continue;
      if (outstandingCents(invoice) <= 0) continue;
      if (invoice.status === "disputed") {
        counts.disputed[invoice.currency] = (counts.disputed[invoice.currency] || 0) + 1;
      } else if (invoice.status === "open") {
        counts.open[invoice.currency] = (counts.open[invoice.currency] || 0) + 1;
      }
    }
    return { totals: totals, counts: counts };
  }

  function sortCurrencies(codes) {
    return codes.slice().sort(function (a, b) {
      const ia = CURRENCY_ORDER.indexOf(a);
      const ib = CURRENCY_ORDER.indexOf(b);
      if (ia === -1 && ib === -1) return a.localeCompare(b);
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    });
  }

  function canFollowUp(invoice) {
    if (!invoice || invoice.archived) return false;
    if (invoice.status === "paid" || invoice.status === "disputed") return false;
    if (invoice.status !== "open") return false;
    return outstandingCents(invoice) > 0;
  }

  function blockerLabels(invoice) {
    if (!invoice || !Array.isArray(invoice.checklist)) return [];
    const labels = [];
    for (let i = 0; i < invoice.checklist.length; i += 1) {
      if (!invoice.checklist[i].done) labels.push(invoice.checklist[i].label);
    }
    return labels;
  }

  function actionQueue(invoices, today) {
    if (!isValidISODate(today)) throw new Error("actionQueue requires a valid today date");
    const items = [];
    for (let i = 0; i < invoices.length; i += 1) {
      const invoice = invoices[i];
      if (!canFollowUp(invoice)) continue;
      const reasons = [];
      if (invoice.promiseDate) {
        if (invoice.promiseDate < today) reasons.push("missed_promise");
        else if (invoice.promiseDate === today) reasons.push("promise_due");
      }
      if (invoice.dueDate < today) reasons.push("overdue");
      if (invoice.nextFollowUp && invoice.nextFollowUp <= today) reasons.push("follow_up");
      if (reasons.length === 0) continue;

      let sortTier = 2;
      let sortKey = invoice.nextFollowUp || invoice.dueDate;
      let primary = "follow_up";
      if (reasons.indexOf("missed_promise") !== -1 || reasons.indexOf("promise_due") !== -1) {
        sortTier = 0;
        sortKey = invoice.promiseDate;
        primary = reasons.indexOf("missed_promise") !== -1 ? "missed_promise" : "promise_due";
      } else if (reasons.indexOf("overdue") !== -1) {
        sortTier = 1;
        sortKey = invoice.dueDate;
        primary = "overdue";
      }

      items.push({
        id: invoice.id,
        reference: invoice.reference,
        client: invoice.client,
        currency: invoice.currency,
        outstanding: outstandingOf(invoice),
        dueDate: invoice.dueDate,
        promiseDate: invoice.promiseDate || "",
        nextFollowUp: invoice.nextFollowUp || "",
        reasons: reasons,
        primaryReason: primary,
        sortTier: sortTier,
        sortKey: sortKey,
        blockerCount: blockerLabels(invoice).length,
      });
    }
    items.sort(function (a, b) {
      if (a.sortTier !== b.sortTier) return a.sortTier - b.sortTier;
      if (a.sortKey !== b.sortKey) return a.sortKey < b.sortKey ? -1 : 1;
      return a.reference < b.reference ? -1 : a.reference > b.reference ? 1 : 0;
    });
    return items;
  }

  function reasonLabel(code) {
    return REASON_LABELS[code] || code;
  }

  function queueSummary(item, today) {
    const parts = [];
    if (item.reasons.indexOf("missed_promise") !== -1) {
      const days = daysBetween(item.promiseDate, today);
      parts.push("Promise missed " + formatLongDate(item.promiseDate) + " (" + days + " day" + (days === 1 ? "" : "s") + " ago)");
    } else if (item.reasons.indexOf("promise_due") !== -1) {
      parts.push("Promise due " + formatLongDate(item.promiseDate));
    } else if (item.promiseDate && item.promiseDate > today) {
      parts.push("Promised " + formatLongDate(item.promiseDate));
    }
    if (item.reasons.indexOf("overdue") !== -1) {
      const days = daysBetween(item.dueDate, today);
      parts.push(days + " day" + (days === 1 ? "" : "s") + " overdue");
    }
    if (item.primaryReason === "follow_up") {
      parts.push(item.nextFollowUp === today ? "Check-in scheduled today" : "Check-in was due " + formatLongDate(item.nextFollowUp));
    }
    if (item.blockerCount > 0) {
      parts.push(item.blockerCount + " blocker" + (item.blockerCount === 1 ? "" : "s"));
    }
    return parts.join(" · ");
  }

  function readLine(value, max, label, required) {
    if (value == null || value === "") {
      return required ? { error: label + " is required." } : { text: "" };
    }
    if (typeof value !== "string" && typeof value !== "number") {
      return { error: label + " must be text." };
    }
    const text = String(value).replace(/\s+/g, " ").trim();
    if (!text) return required ? { error: label + " is required." } : { text: "" };
    if (/[\u0000-\u001F\u007F]/.test(text)) return { error: label + " contains unsupported characters." };
    if (text.length > max) return { error: label + " must be " + max + " characters or fewer." };
    return { text: text };
  }

  function readNote(value, max, label) {
    if (value == null || value === "") return { text: "" };
    if (typeof value !== "string") return { error: label + " must be text." };
    const text = value.replace(/\r\n/g, "\n").trim();
    if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(text)) {
      return { error: label + " contains unsupported characters." };
    }
    if (text.length > max) return { error: label + " must be " + max + " characters or fewer." };
    return { text: text };
  }

  function fail(errors) {
    const keys = Object.keys(errors);
    return { ok: false, errors: errors, summary: errors[keys[0]] };
  }

  function sanitizeChecklist(raw) {
    if (raw == null) return { ok: true, checklist: [] };
    if (!Array.isArray(raw)) return { ok: false, error: "Checklist must be a list." };
    if (raw.length > 20) return { ok: false, error: "A checklist can have at most 20 items." };
    const checklist = [];
    for (let i = 0; i < raw.length; i += 1) {
      const item = raw[i];
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return { ok: false, error: "A checklist item is invalid." };
      }
      const label = readLine(item.label, 140, "Checklist item", true);
      if (label.error) return { ok: false, error: label.error };
      let id = "";
      if (typeof item.id === "string" && item.id.trim()) {
        if (item.id.trim().length > 80 || /[\u0000-\u001F\u007F]/.test(item.id)) {
          return { ok: false, error: "A checklist item id is invalid." };
        }
        id = item.id.trim();
      } else {
        id = generateId("chk");
      }
      checklist.push({ id: id, label: label.text, done: item.done === true });
    }
    return { ok: true, checklist: checklist };
  }

  function sanitizeActivity(raw) {
    if (raw == null) return { ok: true, activity: [] };
    if (!Array.isArray(raw)) return { ok: false, error: "Activity must be a list." };
    if (raw.length > 300) return { ok: false, error: "Activity history is too long." };
    const activity = [];
    for (let i = 0; i < raw.length; i += 1) {
      const item = raw[i];
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return { ok: false, error: "An activity entry is invalid." };
      }
      if (typeof item.id !== "string" || !item.id.trim() || item.id.trim().length > 80 || /[\u0000-\u001F\u007F]/.test(item.id)) {
        return { ok: false, error: "An activity entry is missing an id." };
      }
      if (ACTIVITY_TYPES.indexOf(item.type) === -1) {
        return { ok: false, error: "An activity entry has an unknown type." };
      }
      if (!isValidTimestamp(item.at)) return { ok: false, error: "An activity entry has an invalid time." };
      const note = readNote(item.note == null ? "" : item.note, 2000, "Activity note");
      if (note.error) return { ok: false, error: note.error };
      const entry = { id: item.id.trim(), type: item.type, at: item.at, note: note.text };
      if (item.amount != null && item.amount !== "") {
        const money = parseMoney(item.amount);
        if (!money.ok) return { ok: false, error: "An activity amount is invalid." };
        entry.amount = centsToAmount(money.cents);
      }
      if (item.promiseDate) {
        if (!isValidISODate(item.promiseDate)) return { ok: false, error: "An activity promise date is invalid." };
        entry.promiseDate = item.promiseDate;
      }
      activity.push(entry);
    }
    return { ok: true, activity: activity };
  }

  function sanitizeInvoice(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return fail({ invoice: "Invoice must be an object." });
    }
    const errors = {};

    let id = "";
    if (typeof raw.id !== "string" || !raw.id.trim() || raw.id.trim().length > 80 || /[\u0000-\u001F\u007F]/.test(raw.id)) {
      errors.id = "Invoice id is missing.";
    } else {
      id = raw.id.trim();
    }

    const reference = readLine(raw.reference, 40, "Invoice reference", true);
    if (reference.error) errors.reference = reference.error;

    const client = readLine(raw.client, 120, "Client", true);
    if (client.error) errors.client = client.error;

    const currency = typeof raw.currency === "string" ? raw.currency.trim().toUpperCase() : "";
    if (!/^[A-Z]{3}$/.test(currency)) {
      errors.currency = "Use a 3-letter currency code such as USD, EUR, GBP, or PKR.";
    }

    const amountParsed = parseMoney(raw.amount);
    if (!amountParsed.ok || amountParsed.cents <= 0) {
      errors.amount = "Enter an invoice total greater than zero, with up to 2 decimal places.";
    }
    const paidSource = raw.paidAmount == null || raw.paidAmount === "" ? "0" : raw.paidAmount;
    const paidParsed = parseMoney(paidSource);
    if (!paidParsed.ok) errors.paidAmount = "Enter a paid amount with up to 2 decimal places.";
    else if (amountParsed.ok && paidParsed.cents > amountParsed.cents) {
      errors.paidAmount = "Paid amount cannot exceed the invoice total.";
    }

    if (typeof raw.dueDate !== "string" || !isValidISODate(raw.dueDate)) {
      errors.dueDate = "Enter a real due date.";
    }
    const promiseDate = raw.promiseDate == null ? "" : raw.promiseDate;
    if (promiseDate !== "" && !isValidISODate(promiseDate)) errors.promiseDate = "Enter a real promise date, or leave it blank.";
    const nextFollowUp = raw.nextFollowUp == null ? "" : raw.nextFollowUp;
    if (nextFollowUp !== "" && !isValidISODate(nextFollowUp)) {
      errors.nextFollowUp = "Enter a real follow-up date, or leave it blank.";
    }

    if (raw.status !== "open" && raw.status !== "paid" && raw.status !== "disputed") {
      errors.status = "Status must be open, paid, or disputed.";
    }
    if (raw.archived != null && typeof raw.archived !== "boolean") {
      errors.archived = "Archived must be true or false.";
    }

    const contactName = readLine(raw.contactName, 80, "Contact name", false);
    if (contactName.error) errors.contactName = contactName.error;
    const contactRole = readLine(raw.contactRole, 80, "Contact role", false);
    if (contactRole.error) errors.contactRole = contactRole.error;
    const contactEmail = readLine(raw.contactEmail, 120, "Contact email", false);
    if (contactEmail.error) errors.contactEmail = contactEmail.error;
    else if (contactEmail.text && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail.text)) {
      errors.contactEmail = "Enter a valid email, or leave it blank.";
    }

    const acceptance = readNote(raw.acceptanceNote == null ? "" : raw.acceptanceNote, 2000, "Acceptance note");
    if (acceptance.error) errors.acceptanceNote = acceptance.error;
    const lastMessage = readNote(raw.lastMessageSummary == null ? "" : raw.lastMessageSummary, 280, "Last message");
    if (lastMessage.error) errors.lastMessageSummary = lastMessage.error;

    const checklist = sanitizeChecklist(raw.checklist);
    if (!checklist.ok) errors.checklist = checklist.error;
    const activity = sanitizeActivity(raw.activity);
    if (!activity.ok) errors.activity = activity.error;

    if (!isValidTimestamp(raw.createdAt)) errors.createdAt = "Invoice is missing a created time.";
    if (!isValidTimestamp(raw.updatedAt)) errors.updatedAt = "Invoice is missing an updated time.";

    if (Object.keys(errors).length) return fail(errors);

    let paidCents = paidParsed.cents;
    let status = raw.status;
    if (status === "paid" || paidCents === amountParsed.cents) {
      status = "paid";
      paidCents = amountParsed.cents;
    }

    return {
      ok: true,
      invoice: {
        id: id,
        reference: reference.text,
        client: client.text,
        currency: currency,
        amount: centsToAmount(amountParsed.cents),
        paidAmount: centsToAmount(paidCents),
        dueDate: raw.dueDate,
        promiseDate: promiseDate || "",
        nextFollowUp: nextFollowUp || "",
        status: status,
        archived: raw.archived === true,
        contactName: contactName.text,
        contactRole: contactRole.text,
        contactEmail: contactEmail.text,
        acceptanceNote: acceptance.text,
        lastMessageSummary: lastMessage.text,
        checklist: checklist.checklist,
        activity: activity.activity,
        createdAt: raw.createdAt,
        updatedAt: raw.updatedAt,
      },
    };
  }

  function defaultTemplates() {
    return {
      friendly:
        "Hi {{contact}},\n\n" +
        "I hope you're well. I'm checking in on invoice {{reference}} for {{client}}. The outstanding balance is {{outstanding}}, and it was due on {{due}}.\n\n" +
        "{{checklist}}\n\n" +
        "{{promise}}\n\n" +
        "Could you tell me when this is likely to be paid, or what is still missing on your side? If something is blocking payment, reply with that and a date, and I will pause reminders on my side.\n\n" +
        "Thank you,\n{{sender}}",
      direct:
        "Hello {{contact}},\n\n" +
        "Invoice {{reference}} for {{client}} ({{outstanding}}) was due on {{due}} and is still open.\n\n" +
        "{{checklist}}\n\n" +
        "{{promise}}\n\n" +
        "Please confirm when this will be paid, or tell me what your accounts team still needs. Nothing is sent from DueTrail — this draft is for you to review and send yourself.\n\n" +
        "Thank you,\n{{sender}}",
      final:
        "Hello {{contact}},\n\n" +
        "This is a last reminder about invoice {{reference}} for {{client}}. {{outstanding}} is still outstanding. It was due on {{due}}.\n\n" +
        "{{promise}}\n\n" +
        "{{checklist}}\n\n" +
        "Please pay or send a confirmed payment date by {{followUpBy}}. If something is wrong with the invoice, reply and I will pause reminders while we sort it out. I can't treat a message as a guarantee of payment.\n\n" +
        "Thank you,\n{{sender}}",
    };
  }

  function sanitizeTemplates(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return { ok: false, error: "Templates are missing." };
    }
    const keys = ["friendly", "direct", "final"];
    const templates = {};
    for (let i = 0; i < keys.length; i += 1) {
      const key = keys[i];
      if (typeof raw[key] !== "string") return { ok: false, error: "The " + key + " template must be text." };
      const text = raw[key].replace(/\r\n/g, "\n");
      if (!text.trim()) return { ok: false, error: "The " + key + " template is empty." };
      if (text.length > 5000) return { ok: false, error: "The " + key + " template is too long." };
      if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(text)) {
        return { ok: false, error: "The " + key + " template contains unsupported characters." };
      }
      templates[key] = text;
    }
    return { ok: true, templates: templates };
  }

  function fillTemplate(template, vars) {
    return String(template).replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, function (match, key) {
      if (Object.prototype.hasOwnProperty.call(vars, key)) return String(vars[key]);
      return match;
    });
  }

  function reminderVars(invoice, senderName, today) {
    const contact = invoice.contactName ? invoice.contactName : "there";
    const outstanding = formatMoney(invoice.currency, outstandingOf(invoice));
    const openItems = blockerLabels(invoice);
    const checklist = openItems.length
      ? "Still needed before payment can move:\n" + openItems.map(function (label) { return "• " + label; }).join("\n")
      : "Submission checklist: nothing is marked outstanding.";
    let promise = "No payment date has been promised yet.";
    if (invoice.promiseDate) {
      if (invoice.promiseDate < today) {
        promise = "A payment was promised on " + formatLongDate(invoice.promiseDate) + ", which has passed.";
      } else if (invoice.promiseDate === today) {
        promise = "A payment was promised for today, " + formatLongDate(invoice.promiseDate) + ".";
      } else {
        promise = "The latest promised payment date is " + formatLongDate(invoice.promiseDate) + ".";
      }
    }
    const sender = senderName && String(senderName).trim() ? String(senderName).trim() : "Your name";
    return {
      contact: contact,
      client: invoice.client,
      reference: invoice.reference,
      currency: invoice.currency,
      outstanding: outstanding,
      due: formatLongDate(invoice.dueDate),
      promise: promise,
      checklist: checklist,
      sender: sender,
      followUpBy: formatLongDate(addDaysISO(today, 5)),
    };
  }

  function buildReminder(invoice, tone, templates, senderName, today) {
    if (!canFollowUp(invoice)) {
      if (invoice && invoice.status === "disputed") {
        return { ok: false, error: "Follow-ups are paused while this invoice is disputed." };
      }
      return { ok: false, error: "Follow-ups are paused because this invoice is paid or has nothing outstanding." };
    }
    if (!isValidISODate(today)) return { ok: false, error: "Today's date is invalid." };
    const cleaned = sanitizeTemplates(templates);
    if (!cleaned.ok) return { ok: false, error: cleaned.error };
    if (!cleaned.templates[tone]) return { ok: false, error: "Unknown reminder tone." };
    return { ok: true, text: fillTemplate(cleaned.templates[tone], reminderVars(invoice, senderName, today)) };
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function csvCell(value) {
    let text = value == null ? "" : String(value);
    if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
    if (/[",\n\r]/.test(text)) text = '"' + text.replace(/"/g, '""') + '"';
    return text;
  }

  function invoicesToCsv(invoices) {
    const headers = [
      "Reference",
      "Client",
      "Currency",
      "Amount",
      "Paid",
      "Outstanding",
      "Due date",
      "Promise date",
      "Next follow-up",
      "Status",
      "Archived",
      "Contact name",
      "Contact role",
      "Contact email",
      "Blockers",
      "Last message",
    ];
    const lines = [headers.map(csvCell).join(",")];
    for (let i = 0; i < invoices.length; i += 1) {
      const invoice = invoices[i];
      const row = [
        invoice.reference,
        invoice.client,
        invoice.currency,
        formatAmount(moneyCents(invoice.amount)),
        formatAmount(moneyCents(invoice.paidAmount)),
        formatAmount(outstandingCents(invoice)),
        invoice.dueDate,
        invoice.promiseDate || "",
        invoice.nextFollowUp || "",
        invoice.status,
        invoice.archived ? "yes" : "no",
        invoice.contactName || "",
        invoice.contactRole || "",
        invoice.contactEmail || "",
        blockerLabels(invoice).join("; "),
        invoice.lastMessageSummary || "",
      ];
      lines.push(row.map(csvCell).join(","));
    }
    return lines.join("\r\n") + "\r\n";
  }

  function appendActivity(invoice, entry) {
    const next = clone(invoice);
    next.activity = next.activity.concat([entry]);
    next.updatedAt = entry.at;
    return next;
  }

  function applyPayment(invoice, input) {
    if (!invoice) return { ok: false, error: "Invoice not found." };
    if (invoice.archived) return { ok: false, error: "Unarchive this invoice before recording a payment." };
    if (invoice.status === "paid") return { ok: false, error: "This invoice is already paid." };
    const parsed = parseMoney(input && input.amount != null ? input.amount : "");
    if (!parsed.ok || parsed.cents <= 0) {
      return { ok: false, error: "Enter a payment greater than zero, with up to 2 decimal places." };
    }
    const remaining = rawOutstandingCents(invoice);
    if (remaining <= 0) return { ok: false, error: "Nothing is outstanding on this invoice." };
    if (parsed.cents > remaining) return { ok: false, error: "That payment is larger than the outstanding balance." };
    if (!input.at || !isValidTimestamp(input.at)) return { ok: false, error: "Payment time is invalid." };
    const noteText = readNote(input.note == null ? "" : input.note, 2000, "Payment note");
    if (noteText.error) return { ok: false, error: noteText.error };
    const fully = parsed.cents === remaining;
    const newPaid = moneyCents(invoice.paidAmount) + parsed.cents;
    const next = clone(invoice);
    next.paidAmount = centsToAmount(fully ? moneyCents(invoice.amount) : newPaid);
    next.status = fully ? "paid" : invoice.status;
    const note = noteText.text || (fully ? "Payment recorded in full." : "Partial payment recorded.");
    next.activity = next.activity.concat([{
      id: generateId("act"),
      type: fully ? "payment" : "partial_payment",
      at: input.at,
      note: note,
      amount: centsToAmount(parsed.cents),
    }]);
    next.updatedAt = input.at;
    return { ok: true, invoice: next };
  }

  function logFollowUp(invoice, input) {
    if (!canFollowUp(invoice)) {
      return { ok: false, error: "Follow-ups are paused for paid and disputed invoices." };
    }
    const note = readNote(input && input.note ? input.note : "", 2000, "Follow-up note");
    if (note.error) return { ok: false, error: note.error };
    if (!note.text) return { ok: false, error: "Write a short note about what happened." };
    if (!input.at || !isValidTimestamp(input.at)) return { ok: false, error: "Follow-up time is invalid." };

    let promiseDate = invoice.promiseDate || "";
    if (input.promiseDate) {
      if (!isValidISODate(input.promiseDate)) return { ok: false, error: "Promise date is not a real date." };
      promiseDate = input.promiseDate;
    } else if (input.clearPromise) {
      promiseDate = "";
    }
    let nextFollowUp = invoice.nextFollowUp || "";
    if (input.nextFollowUp) {
      if (!isValidISODate(input.nextFollowUp)) return { ok: false, error: "Follow-up date is not a real date." };
      nextFollowUp = input.nextFollowUp;
    } else if (input.clearFollowUp) {
      nextFollowUp = "";
    }

    const next = clone(invoice);
    next.promiseDate = promiseDate;
    next.nextFollowUp = nextFollowUp;
    next.lastMessageSummary = note.text.slice(0, 280);
    const entry = {
      id: generateId("act"),
      type: input.promiseDate ? "promise" : "follow_up",
      at: input.at,
      note: note.text,
    };
    if (promiseDate) entry.promiseDate = promiseDate;
    next.activity = next.activity.concat([entry]);
    next.updatedAt = input.at;
    return { ok: true, invoice: next };
  }

  function addNote(invoice, input) {
    if (!invoice) return { ok: false, error: "Invoice not found." };
    const note = readNote(input && input.note ? input.note : "", 2000, "Note");
    if (note.error) return { ok: false, error: note.error };
    if (!note.text) return { ok: false, error: "Write a note before saving." };
    if (!input.at || !isValidTimestamp(input.at)) return { ok: false, error: "Note time is invalid." };
    const entry = { id: generateId("act"), type: "note", at: input.at, note: note.text };
    return { ok: true, invoice: appendActivity(invoice, entry) };
  }

  function setArchived(invoice, archived, at) {
    if (!isValidTimestamp(at)) return { ok: false, error: "Time is invalid." };
    const entry = {
      id: generateId("act"),
      type: archived ? "archived" : "restored",
      at: at,
      note: archived ? "Archived. Hidden from the queue and outstanding totals." : "Restored from the archive.",
    };
    const next = appendActivity(invoice, entry);
    next.archived = !!archived;
    return { ok: true, invoice: next };
  }

  function saveInvoiceEdits(existing, form, meta) {
    const at = meta && meta.at;
    const id = existing ? existing.id : meta && meta.id;
    if (!at || !isValidTimestamp(at)) return fail({ form: "Save time is invalid." });
    if (!id) return fail({ id: "Invoice id is missing." });
    if (form && form.status === "disputed" && (!existing || existing.status !== "disputed")) {
      const dispute = readNote(form.disputeNote == null ? "" : form.disputeNote, 2000, "Dispute note");
      if (dispute.error) return fail({ disputeNote: dispute.error });
      if (!dispute.text) return fail({ disputeNote: "Add a short note about the dispute." });
    }

    const sanitized = sanitizeInvoice({
      id: id,
      reference: form.reference,
      client: form.client,
      currency: form.currency,
      amount: form.amount,
      paidAmount: form.paidAmount,
      dueDate: form.dueDate,
      promiseDate: form.promiseDate,
      nextFollowUp: form.nextFollowUp,
      status: form.status,
      archived: existing ? existing.archived === true : false,
      contactName: form.contactName,
      contactRole: form.contactRole,
      contactEmail: form.contactEmail,
      acceptanceNote: form.acceptanceNote,
      lastMessageSummary: form.lastMessageSummary,
      checklist: form.checklist,
      activity: existing ? existing.activity : [],
      createdAt: existing ? existing.createdAt : at,
      updatedAt: at,
    });
    if (!sanitized.ok) return sanitized;

    const next = sanitized.invoice;
    let type = "edited";
    let note = "Invoice details updated.";
    let amount;
    if (!existing) {
      type = "created";
      note = "Invoice added.";
    } else if (next.status === "disputed" && existing.status !== "disputed") {
      type = "dispute";
      note = String(form.disputeNote || "").trim();
    } else if (next.status === "paid" && existing.status !== "paid") {
      type = "payment";
      note = "Marked paid from the invoice form.";
      amount = next.paidAmount;
    } else if (moneyCents(next.paidAmount) !== moneyCents(existing.paidAmount)) {
      type = next.status === "paid" ? "payment" : "partial_payment";
      note = "Paid amount updated from the invoice form.";
      amount = next.paidAmount;
    } else if (next.status === "open" && existing.status !== "open") {
      type = "reopened";
      note = "Reopened for follow-up.";
    }
    const entry = { id: generateId("act"), type: type, at: at, note: note };
    if (amount != null) entry.amount = amount;
    next.activity = (existing ? existing.activity : []).concat([entry]);
    next.createdAt = existing ? existing.createdAt : at;
    next.updatedAt = at;
    next.archived = existing ? existing.archived === true : false;
    return { ok: true, invoice: next };
  }

  function emptyState() {
    return {
      version: 1,
      senderName: "",
      templates: defaultTemplates(),
      invoices: [],
    };
  }

  function parseBackup(text) {
    let data;
    try {
      data = JSON.parse(text);
    } catch (err) {
      return { ok: false, error: "That file is not valid JSON. Nothing was changed." };
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return { ok: false, error: "The backup must be a JSON object. Nothing was changed." };
    }
    if (data.app !== BACKUP_APP) {
      return { ok: false, error: "This file is not a DueTrail backup. Nothing was changed." };
    }
    if (data.version !== BACKUP_VERSION) {
      return { ok: false, error: "This backup version is not supported. Nothing was changed." };
    }
    if (!Array.isArray(data.invoices)) {
      return { ok: false, error: "The backup is missing an invoice list. Nothing was changed." };
    }
    if (data.invoices.length > 1000) {
      return { ok: false, error: "The backup has too many invoices. Nothing was changed." };
    }
    const templates = sanitizeTemplates(data.templates);
    if (!templates.ok) return { ok: false, error: templates.error + " Nothing was changed." };

    let senderName = "";
    if (data.senderName != null) {
      if (typeof data.senderName !== "string") {
        return { ok: false, error: "Sender name must be text. Nothing was changed." };
      }
      senderName = data.senderName.trim();
      if (senderName.length > 80) return { ok: false, error: "Sender name is too long. Nothing was changed." };
      if (/[\u0000-\u001F\u007F]/.test(senderName)) {
        return { ok: false, error: "Sender name contains unsupported characters. Nothing was changed." };
      }
    }

    const invoices = [];
    const ids = new Set();
    for (let i = 0; i < data.invoices.length; i += 1) {
      const result = sanitizeInvoice(data.invoices[i]);
      if (!result.ok) {
        return {
          ok: false,
          error: "Invoice " + (i + 1) + " could not be read (" + result.summary + ") Nothing was changed.",
        };
      }
      if (ids.has(result.invoice.id)) {
        return { ok: false, error: "The backup contains duplicate invoice ids. Nothing was changed." };
      }
      ids.add(result.invoice.id);
      invoices.push(result.invoice);
    }
    return {
      ok: true,
      state: {
        version: 1,
        senderName: senderName,
        templates: templates.templates,
        invoices: invoices,
      },
    };
  }

  function serializeBackup(state, now) {
    const exportedAt = now instanceof Date ? now.toISOString() : new Date().toISOString();
    return JSON.stringify(
      {
        app: BACKUP_APP,
        version: BACKUP_VERSION,
        exportedAt: exportedAt,
        senderName: state.senderName || "",
        templates: state.templates,
        invoices: state.invoices,
      },
      null,
      2
    );
  }

  function restoreBackup(currentState, jsonText) {
    const parsed = parseBackup(jsonText);
    if (!parsed.ok) return { ok: false, error: parsed.error, state: currentState };
    return { ok: true, error: "", state: parsed.state };
  }

  function createMemoryStorage() {
    const map = new Map();
    return {
      getItem: function (key) {
        return map.has(key) ? map.get(key) : null;
      },
      setItem: function (key, value) {
        map.set(key, String(value));
      },
      removeItem: function (key) {
        map.delete(key);
      },
    };
  }

  function saveState(storage, state) {
    storage.setItem(STORAGE_KEY, serializeBackup(state));
  }

  function loadState(storage) {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw == null || raw === "") return { ok: true, missing: true, state: null };
    const parsed = parseBackup(raw);
    if (!parsed.ok) return { ok: false, error: parsed.error, missing: false, state: null };
    return { ok: true, missing: false, state: parsed.state };
  }

  function invoiceShell(partial) {
    return {
      id: partial.id,
      reference: partial.reference,
      client: partial.client,
      currency: partial.currency,
      amount: partial.amount,
      paidAmount: partial.paidAmount || 0,
      dueDate: partial.dueDate,
      promiseDate: partial.promiseDate || "",
      nextFollowUp: partial.nextFollowUp || "",
      status: partial.status,
      archived: false,
      contactName: partial.contactName || "",
      contactRole: partial.contactRole || "Accounts payable",
      contactEmail: partial.contactEmail || "",
      acceptanceNote: partial.acceptanceNote || "",
      lastMessageSummary: partial.lastMessageSummary || "",
      checklist: partial.checklist || [],
      activity: partial.activity || [],
      createdAt: partial.createdAt,
      updatedAt: partial.updatedAt,
    };
  }

  function buildSampleState(today) {
    if (!isValidISODate(today)) throw new Error("buildSampleState needs YYYY-MM-DD");
    function day(offset) {
      return addDaysISO(today, offset);
    }
    function at(offset) {
      return day(offset) + "T09:00:00.000Z";
    }

    const invoices = [
      invoiceShell({
        id: "sample-lumen",
        reference: "INV-1038",
        client: "Lumen Press",
        currency: "USD",
        amount: 640,
        paidAmount: 0,
        dueDate: day(-40),
        promiseDate: day(-20),
        status: "open",
        contactName: "Elena Voss",
        contactRole: "Accounts payable",
        contactEmail: "elena.voss@lumenpress.example",
        acceptanceNote: "Final article package delivered. Elena accepted it by email the same week.",
        lastMessageSummary: "Elena said finance would release the transfer on the promised date.",
        checklist: [
          { id: "sample-lumen-c1", label: "Legal name on the invoice matches the contract", done: false },
          { id: "sample-lumen-c2", label: "Final files delivered", done: true },
        ],
        createdAt: at(-48),
        updatedAt: at(-20),
        activity: [
          { id: "sample-lumen-a1", type: "created", at: at(-48), note: "Sample invoice added for the demo." },
          { id: "sample-lumen-a2", type: "follow_up", at: at(-22), note: "Asked Elena who in finance signs off the vendor name." },
          {
            id: "sample-lumen-a3",
            type: "promise",
            at: at(-20),
            note: "Elena promised payment once the legal name is corrected.",
            promiseDate: day(-20),
          },
        ],
      }),
      invoiceShell({
        id: "sample-northwind",
        reference: "INV-1042",
        client: "Northwind Studio",
        currency: "USD",
        amount: 2400,
        paidAmount: 0,
        dueDate: day(-25),
        promiseDate: day(-9),
        status: "open",
        contactName: "Priya Shah",
        contactRole: "Accounts payable",
        contactEmail: "priya.shah@northwind.example",
        acceptanceNote: "October design retainer delivered. Their portal shows awaiting AP review.",
        lastMessageSummary: "Priya said payment would leave after the portal check.",
        checklist: [
          { id: "sample-northwind-c1", label: "Purchase order number on the invoice", done: true },
          { id: "sample-northwind-c2", label: "Monthly timesheet approved", done: true },
          { id: "sample-northwind-c3", label: "Submitted in the vendor portal", done: false },
        ],
        createdAt: at(-32),
        updatedAt: at(-9),
        activity: [
          { id: "sample-northwind-a1", type: "created", at: at(-32), note: "Sample invoice added for the demo." },
          { id: "sample-northwind-a2", type: "follow_up", at: at(-12), note: "Asked Priya for a payment date." },
          {
            id: "sample-northwind-a3",
            type: "promise",
            at: at(-9),
            note: "Priya promised payment after the portal submission is visible.",
            promiseDate: day(-9),
          },
        ],
      }),
      invoiceShell({
        id: "sample-harbor",
        reference: "INV-1033",
        client: "Harbor & Co",
        currency: "EUR",
        amount: 1800,
        paidAmount: 600,
        dueDate: day(-37),
        promiseDate: day(4),
        nextFollowUp: day(4),
        status: "open",
        contactName: "Jonas Keller",
        contactRole: "Accounts payable",
        contactEmail: "jonas.keller@harborandco.example",
        acceptanceNote: "Brand guidelines delivered. They asked for a VAT line, which is already on the invoice.",
        lastMessageSummary: "Jonas said the balance would follow the partial payment.",
        checklist: [
          { id: "sample-harbor-c1", label: "Delivery acceptance email", done: true },
          { id: "sample-harbor-c2", label: "Second approver in finance", done: false },
        ],
        createdAt: at(-50),
        updatedAt: at(-6),
        activity: [
          { id: "sample-harbor-a1", type: "created", at: at(-50), note: "Sample invoice added for the demo." },
          { id: "sample-harbor-a2", type: "partial_payment", at: at(-14), note: "Partial payment recorded.", amount: 600 },
          {
            id: "sample-harbor-a3",
            type: "promise",
            at: at(-6),
            note: "Jonas promised the balance four days from the demo date.",
            promiseDate: day(4),
          },
        ],
      }),
      invoiceShell({
        id: "sample-brightline",
        reference: "INV-1055",
        client: "Brightline Agency",
        currency: "USD",
        amount: 750,
        paidAmount: 0,
        dueDate: day(-4),
        status: "open",
        contactName: "Morgan Ellis",
        contactRole: "Producer",
        contactEmail: "morgan.ellis@brightline.example",
        acceptanceNote: "Workshop slides delivered. No purchase-order rule was mentioned.",
        lastMessageSummary: "",
        checklist: [],
        createdAt: at(-12),
        updatedAt: at(-4),
        activity: [
          { id: "sample-brightline-a1", type: "created", at: at(-12), note: "Sample invoice added for the demo." },
        ],
      }),
      invoiceShell({
        id: "sample-indus",
        reference: "INV-1048",
        client: "Indus Workshop",
        currency: "PKR",
        amount: 185000,
        paidAmount: 0,
        dueDate: day(14),
        nextFollowUp: day(0),
        status: "open",
        contactName: "Hina Dar",
        contactRole: "Studio manager",
        contactEmail: "hina.dar@indusworkshop.example",
        acceptanceNote: "Milestone two accepted in writing. Due date is still ahead; a check-in was scheduled for today.",
        lastMessageSummary: "Hina asked for a reminder before the due date.",
        checklist: [
          { id: "sample-indus-c1", label: "Milestone acceptance note", done: true },
          { id: "sample-indus-c2", label: "Invoice sent to the studio address", done: true },
        ],
        createdAt: at(-7),
        updatedAt: at(-1),
        activity: [
          { id: "sample-indus-a1", type: "created", at: at(-7), note: "Sample invoice added for the demo." },
          { id: "sample-indus-a2", type: "follow_up", at: at(-1), note: "Scheduled today's check-in. Not overdue yet." },
        ],
      }),
      invoiceShell({
        id: "sample-kite",
        reference: "INV-1021",
        client: "Kite & Kiln",
        currency: "GBP",
        amount: 960,
        paidAmount: 0,
        dueDate: day(-70),
        status: "disputed",
        contactName: "Owen Blake",
        contactRole: "Founder",
        contactEmail: "owen.blake@kiteandkiln.example",
        acceptanceNote: "Homepage revisions were delivered. Owen says two of the rounds were out of scope.",
        lastMessageSummary: "Paused follow-ups while the scope question is open.",
        checklist: [
          { id: "sample-kite-c1", label: "Scope of homepage revisions agreed", done: false },
        ],
        createdAt: at(-80),
        updatedAt: at(-15),
        activity: [
          { id: "sample-kite-a1", type: "created", at: at(-80), note: "Sample invoice added for the demo." },
          {
            id: "sample-kite-a2",
            type: "dispute",
            at: at(-15),
            note: "Owen disputed two revision rounds. Follow-ups stay paused until this is resolved or reopened.",
          },
        ],
      }),
      invoiceShell({
        id: "sample-maple",
        reference: "INV-1010",
        client: "Maple & Pine",
        currency: "USD",
        amount: 3200,
        paidAmount: 3200,
        dueDate: day(-55),
        status: "paid",
        contactName: "Ruth Adelman",
        contactRole: "Accounts payable",
        contactEmail: "ruth.adelman@mapleandpine.example",
        acceptanceNote: "Brand system delivered and accepted.",
        lastMessageSummary: "Ruth confirmed the transfer landed.",
        checklist: [
          { id: "sample-maple-c1", label: "Final files delivered", done: true },
        ],
        createdAt: at(-70),
        updatedAt: at(-12),
        activity: [
          { id: "sample-maple-a1", type: "created", at: at(-70), note: "Sample invoice added for the demo." },
          { id: "sample-maple-a2", type: "payment", at: at(-12), note: "Paid in full.", amount: 3200 },
        ],
      }),
    ];

    const state = {
      version: 1,
      senderName: "Amina Qureshi",
      templates: defaultTemplates(),
      invoices: [],
    };
    for (let i = 0; i < invoices.length; i += 1) {
      const sanitized = sanitizeInvoice(invoices[i]);
      if (!sanitized.ok) throw new Error("Sample invoice failed: " + sanitized.summary);
      state.invoices.push(sanitized.invoice);
    }
    return state;
  }

  function initialState(storage, today) {
    const loaded = loadState(storage);
    if (loaded.missing) {
      const seeded = buildSampleState(today);
      saveState(storage, seeded);
      return { ok: true, state: seeded, seeded: true, blocked: false, error: "" };
    }
    if (!loaded.ok) {
      return {
        ok: false,
        state: buildSampleState(today),
        seeded: false,
        blocked: true,
        error: loaded.error,
      };
    }
    return { ok: true, state: loaded.state, seeded: false, blocked: false, error: "" };
  }

  function invoiceMatches(invoice, query) {
    const needle = String(query || "").trim().toLowerCase();
    if (!needle) return true;
    const parts = [
      invoice.reference,
      invoice.client,
      invoice.currency,
      invoice.status,
      invoice.contactName,
      invoice.contactEmail,
      invoice.contactRole,
      invoice.acceptanceNote,
      invoice.lastMessageSummary,
    ];
    for (let i = 0; i < invoice.checklist.length; i += 1) parts.push(invoice.checklist[i].label);
    return parts.join("\n").toLowerCase().indexOf(needle) !== -1;
  }

  function filterInvoices(invoices, options) {
    const query = options && options.query ? options.query : "";
    const status = options && options.status ? options.status : "all";
    const matched = [];
    for (let i = 0; i < invoices.length; i += 1) {
      const invoice = invoices[i];
      if (status === "archived") {
        if (invoice.archived && invoiceMatches(invoice, query)) matched.push(invoice);
        continue;
      }
      if (invoice.archived) continue;
      if (status !== "all" && invoice.status !== status) continue;
      if (!invoiceMatches(invoice, query)) continue;
      matched.push(invoice);
    }
    matched.sort(function (a, b) {
      if (a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
      return a.reference < b.reference ? -1 : a.reference > b.reference ? 1 : 0;
    });
    return matched;
  }

  function isSampleId(id) {
    return String(id || "").indexOf("sample-") === 0;
  }

  return {
    STORAGE_KEY: STORAGE_KEY,
    CURRENCIES: CURRENCIES,
    ACTIVITY_LABELS: ACTIVITY_LABELS,
    defaultTemplates: defaultTemplates,
    isValidISODate: isValidISODate,
    isValidTimestamp: isValidTimestamp,
    todayISO: todayISO,
    addDaysISO: addDaysISO,
    daysBetween: daysBetween,
    formatLongDate: formatLongDate,
    formatWhen: formatWhen,
    parseMoney: parseMoney,
    centsToAmount: centsToAmount,
    formatAmount: formatAmount,
    moneyCents: moneyCents,
    formatMoney: formatMoney,
    outstandingCents: outstandingCents,
    outstandingOf: outstandingOf,
    outstandingByCurrency: outstandingByCurrency,
    summarizeMoney: summarizeMoney,
    sortCurrencies: sortCurrencies,
    canFollowUp: canFollowUp,
    blockerLabels: blockerLabels,
    actionQueue: actionQueue,
    reasonLabel: reasonLabel,
    queueSummary: queueSummary,
    sanitizeInvoice: sanitizeInvoice,
    sanitizeTemplates: sanitizeTemplates,
    saveInvoiceEdits: saveInvoiceEdits,
    applyPayment: applyPayment,
    logFollowUp: logFollowUp,
    addNote: addNote,
    setArchived: setArchived,
    buildReminder: buildReminder,
    fillTemplate: fillTemplate,
    escapeHtml: escapeHtml,
    csvCell: csvCell,
    invoicesToCsv: invoicesToCsv,
    emptyState: emptyState,
    serializeBackup: serializeBackup,
    parseBackup: parseBackup,
    restoreBackup: restoreBackup,
    createMemoryStorage: createMemoryStorage,
    saveState: saveState,
    loadState: loadState,
    initialState: initialState,
    buildSampleState: buildSampleState,
    filterInvoices: filterInvoices,
    isSampleId: isSampleId,
    generateId: generateId,
    clone: clone,
  };
});
