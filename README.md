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
- **Send Announcements to Editors** (Friday 3:30 PM) — fetches the newsletter HTML, parses it into sections, writes them to a Google Doc, and emails the editors group with the link for review. If no newsletter was sent that day, sends a reminder email to `FAIL_EMAIL`.
- **Send Announcements to Moderator** (Saturday 8:00 AM) — looks up the upcoming Sunday's moderator in Planning Center and emails them the Google Doc link.

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

### 5. Google Cloud (Workload Identity Federation)

The announcements workflow authenticates to Google Docs via Workload Identity Federation — no long-lived JSON key files.

You need:
- A GCP project with the **Google Docs API** enabled
- A **service account** with Docs edit permissions
- A **Workload Identity Pool and Provider** linked to your GitHub repo

See the [google-github-actions/auth docs](https://github.com/google-github-actions/auth#workload-identity-federation-through-a-service-account) for setup instructions.

### 6. Google Doc

The announcements are written to a single Google Doc that gets overwritten each week. The URL never changes, so it works as a permanent QR code target.

1. Create a new blank Google Doc
2. Share it with your service account email as **Editor**
3. Set general access to **Anyone with the link → Commenter**
4. Grant edit access to specific people who need to edit the announcements
5. Copy the doc ID from the URL (the string between `/d/` and `/edit`)
6. Add it as the `GOOGLE_DOC_ID` secret

### 7. Email sending

All automated emails are sent from the `GMAIL_USER` address via Gmail SMTP. This is a regular Gmail account (not the GCP service account). The GCP service account is only used for Google Docs API access.

Emails appear as:
- **Editors/moderator emails**: `"International Church of Prague" <your-gmail@gmail.com>`
- **Failure notifications**: `"ICP Church Automation" <your-gmail@gmail.com>`

### 8. Test the workflows

All workflows can be triggered manually from **Actions** → select the workflow → **Run workflow**.

| Test workflow | What it tests |
|---|---|
| **Test: Send Editors Email** | Runs the full Friday pipeline (Mailchimp → parse → Google Doc → editors email). Skips the same-day newsletter check so it works on any day. |
| **Test: Send Moderator Email** | Runs the Saturday moderator flow (Planning Center lookup → moderator email). |

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
4. Clears the Google Doc and rewrites it with the extracted content
5. Sends an email to all addresses in `EDITOR_EMAILS` with the Google Doc link for review

### Announcements — Step 2: Moderator notification (Saturday 8:00 AM)

1. Calls the Planning Center API to find the upcoming Sunday's service plan
2. Looks through the plan's team members for someone in a moderator-type position
3. Sends an email to that person with the Google Doc link (CC to `CC_EMAIL`)

If no moderator is found in Planning Center, the email is sent to `CC_EMAIL` as a fallback.

---

## Files

```
├── index.html                         Landing page
├── config.json                        Static button URLs
├── newsletter-link.json               Latest newsletter URL (auto-updated)
├── robots.txt                         Blocks search engine indexing
├── package.json                       Node.js dependencies
├── scripts/
│   ├── update-newsletter-link.js      Fetches latest newsletter URL from Mailchimp (with same-day check)
│   ├── send-announcements.js          Friday pipeline: Mailchimp → parse → Google Doc → editors email
│   ├── send-moderator-email.js        Saturday pipeline: Planning Center → moderator email
│   ├── parse-newsletter.js            HTML parser for Mailchimp newsletter content
│   └── google-docs.js                 Google Docs API helper (clear and rewrite doc)
└── .github/workflows/
    ├── update-newsletter-link.yml     Friday newsletter link update (disabled)
    ├── send-announcements.yml         Friday editors announcements email (disabled)
    ├── send-moderator-email.yml       Saturday moderator email (disabled)
    ├── test-editors-email.yml         Manual test: editors email flow
    └── test-moderator-email.yml       Manual test: moderator email flow
```

## Maintenance

- **Change button URLs**: Edit `config.json` and commit. Changes take effect immediately.
- **Enable scheduled runs**: Uncomment the `schedule` section in the workflow YAML files. Times are in UTC — see the comments in each file for Prague time equivalents.
- **Moderator lookup**: The script searches Planning Center team positions for keywords like "moderator" or "host". If your position names differ, edit the `moderatorKeywords` array in `scripts/send-moderator-email.js`.
- **Editor list**: Update the `EDITOR_EMAILS` secret to add or remove editors. Use a comma-separated list (e.g. `alice@example.com,bob@example.com`).
- **Newsletter parsing**: If the Mailchimp template structure changes significantly, the content extraction in `scripts/parse-newsletter.js` may need adjustment.
- **Rotate API keys**: Update the corresponding GitHub secret. No code changes needed.
