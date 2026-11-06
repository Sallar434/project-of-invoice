# DueTrail build brief

Status: specification only; no executable app has been created by the research executor.

Pitch: Know who owes you, what is blocking payment, and what to say next without changing your invoicing tool.

Build a responsive local-only vanilla HTML/CSS/JavaScript app here. Use fictitious sample data and a prominent browser-storage privacy warning. No backend, payments, automatic sends, real client imports, external APIs or analytics.

Core: add/edit invoices (reference/client/currency/amount/due date/paid amount); open/paid/disputed states; per-currency outstanding totals; overdue/missed-promise action queue; buyer contact and submission checklist; promise date; manual activity history; editable friendly/direct/final reminder templates with copy button; search/filter; CSV export; JSON backup/restore.

Quality: input validation, partial-payment correctness, suppress paid/disputed follow-ups, safe text rendering, CSV formula-injection protection, robust malformed-backup handling, keyboard accessibility, mobile layout, persistence on reload. Do not imply localStorage is secure storage or audit-grade evidence.

Deliver README and tests for mixed currencies, partial payments, invalid dates, promise sorting, paid/disputed suppression, reload and backup round trip. Suggested local serving command after implementation: python3 -m http.server 8080 --bind 127.0.0.1

Marketing/pricing are proposals, not live offers: free demo, Solo US$9/month, Team US$19/month after secure accounts and sync are built. Pakistan-localized pricing and lawful payment provider remain to validate. No claims of guaranteed payment recovery.

Full sourced research and marketing kit: https://cursor.com/canvas/store-0f6af555-c051-4209-b8b4-60d3fbc92d3b/af97b7df-1cf4-4108-80f2-e09b4c9ea202
