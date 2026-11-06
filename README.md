# DueTrail

DueTrail is a follow-up workspace for freelancers, made by Sallar Hussain Bali. It shows who owes you, what is blocking payment, and a reminder you can edit and copy. It does not replace QuickBooks, Wave, or any other invoicing tool.

The public page explains the problem, who it is for, and the planned prices. The demo behind it is local-only, with fictitious sample data. Records stay in the browser or, in the native shells, on the device. That storage is not encrypted, not a backup, and not audit-grade evidence. Nothing here promises that a client will pay.

Hosted payments and accounts are not live. There is no checkout and no card form. The free demo is what you can use today. Solo at US$9/month and Team at US$19/month are planned prices for a later version with accounts and sync. They are not an offer you can buy, and they are not App Store or Google Play prices yet.

The same site is an installable web app and the content inside Capacitor shells for iOS and Android. Those shells are project scaffolding. They have not been submitted to either store.

## Run the web app

From the repository root:

```bash
npm start
```

Or without npm:

```bash
python3 -m http.server 8080 --bind 127.0.0.1
```

- Landing page: [http://127.0.0.1:8080](http://127.0.0.1:8080)
- Demo workspace: [http://127.0.0.1:8080/demo.html](http://127.0.0.1:8080/demo.html)

Any free port works the same way. Serve this repository as the site root so the manifest, service worker, and demo stay on one origin.

## Install it as a PWA

1. Open the landing page in Chrome, Edge, or Safari over `http://127.0.0.1` (or https in a real host). Installation needs a proper origin. Opening the HTML file directly will not register the service worker.
2. On a phone, use the browser menu: **Install app** or **Add to Home Screen**.
3. On desktop Chrome, use the install icon in the address bar once the manifest is recognized.

The installed app opens the overview, then the demo. Invoice data stays in that app’s on-device storage. The service worker loads fresh files when you are online and falls back to a cached copy only when the network fails. It does not upload invoices. Copying a reminder still only uses the clipboard.

To pick up a new version during development, reload once while online. If a shell ever looks stale, unregister the DueTrail service worker in the browser’s application settings and reload.

## iOS and Android shells

Capacitor wraps these same web files at the repository root. Config: `capacitor.config.json`. App id placeholder: `com.sallarhussainbali.duetrail`.

```bash
npm install
npx cap sync
```

`cap sync` copies the web files into `android/` and `ios/`. Run it again after web changes, before a native build.

### Android

A debug build needs a JDK and the Android SDK (Android Studio is the straightforward install). This repository does not include the SDK, and no APK has been published.

```bash
# After Android Studio has installed the SDK
npx cap open android
```

Or from the project:

```bash
cd android
./gradlew assembleDebug
```

The debug APK is written under `android/app/build/outputs/apk/debug/`. A Play Store build later needs a release keystore, a Play Console app, the Data safety form, screenshots, and a decision about billing. Do not upload an AAB until those exist. Play Billing is not wired up, because hosted payments are not live.

### iOS

An archive and an IPA need Xcode on a Mac. The `ios/` project can be generated and synced on any machine. It cannot be archived here.

```bash
# On a Mac, from the repository root
npx cap sync ios
npx cap open ios
```

In Xcode: select the App target, set a development team, then Product → Archive. Uploading that archive needs an Apple Developer Program membership, an App Store Connect record, a privacy questionnaire, and screenshots. In-App Purchase is not configured, because the paid plans are not for sale.

## Before either store submission

Do these. None of them are done.

1. Join the Apple Developer Program and create the app in App Store Connect.
2. Create the app in Google Play Console and finish the Data safety form.
3. Answer both privacy questionnaires from `STORE_LISTING.md`. This build keeps data on the device, has no account, and does not send messages.
4. Capture the screenshot list in that file from the fictitious sample. Do not invent reviews or recovery claims.
5. Replace the placeholder bundle id if you will not ship as `com.sallarhussainbali.duetrail`.
6. Leave Solo (US$9/month) and Team (US$19/month) out of the live price tier until accounts, sync, and a real payment provider exist. The free demo is the shippable product today.
7. Hosted payments are not live. Do not add a card form to pass review.

## Tests

```bash
npm test
```

That runs the follow-up logic tests and a check that the manifest and service worker stay local. The logic tests cover mixed currencies, partial payments, invalid dates, promise sorting, paid and disputed suppression, reload persistence, backup round trip, malformed backups, and CSV formula injection.

## What the demo can do

- Add and edit invoices: reference, client, currency, total, due date, and amount already paid.
- Mark an invoice open, paid, or disputed. Paid and disputed invoices leave the follow-up queue.
- See outstanding money per currency. Totals are never added across currencies.
- Work a queue of missed promises, overdue invoices, and follow-ups you scheduled.
- Keep the buyer contact, submission checklist, acceptance note, and promise date on the invoice.
- Record partial payments and a manual activity history.
- Edit friendly, direct, and final reminder templates, then copy a draft. You send it yourself.
- Search and filter the list.
- Export CSV (text that could be read as a spreadsheet formula is prefixed) and back up or restore JSON.

Use the sample clients already loaded. Do not paste real client or bank details.
