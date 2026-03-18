# CONTEXT.md — ICP Church Automation

> Last updated: 2026-03-18
> Repo: `icprague/qr` (GitHub)
> Organization: International Church of Prague (ICP)

---

## 1. What This Project Is

This repo powers two things for the International Church of Prague:

1. **A QR code landing page** — scanned by church attendees from printed pew cards and take-home cards. It links to the order of worship, the weekly newsletter, a connect card, and a giving page.
2. **Weekly automation workflows** — GitHub Actions that run on Fridays and Saturdays to process the church newsletter, generate a structured Google Doc of Sunday announcements, email editors and the moderator, and keep the landing page newsletter link up to date.

There is also a **GA4 analytics dashboard** (`dashboard/`) for tracking QR code scan engagement.

The project is hosted on **GitHub Pages** (for the static landing page) and **Vercel** (for the dashboard's serverless config endpoint). There is no backend server — all automation runs via GitHub Actions.

---

## 2. Directory Structure

```
/
├── index.html                    # Original standalone landing page (GitHub Pages)
├── squarespace.html              # Primary landing page — embedded as a Squarespace code block
├── giving.html                   # Standalone giving sub-page (GitHub Pages version)
├── czech-bank.html               # Standalone Czech bank transfer page (GitHub Pages version)
├── config.json                   # Static button URLs (orderOfWorship, giveOnline, connectCard)
├── newsletter-link.json          # Auto-updated by CI: latest Mailchimp newsletter archive URL
├── qr_platba.png                 # Czech bank transfer QR code image
├── robots.txt                    # Blocks search engine indexing
├── vercel.json                   # Vercel config (currently empty — defaults suffice)
├── package.json                  # Node.js project: cheerio, googleapis, nodemailer
│
├── api/
│   └── config.js                 # Vercel serverless function: exposes GA_PROPERTY_ID and OAUTH_CLIENT_ID
│
├── scripts/                      # All automation scripts (Node.js, run by GitHub Actions)
│   ├── config.js                 # Central config: prayer heading patterns, permanent announcements, 4-week cycle
│   ├── update-newsletter-link.js # Fetches latest Mailchimp campaign URL → writes newsletter-link.json
│   ├── send-announcements.js     # Friday pipeline: Mailchimp → parse → Google Doc → editors email
│   ├── send-editors-email.js     # Standalone editors email (without re-parsing)
│   ├── send-moderator-email.js   # Saturday: looks up moderator in Planning Center → emails them
│   ├── update-plan-items.js      # Writes moderator + worship leader names into Planning Center plan items
│   ├── update-sermon-plan-item.js# Extracts sermon title/scripture from newsletter → writes to Planning Center
│   ├── sync-pco-mailchimp.js     # One-way sync: Planning Center people list → Mailchimp audience
│   ├── parse-newsletter.js       # HTML parser: extracts sections from Mailchimp newsletter
│   ├── parse-sermon-info.js      # Extracts sermon title (H2) and scripture (H3) from "This Sunday" section
│   ├── google-docs.js            # Google Docs API: clears and rewrites announcements doc
│   ├── google-sheets.js          # Google Sheets API: reads regular reminders on 4-week rotation
│   ├── planning-center.js        # Planning Center API: moderator lookup + plan item write-back
│   ├── upcoming-preachers.js     # Utility: prints 6-month preacher schedule from Planning Center
│   ├── fetch-plan-items.js       # Utility: logs all items from the most recent plan
│   ├── fetch-last-plan.js        # Utility: logs the most recent plan's items
│   ├── restructure-mar22-plan.js # One-time script: restructured a specific March 22 plan
│   └── test-sermon-info.js       # Manual test for sermon info extraction
│
├── dashboard/                    # GA4 analytics dashboard (client-side SPA)
│   ├── index.html                # Dashboard shell: Chart.js, html2canvas, jsPDF, Google Identity Services
│   ├── css/style.css             # Dashboard styling
│   └── js/
│       ├── config.js             # Loads GA_PROPERTY_ID and OAUTH_CLIENT_ID from /api/config
│       ├── auth.js               # Google OAuth via GIS token model (implicit grant)
│       ├── api.js                # GA4 Data API queries: 9 parallel report fetches per date range
│       ├── charts.js             # Chart.js rendering: users-per-button, traffic sources, comparison
│       ├── dates.js              # Date preset logic: Sundays, midweeks, custom ranges
│       ├── export.js             # PNG/PDF/Google Sheets export
│       └── app.js                # Main controller: wires auth → data fetch → chart render
│
└── .github/workflows/            # GitHub Actions (18 workflow files)
    ├── update-newsletter-link.yml    # ACTIVE: Friday 1:15-4:15 PM Prague (4 hourly retries)
    ├── send-announcements.yml        # DISABLED schedule, manual trigger: Friday editors pipeline
    ├── send-moderator-email.yml      # Saturday 8 AM Prague: moderator email
    ├── update-plan-items.yml         # ACTIVE: Friday 3:15 PM + Tuesday 9 AM — moderator/worship leader names
    ├── update-sermon-plan-item.yml   # Friday: sermon title + scripture → Planning Center
    ├── sync-pco-mailchimp.yml        # Manual: PCO → Mailchimp subscriber sync
    ├── test-editors-email.yml        # Manual test workflow
    ├── test-moderator-email.yml      # Manual test workflow
    ├── test-full-pipeline.yml        # Manual test: full pipeline with SKIP_DATE_CHECK=true
    ├── test-newsletter-link.yml      # Manual test workflow
    ├── test-pco-mailchimp-sync.yml   # Manual test: dry run of PCO→Mailchimp sync
    ├── test-sermon-info.yml          # Manual test: sermon info extraction
    ├── upcoming-preachers.yml        # Manual: print 6-month preacher schedule
    ├── fetch-plan-items.yml          # Manual: dump plan items for debugging
    ├── fetch-last-plan.yml           # Manual: dump last plan
    └── restructure-mar22-plan.yml    # One-time: restructure a specific plan (historical)
```

---

## 3. The Two Landing Pages

### `index.html` (GitHub Pages standalone)
- Simple 4-button page: Newsletter, Order of Worship, Connect With Us, Supporting ICP.
- Fetches `newsletter-link.json` at load time via XHR to get the dynamic newsletter URL.
- No GA4 tracking (the Squarespace version handles analytics).
- The "Supporting ICP" button links to `giving.html`, which in turn links to `czech-bank.html`.

### `squarespace.html` (Primary, production)
- Pasted into a Squarespace Code Block on the church website.
- **Three views** controlled by JavaScript: Main → Giving → Czech Bank Transfer.
- **GA4 tracking** with `G-YL2P0BP685`: tracks `page_view` and `button_click` events.
- **UTM-aware**: `?utm_source=pew|card|giving|slide` and `?utm_content=pew|card`.
  - `utm_source=giving` opens directly to the giving view.
  - `utm_source=card` or `utm_content=card` shows Location + Livestream buttons, hides Supporting ICP and heading.
- **UTM persistence**: stores `utm_source` in `sessionStorage` and sets it globally via `gtag('set', { campaign_source: ... })` so all events carry the source.
- Fetches `newsletter-link.json` from `https://icprague.github.io/qr/` (the GitHub Pages URL).
- Hides Squarespace chrome (header, footer, nav, mobile bars, announcement bars) via aggressive CSS selectors.
- Save QR code uses Web Share API on mobile, falls back to `<a download>` on desktop.

### Key difference
`index.html` is the GitHub Pages fallback. `squarespace.html` is the production page embedded in the church's Squarespace site. Both fetch the newsletter link from the same `newsletter-link.json`.

---

## 4. Automation Pipeline

### Weekly Flow (Friday → Saturday → Sunday)

```
Friday ~1:15 PM Prague
  └─ update-newsletter-link.yml (4 hourly retries until 4:15 PM)
       └─ Fetches latest Mailchimp campaign → writes newsletter-link.json → git commit+push

Friday ~3:15 PM Prague
  └─ update-plan-items.yml
       └─ Writes "Moderator - Name" and "Worship Leader - Name" into Planning Center plan items
  └─ update-sermon-plan-item.yml
       └─ Extracts sermon title + scripture from newsletter → writes to Planning Center
  └─ send-announcements.yml (manual trigger, schedule commented out)
       └─ Mailchimp HTML → parse → separate prayers → fetch spreadsheet reminders
       └─ Clear + rewrite Google Doc with structured sections
       └─ Email editors with doc link + moderator info + reminders info

Saturday 8:00 AM Prague
  └─ send-moderator-email.yml
       └─ Look up moderator from Planning Center → email them Google Doc link

Tuesday 9:00 AM Prague
  └─ update-plan-items.yml (second run — catches any schedule changes)
```

### Same-Day Check
Most scripts that depend on the newsletter verify the latest Mailchimp campaign was sent "today" in `Europe/Prague` timezone. If not:
- Non-final attempts: exit quietly (retry at next cron run).
- Final attempt: send a failure email to `FAIL_EMAIL` and exit with error.
- `SKIP_DATE_CHECK=true` bypasses this (used in test workflows).

### Google Doc Structure
The announcements doc is completely overwritten each week:
1. **Title**: "Sunday Announcements" + date
2. **Missionary Prayers**: lavender background (`#F1F2F9`), italic dark blue text. Sections whose headings match patterns in `scripts/config.js` are extracted here.
3. **Permanent Announcements**: hardcoded in `scripts/config.js` (currently "How to Sign Up for the Newsletter" and "QR Code" — both have placeholder text).
4. **Weekly Announcements**: remaining newsletter content (filtered: stops at "Offering Report", skips "In This Issue", strips footer).
5. **Regular Reminders**: from a Google Spreadsheet, rotated on a 4-week cycle (`getCurrentCycleWeek()` in `scripts/config.js`).

---

## 5. External Services and APIs

| Service | Role | Auth Method |
|---------|------|-------------|
| **Mailchimp** | Source of truth for weekly newsletter content and archive URL | API key (`MAILCHIMP_API_KEY`), data center extracted from key suffix |
| **Planning Center** | Church management: service plans, team members (moderator, preacher, worship leader) | HTTP Basic auth with `PLANNING_CENTER_APP_ID:PLANNING_CENTER_SECRET` |
| **Google Docs API** | Target for structured announcements document | Workload Identity Federation → access token |
| **Google Sheets API** | Source for 4-week rotating regular reminders | Same Workload Identity Federation |
| **Gmail SMTP** | Sends all automated emails (editors, moderator, failure notifications) | `GMAIL_USER` + `GMAIL_APP_PASSWORD` (app password, not OAuth) |
| **Google Analytics 4** | Tracks QR code scans and button clicks | Measurement ID `G-YL2P0BP685` in squarespace.html |
| **GA4 Data API** | Dashboard reads analytics data | OAuth implicit grant via Google Identity Services |
| **Vercel** | Hosts dashboard serverless function (`/api/config`) | Environment variables: `GA_PROPERTY_ID`, `OAUTH_CLIENT_ID` |
| **GitHub Pages** | Hosts static files (index.html, newsletter-link.json, qr_platba.png) | Public |
| **Squarespace** | Church website where squarespace.html is embedded | N/A — code block paste |
| **Stripe** | Online card payment processing | Direct link: `donate.stripe.com/...` |

---

## 6. Tech Stack

| Technology | Purpose |
|-----------|---------|
| **Node.js 20** | Runtime for all automation scripts |
| **cheerio ^1.0.0** | Declared as dependency but not directly imported — newsletter parsing uses raw regex/string splitting instead (ported from Google Apps Script) |
| **googleapis ^144.0.0** | Google Docs and Sheets API client (used in `google-docs.js` and `google-sheets.js`) |
| **nodemailer ^6.9.0** | SMTP email sending via Gmail |
| **Chart.js 4.4.7** | Dashboard charts (CDN) |
| **html2canvas 1.4.1** | Dashboard PNG export (CDN) |
| **jsPDF 2.5.2** | Dashboard PDF export (CDN) |
| **Google Identity Services** | Dashboard OAuth (GIS script loaded from `accounts.google.com`) |
| **GitHub Actions** | CI/CD — all automation runs here |
| **Vercel** | Serverless function hosting for dashboard config endpoint |

### Notable: cheerio is unused
`cheerio` is listed in `package.json` but no script imports it. The newsletter HTML parsing (`parse-newsletter.js`) uses manual regex-based extraction, which was ported from an earlier Google Apps Script implementation. This is intentional — the parsing strategy splits on `</tr>` boundaries and uses regex for heading/content extraction.

---

## 7. Key Modules in Detail

### `scripts/config.js` — Central Configuration
- `MISSIONARY_PRAYER_HEADING_PATTERNS`: array of heading prefixes that trigger prayer section extraction.
- `PERMANENT_ANNOUNCEMENTS`: array of `{ heading, text }` shown every week. **Currently has placeholder text** — both entries say "(add text)".
- `getCurrentCycleWeek(date)`: ISO week number mod 4, yielding 1–4. Used to select which reminders appear from the spreadsheet.
- `getSpreadsheetId()`: reads from `GOOGLE_SPREADSHEET_ID` env var, falls back to empty `DEFAULT_SPREADSHEET_ID`.

### `scripts/planning-center.js` — Dual Purpose
Two exported functions:
1. `getModeratorInfo()` — finds the moderator for the upcoming Sunday. Searches team positions for keywords: `moderator`, `mc`, `host`, `emcee`, `worship leader`. Returns `{ found, name, email }`.
2. `updateModeratorInPlanItems()` — writes moderator and worship leader names directly into Planning Center plan items. Handles both old format (`"Announcements + Welcome Guests (Moderator)"`) and new format (`"Moderator"` → `"Moderator - Name"`). Special case: Mike Weiglein gets "Pastor" prefix.

### `scripts/parse-newsletter.js` — Newsletter Parser
- Splits HTML by `</tr>` boundaries (Mailchimp table structure).
- Only `<h1>`, `<h2>`, `<h3>` tags are treated as headings.
- Stops at "Offering Report" heading.
- Skips "In This Issue" sections.
- Filters footer content (unsubscribe, preferences, etc.).
- `separatePrayerSections()` partitions sections into prayer vs weekly based on heading pattern matching.

### `scripts/parse-sermon-info.js` — Sermon Extractor
- Finds the "This Sunday" section in the newsletter.
- `H2` → sermon title, `H3` → scripture reference.
- Used by `update-sermon-plan-item.js` to write sermon info into Planning Center.

### `dashboard/js/api.js` — GA4 Query Layer
- Makes **9 parallel GA4 Data API calls** per date range:
  1. Detail: button_name × sessionSource (for charts)
  2. Totals: no dimensions (deduplicated user count)
  3. Per-button totals (deduplicated per button)
  4. Per-source totals (deduplicated per source)
  5. Per-button × newVsReturning
  6. NVR totals (no button dimension)
  7. Visitor totals (all users, not just clickers)
  8. Visitor NVR (returning visitors)
  9. Sessions by source (session count, not users)
- The many parallel queries exist because GA4 deduplicates users differently depending on which dimensions are present. Summing user counts across dimensions over-counts.

---

## 8. Development History

The repo has **202 commits** (as of 2026-03-18). The git history only contains PRs from #38 onward (shallow clone). All PRs originate from branches matching `icprague/claude/*`, indicating heavy use of Claude Code for development.

### Phase 1: Core Landing Page + Announcements Pipeline (PRs #38–#43)
- Landing page with 4 buttons (order of worship, newsletter, connect card, giving).
- Mailchimp → parse → Google Doc → email pipeline.
- Planning Center integration for moderator lookup.
- UTM parameter tracking for QR code source attribution.
- Separation of sermon and moderator workflows into independent pipelines.

### Phase 2: Planning Center Plan Item Write-Back (PRs #46–#52, #63–#69)
- Upcoming preachers utility script.
- Sermon title + scripture extraction from newsletter → written to Planning Center.
- Plan restructuring scripts (one-time, for March 2025 plan migration).
- Moderator + worship leader name auto-populated in service plan items.

### Phase 3: Squarespace Redesign + Accessibility (PRs #53–#62)
- Squarespace code block version of the landing page.
- Accessibility improvements: contrast fixes, rem fonts, 18px minimum.
- Multi-view architecture (Main → Giving → Czech Bank) in single page.
- QR code save-to-photos via Web Share API.
- Stripe payment integration (replacing older giving link).
- Aggressive Squarespace chrome hiding.

### Phase 4: Analytics Dashboard (PRs #85–#117, most recent)
- Full GA4 analytics dashboard (`dashboard/`).
- Vercel serverless config endpoint.
- Google OAuth via GIS for dashboard authentication.
- Iterative fixes to GA4 queries: user deduplication, NVR breakdown, sessions-by-source.
- Chart features: users per button, traffic sources, new vs returning toggle, sessions by source toggle.
- Export: PNG, PDF, Google Sheets.
- Date presets: today, yesterday, last Sunday, previous Sunday, last 4 Sundays, midweek variants, last 7/28 days, this month, custom.
- Button label renaming (Stripe → Card Payment, Giving CZK → Czech Bank Transfer).
- Midweek date presets.
- Summary cards: visited vs clicked split, percentage change vs average.

### Phase 5: Card View + Social Icons (PRs #113–#117, most recent)
- Card view shows Location + Livestream buttons, hides Supporting ICP.
- Social icons (Facebook, Instagram, YouTube).
- YouTube social icon hidden in card view (since livestream button is already shown).
- Update-plan-items workflow scheduled for Tuesday 9 AM in addition to Friday.

---

## 9. Last Month's Changes (since 2026-02-18)

The last month has been focused on two areas:

**Analytics dashboard refinement** (~25 commits):
- Multiple iterations on GA4 session source dimension (`sessionManualSource` → `sessionSource`).
- Added sessions-by-source toggle to traffic sources chart.
- Added visited vs clicked split to summary cards.
- Fixed user deduplication across multiple NVR queries.
- Added percentage change vs average for Sunday/midweek presets.

**Card view and social features** (~5 commits):
- Reorganized card-view buttons, added livestream + social icons.
- YouTube icon, spacing adjustments.
- Compact card view spacing tightened.

**Workflow scheduling** (~3 commits):
- Added Tuesday 9 AM schedule to update-plan-items workflow.
- Attempted and reverted adding Tuesday schedule to moderator email workflow.

---

## 10. Design Patterns

### IIFE Module Pattern (Dashboard)
All dashboard JS files use the revealing module pattern via IIFEs:
```javascript
var ModuleName = (function () {
  // private state
  function publicMethod() { ... }
  return { publicMethod: publicMethod };
})();
```
Modules: `AppConfig`, `Auth`, `GA`, `Charts`, `Dates`, `Export`.

### CommonJS (Scripts)
All automation scripts use `require()`/`module.exports`. No ES modules, no bundler.

### No HTTP Client Library
All scripts use Node.js built-in `https`/`http` modules directly (no axios, node-fetch, etc.). Each script has its own HTTP helper functions, leading to some duplication of `httpGet`, `httpPatch`, `mailchimpGet`, etc. across files.

### Duplicate Helper Functions
Several utility functions are duplicated across scripts:
- `getUpcomingSunday()` appears in `send-announcements.js`, `send-moderator-email.js`, `planning-center.js`, `update-sermon-plan-item.js`
- `isSentToday()` appears in `update-newsletter-link.js`, `send-announcements.js`, `update-sermon-plan-item.js`
- `httpPatch()` appears in both `planning-center.js` and `update-sermon-plan-item.js`
- `isLastAttempt()` appears in `update-newsletter-link.js` and `update-sermon-plan-item.js`

This is a conscious trade-off: each script is self-contained and can be understood in isolation.

### Planning Center API Pattern
All Planning Center interactions follow the same pattern:
1. Fetch service types → use first one
2. Fetch future plans → match to upcoming Sunday by date
3. Fetch team members (per_page=100) → search by position keywords
4. Fetch plan items → match by title pattern → PATCH to update

---

## 11. Current State Assessment

### Complete and Stable
- Landing page (both `index.html` and `squarespace.html`)
- Newsletter link auto-update pipeline (4 hourly retries)
- Moderator + worship leader plan item updates
- Sermon title + scripture plan item updates
- Moderator email (Saturday)
- PCO → Mailchimp sync
- Newsletter HTML parsing
- Czech bank transfer view with QR code

### In Progress / Partially Complete
- **Announcements pipeline**: the `send-announcements.yml` schedule is **commented out** — it only runs via manual trigger. This is the most complex workflow and may still be in testing.
- **Permanent announcements**: the two entries in `scripts/config.js` have placeholder text "(add text)" — they haven't been filled in with real content.
- **Dashboard**: functionally complete but has console.log debug statements left in `api.js` (line 253-258: `[NVR per-button]` logging).
- **`cheerio` dependency**: declared in `package.json` but never imported. Could be removed.

### Known Rough Edges
- No TODOs or FIXMEs in the codebase (checked).
- `vercel.json` is empty `{}` — works because Vercel defaults detect the `/api` directory automatically.
- `DEFAULT_SPREADSHEET_ID` in `scripts/config.js` is empty string — requires `GOOGLE_SPREADSHEET_ID` env var.
- The `restructure-mar22-plan.js` script and workflow are one-time artifacts that could be removed.

---

## 12. Non-Obvious Context / Gotchas

### UTM Parameter Behavior
The `squarespace.html` page has complex conditional behavior based on UTM params:
- `utm_source=giving` → skips main view, opens giving view directly, hides back button.
- `utm_source=card` or `utm_content=card` → shows Location + Livestream buttons, hides Supporting ICP + heading + YouTube icon.
- UTM source is persisted in `sessionStorage` and set globally via `gtag('set')`.

### GA4 Deduplication Problem
The dashboard makes 9 parallel GA4 queries because adding dimensions to a GA4 query changes how users are deduplicated. A single query with `button_name × source` dimensions will overcount total users (the same user clicking two buttons counts twice). The solution: separate queries for totals, per-button, per-source, and NVR breakdowns.

### Newsletter Parser Depends on Mailchimp Template Structure
`parse-newsletter.js` splits on `</tr>` boundaries — it's tightly coupled to Mailchimp's HTML table layout. If the template changes significantly, parsing may break. Section boundaries are detected by headings: stops at "Offering Report", skips "In This Issue".

### Squarespace Chrome Hiding
`squarespace.html` contains ~40 CSS selectors to hide Squarespace headers, footers, nav bars, mobile bars, announcement bars, newsletter widgets, and floating action buttons. This is fragile — Squarespace template updates could break it.

### Two Hosting Environments
- **GitHub Pages** (`icprague.github.io/qr/`): hosts `index.html`, `newsletter-link.json`, `qr_platba.png`, and other static files.
- **Vercel**: hosts the dashboard and its `/api/config` serverless function.
- **Squarespace**: the actual production page is `squarespace.html` pasted as a code block, which fetches dynamic data from GitHub Pages.

### "Pastor" Prefix Logic
In `planning-center.js` and `update-sermon-plan-item.js`, Mike Weiglein's name gets a "Pastor" prefix when writing to plan items. This is a hard-coded special case.

### Cron Timezone Assumptions
All cron schedules assume CET (UTC+1, winter). During CEST (summer, UTC+2), times shift 1 hour later in local Prague time. The newsletter link update has 4 hourly retries to handle this and variable newsletter send times.

### Gmail vs GCP Service Account
Gmail SMTP (used for sending emails) is a separate credential from the GCP service account (used for Google Docs/Sheets API). The `GMAIL_USER`/`GMAIL_APP_PASSWORD` are regular Gmail credentials with app password. The GCP service account authenticates via Workload Identity Federation (no JSON key files).

---

## 13. Files That Are Especially Central

Before making changes, always understand these files first:

1. **`squarespace.html`** — the production landing page. Contains HTML, CSS, and all JavaScript in a single file. Changes here affect what church attendees see.
2. **`scripts/config.js`** — central configuration for the announcements pipeline. Prayer patterns, permanent announcements, spreadsheet settings, and cycle calculation all live here.
3. **`scripts/planning-center.js`** — shared module used by multiple scripts. Both `getModeratorInfo()` and `updateModeratorInPlanItems()` are imported elsewhere.
4. **`scripts/parse-newsletter.js`** — the newsletter HTML parser. Fragile: depends on Mailchimp template structure.
5. **`dashboard/js/api.js`** — GA4 query logic. Complex: 9 parallel queries with specific deduplication strategies.
6. **`.github/workflows/update-newsletter-link.yml`** — the only workflow with an active schedule that commits and pushes (auto-updates `newsletter-link.json`).

---

## 14. Environment Setup

### Running scripts locally
```bash
npm ci                          # Install dependencies
MAILCHIMP_API_KEY=... node scripts/update-newsletter-link.js
PLANNING_CENTER_APP_ID=... PLANNING_CENTER_SECRET=... node scripts/fetch-plan-items.js
```

### Required GitHub Secrets
`MAILCHIMP_API_KEY`, `GCP_WORKLOAD_IDENTITY_PROVIDER`, `GCP_SERVICE_ACCOUNT`, `PLANNING_CENTER_APP_ID`, `PLANNING_CENTER_SECRET`, `GMAIL_USER`, `GMAIL_APP_PASSWORD`, `CC_EMAIL`, `FAIL_EMAIL`, `EDITOR_EMAILS`, `GOOGLE_DOC_ID`, `GOOGLE_SPREADSHEET_ID`

### Vercel Environment Variables
`GA_PROPERTY_ID`, `OAUTH_CLIENT_ID` — used by the dashboard's `/api/config` endpoint.

### No build step
There is no build process. All code is vanilla JavaScript. Scripts are run directly with `node`. The dashboard loads JS files directly from `<script>` tags with CDN dependencies.
