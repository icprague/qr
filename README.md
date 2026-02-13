# International Church of Prague – Sunday Service Hub

A landing page and automation system for ICP's Sunday services. Replaces the printed bulletin with a QR-code-friendly page, and automates the weekly preparation of announcements.

## What it does

**Landing page** (`index.html`) — A mobile-first page with four buttons:

- **Order of Worship** — links to the current Sunday's service plan on Planning Center
- **Giving** — links to the church's giving page on icprague.cz
- **This Week's Newsletter** — links to the latest Mailchimp newsletter (updated automatically)
- **Connect Card** — links to the visitor connect form on Planning Center

**Automated workflows** (GitHub Actions):

- **Update Newsletter Link** (Friday 3:30 PM) — fetches the latest sent campaign from Mailchimp and saves its archive URL so the landing page always points to the current newsletter. If no newsletter was sent that day, sends a reminder email to `FAIL_EMAIL`.
- **Send Announcements to Editors** (Friday 3:30 PM) — fetches the newsletter HTML, parses it into structured sections, writes them to a Google Doc, and emails the editors group with the link for review. If no newsletter was sent that day, sends a reminder email to `FAIL_EMAIL`.
- **Send Announcements to Moderator** (Saturday 8:00 AM) — looks up the upcoming Sunday's moderator in Planning Center and emails them the Google Doc link.

## Google Doc structure

The announcements doc is completely overwritten each run with this structure:

1. **Title**: "Sunday Announcements" with auto-generated date
2. **Missionary Prayers** — extracted from the newsletter (sections starting with "Prayers for our Ministry Partners" or "Prayers for Missionaries"). Displayed with a lavender background (`#e2e3f3`), italic dark blue text (`#181c3a`), and an "INCLUDE IN PRAYERS THIS WEEK" heading (`#222a58`). If no prayer section is found, displays "No prayers for our ministry partners this week".
3. **Permanent Announcements** — hardcoded in `scripts/config.js`. These appear every week (e.g. newsletter signup info, QR code info).
4. **Weekly Announcements** — pulled from the newsletter, excluding the missionary prayers section already shown above.
5. **Regular Reminders** — pulled from a Google Spreadsheet on a 4-week rotation cycle. If no matching reminders are found, displays "No regular reminders this week".

## Analytics

The landing page includes Google Analytics 4 tracking. It records page views and tracks which buttons visitors click (`order_of_worship`, `giving`, `newsletter`, `connect_card`).

To distinguish where scans come from, use UTM parameters on your QR codes:

| QR code location | URL |
|---|---|
| Pew cards | `https://sunday.icprague.cz/?utm_source=pew&utm_medium=qr` |
| Take-home cards | `https://sunday.icprague.cz/?utm_source=takeaway&utm_medium=qr` |

GA4 picks up UTM parameters automatically — no extra code needed.

**Setup**: The GA4 Measurement ID (`G-YL2P0BP685`) is already configured in `index.html`.

---

## Setup

### 1. Enable GitHub Pages

1. Go to **Settings** → **Pages**
2. Set source to **Deploy from a branch**, select `main`, folder `/ (root)`
3. The site will be live at `https://<username>.github.io/<repo>/`

### 2. Custom domain

To serve the page at `sunday.icprague.cz`:

1. In GitHub → **Settings** → **Pages** → **Custom domain**, enter `sunday.icprague.cz`
2. In your DNS settings, add a **CNAME record**: `sunday` → `<username>.github.io`
3. Wait for DNS propagation, then enable **Enforce HTTPS** in GitHub Pages settings

### 3. Button URLs

Edit `config.json` to set the three static button URLs:

```json
{
  "orderOfWorshipUrl": "https://icp.churchcenter.com/services/...",
  "giveOnlineUrl": "https://www.icprague.cz/supporting-icp",
  "connectCardUrl": "https://icp.churchcenter.com/people/forms/..."
}
```

The newsletter URL is managed automatically by the Update Newsletter Link workflow.

### 4. GitHub Secrets

Go to **Settings** → **Secrets and variables** → **Actions** and add:

| Secret | What it is |
|---|---|
| `MAILCHIMP_API_KEY` | Mailchimp API key (e.g. `abc123-us7`). The data center suffix is extracted automatically. |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | Workload Identity Federation provider resource name (see Google Cloud setup below) |
| `GCP_SERVICE_ACCOUNT` | GCP service account email (e.g. `announcements@your-project.iam.gserviceaccount.com`) |
| `PLANNING_CENTER_APP_ID` | Personal Access Token app ID from [Planning Center Developer](https://api.planningcenteronline.com/oauth/applications) |
| `PLANNING_CENTER_SECRET` | Personal Access Token secret from the same page |
| `GMAIL_USER` | Gmail address used to send all automated emails (announcements, reminders, failure notifications) |
| `GMAIL_APP_PASSWORD` | Gmail app password (requires 2FA enabled — generate at [App Passwords](https://myaccount.google.com/apppasswords)) |
| `CC_EMAIL` | Email address to CC on the moderator announcements email |
| `FAIL_EMAIL` | Email address for failure/reminder notifications when no same-day newsletter is found |
| `EDITOR_EMAILS` | Comma-separated list of editor email addresses who review announcements before they go to the moderator |
| `GOOGLE_DOC_ID` | ID of the Google Doc used for announcements (see below) |
| `GOOGLE_SPREADSHEET_ID` | (Optional) ID of the Google Spreadsheet for regular reminders (see below) |

### 5. Google Cloud (Workload Identity Federation)

The announcements workflow authenticates to Google Docs and Google Sheets via Workload Identity Federation — no long-lived JSON key files.

You need:
- A GCP project with the **Google Docs API** and **Google Sheets API** enabled
- A **service account** with Docs edit permissions and Sheets read permissions
- A **Workload Identity Pool and Provider** linked to your GitHub repo

#### Enabling the Google Sheets API

1. Go to the [Google Cloud Console](https://console.cloud.google.com/)
2. Select your project
3. Navigate to **APIs & Services** → **Library**
4. Search for "Google Sheets API"
5. Click **Enable**

The access token scopes in the workflows already include `https://www.googleapis.com/auth/spreadsheets.readonly`.

See the [google-github-actions/auth docs](https://github.com/google-github-actions/auth#workload-identity-federation-through-a-service-account) for Workload Identity Federation setup instructions.

### 6. Google Doc

The announcements are written to a single Google Doc that gets overwritten each week. The URL never changes, so it works as a permanent QR code target.

1. Create a new blank Google Doc
2. Share it with your service account email as **Editor**
3. Set general access to **Anyone with the link → Commenter**
4. Grant edit access to specific people who need to edit the announcements
5. Copy the doc ID from the URL (the string between `/d/` and `/edit`)
6. Add it as the `GOOGLE_DOC_ID` secret

### 7. Google Spreadsheet (Regular Reminders)

Regular reminders rotate on a 4-week cycle, pulled from a Google Spreadsheet.

#### Creating the spreadsheet

1. Create a new Google Spreadsheet
2. Name the first sheet tab **"Regular Reminders"**
3. Set up columns as follows:

| Column A | Column B | Column C | Column D |
|---|---|---|---|
| **Active** | **Week** | **Title** | **Text** |
| TRUE | 1 | Women's Bible Study | Join us every Tuesday at 10 AM in the fellowship hall for our women's Bible study. All women are welcome! |
| TRUE | 1 | Youth Group | Youth group meets every Friday at 6 PM. See Pastor Mark for details. |
| TRUE | 2 | Men's Breakfast | Men's breakfast is on the first Saturday of the month at 8 AM at Café Louvre. |
| TRUE | 2 | Prayer Meeting | Wednesday evening prayer meeting at 7 PM in the church library. |
| TRUE | 3 | Church Cleanup Day | Help us spruce up the church grounds! Meet at 9 AM on Saturday. |
| FALSE | 3 | Old Event | This won't appear because Active is FALSE. |
| TRUE | 4 | Community Dinner | Monthly community dinner at 6 PM in the fellowship hall. Everyone welcome! |
| TRUE | 4 | Volunteer Sign-up | Sign up to volunteer for Sunday services at the welcome desk. |

- **Active**: `TRUE` or `FALSE` — controls whether the reminder appears
- **Week**: `1`, `2`, `3`, or `4` — which week of the 4-week cycle this appears in
- **Title**: The heading for the reminder
- **Text**: The body text for the reminder

#### Sharing with the service account

1. Open the spreadsheet
2. Click **Share**
3. Add your service account email (e.g. `announcements@your-project.iam.gserviceaccount.com`) as a **Viewer**
4. Copy the spreadsheet ID from the URL (the string between `/d/` and `/edit`)
5. Add it as the `GOOGLE_SPREADSHEET_ID` secret in GitHub

#### How the 4-week cycle works

The script calculates the current ISO week number and maps it to a 4-week cycle (week 1, 2, 3, or 4). Each run, it reads all rows where `Active = TRUE` and `Week` matches the current cycle week.

To adjust the cycle calculation, edit the `getCurrentCycleWeek()` function in `scripts/config.js`.

### 8. Email sending

All automated emails are sent from the `GMAIL_USER` address via Gmail SMTP. This is a regular Gmail account (not the GCP service account). The GCP service account is only used for Google Docs and Google Sheets API access.

Emails appear as:
- **Editors/moderator emails**: `"ICP Sunday Announcements" <your-gmail@gmail.com>`
- **Failure notifications**: `"ICP Automation" <your-gmail@gmail.com>`

### 9. Test the workflows

All workflows can be triggered manually from **Actions** → select the workflow → **Run workflow**.

| Test workflow | What it tests |
|---|---|
| **Test: Send Editors Email** | Sends the editors email with the current Google Doc link. Does NOT re-process the newsletter or update the doc. |
| **Test: Send Moderator Email** | Sends the moderator email with the current Google Doc link (looks up moderator from Planning Center). Does NOT re-process the newsletter or update the doc. |
| **Test: Full Announcements Pipeline** | Runs the full Friday pipeline (Mailchimp → parse → Google Doc → editors email) with the same-day check disabled so it works on any day. **This will overwrite the Google Doc.** |

---

## How the automations work

### Newsletter link update

Runs on Fridays at 3:30 PM Prague time (schedule disabled by default — trigger manually or uncomment the cron in the workflow file).

1. Calls the Mailchimp API to get the most recently sent campaign
2. **Checks if the campaign was sent today** (Prague timezone). If not, sends a reminder email to `FAIL_EMAIL` and exits.
3. Extracts the campaign's `archive_url` (the public link to the newsletter)
4. Writes it to `newsletter-link.json` and commits if changed
5. The landing page reads this file at load time and updates the newsletter button

### Announcements — Step 1: Editors review (Friday 3:30 PM)

1. Calls the Mailchimp API to get the latest campaign's full HTML
2. **Checks if the campaign was sent today** (Prague timezone). If not, sends a reminder email to `FAIL_EMAIL` and exits.
3. Parses the HTML to extract headings (h1–h3), paragraphs, and bullet points, stopping at the "Offering Report" section and filtering out footer content
4. **Separates missionary prayer sections** — any section whose heading starts with "Prayers for our Ministry Partners" or "Prayers for Missionaries" is extracted into the dedicated prayer section
5. **Fetches regular reminders** from the Google Spreadsheet based on the current 4-week cycle
6. Clears the Google Doc and rewrites it with the structured format:
   - Title and date
   - Missionary prayers (with special formatting)
   - Permanent announcements (from `scripts/config.js`)
   - Weekly announcements (newsletter content minus prayers)
   - Regular reminders (from spreadsheet)
7. Sends an email to all addresses in `EDITOR_EMAILS` with the Google Doc link for review

### Announcements — Step 2: Moderator notification (Saturday 8:00 AM)

1. Calls the Planning Center API to find the upcoming Sunday's service plan
2. Looks through the plan's team members for someone in a moderator-type position
3. Sends an email to that person with the Google Doc link (CC to `CC_EMAIL`)

If no moderator is found in Planning Center, the email is sent to `CC_EMAIL` as a fallback.

---

## Customization

### Permanent announcements

Edit the `PERMANENT_ANNOUNCEMENTS` array in `scripts/config.js`:

```javascript
const PERMANENT_ANNOUNCEMENTS = [
  {
    heading: 'Stay Connected',
    text: 'Sign up for our weekly newsletter...',
  },
  {
    heading: 'QR Code',
    text: 'Scan the QR code on the pew cards...',
  },
];
```

### Missionary prayer heading patterns

Edit the `MISSIONARY_PRAYER_HEADING_PATTERNS` array in `scripts/config.js`:

```javascript
const MISSIONARY_PRAYER_HEADING_PATTERNS = [
  'Prayers for our Ministry Partners',
  'Prayers for Missionaries',
];
```

The match is case-insensitive and checks if the newsletter heading **starts with** any of these patterns.

### 4-week cycle calculation

Edit the `getCurrentCycleWeek()` function in `scripts/config.js` to change how weeks are mapped to cycle numbers.

### Spreadsheet ID

Set the `GOOGLE_SPREADSHEET_ID` GitHub secret, or edit the `DEFAULT_SPREADSHEET_ID` in `scripts/config.js`.

---

## Files

```
├── index.html                         Landing page
├── config.json                        Static button URLs
├── newsletter-link.json               Latest newsletter URL (auto-updated)
├── robots.txt                         Blocks search engine indexing
├── package.json                       Node.js dependencies
├── scripts/
│   ├── config.js                      Configuration: permanent announcements, prayer patterns, spreadsheet settings
│   ├── update-newsletter-link.js      Fetches latest newsletter URL from Mailchimp (with same-day check)
│   ├── send-announcements.js          Friday pipeline: Mailchimp → parse → Google Doc → editors email
│   ├── send-editors-email.js          Send editors email only (no doc reprocessing)
│   ├── send-moderator-email.js        Saturday pipeline: Planning Center → moderator email
│   ├── parse-newsletter.js            HTML parser for Mailchimp newsletter content
│   ├── google-docs.js                 Google Docs API helper (clear and rewrite doc with structured sections)
│   ├── google-sheets.js               Google Sheets API helper (read regular reminders)
│   └── planning-center.js             Planning Center API helper (moderator lookup)
└── .github/workflows/
    ├── update-newsletter-link.yml     Friday newsletter link update (disabled)
    ├── send-announcements.yml         Friday editors announcements email (disabled)
    ├── send-moderator-email.yml       Saturday moderator email (disabled)
    ├── test-editors-email.yml         Manual test: editors email only
    ├── test-moderator-email.yml       Manual test: moderator email only
    └── test-full-pipeline.yml         Manual test: full pipeline (skips date check)
```

## Maintenance

- **Change button URLs**: Edit `config.json` and commit. Changes take effect immediately.
- **Edit permanent announcements**: Edit the `PERMANENT_ANNOUNCEMENTS` array in `scripts/config.js`.
- **Change prayer heading patterns**: Edit `MISSIONARY_PRAYER_HEADING_PATTERNS` in `scripts/config.js`.
- **Change regular reminders**: Edit rows in the Google Spreadsheet (set Active to FALSE to disable, or change the Week number).
- **Adjust 4-week cycle**: Edit `getCurrentCycleWeek()` in `scripts/config.js`.
- **Enable scheduled runs**: Uncomment the `schedule` section in the workflow YAML files. Times are in UTC — see the comments in each file for Prague time equivalents.
- **Moderator lookup**: The script searches Planning Center team positions for keywords like "moderator" or "host". If your position names differ, edit the `moderatorKeywords` array in `scripts/send-moderator-email.js`.
- **Editor list**: Update the `EDITOR_EMAILS` secret to add or remove editors. Use a comma-separated list (e.g. `alice@example.com,bob@example.com`).
- **Newsletter parsing**: If the Mailchimp template structure changes significantly, the content extraction in `scripts/parse-newsletter.js` may need adjustment.
- **Rotate API keys**: Update the corresponding GitHub secret. No code changes needed.
