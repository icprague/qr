# International Church of Prague – Sunday Service Hub

A landing page and automation system for ICP's Sunday services. Replaces the printed bulletin with a QR-code-friendly page, and automates the weekly preparation of announcements.

## What it does

**Landing page** (`index.html`) — A mobile-first page with four buttons:

- **Order of Worship** — links to the current Sunday's service plan on Planning Center
- **Giving** — links to the church's giving page on icprague.cz
- **This Week's Newsletter** — links to the latest Mailchimp newsletter (updated automatically)
- **Connect Card** — links to the visitor connect form on Planning Center

**Automated workflows** (GitHub Actions):

- **Update Newsletter Link** — fetches the latest sent campaign from Mailchimp and saves its archive URL so the landing page always points to the current newsletter
- **Send Announcements** — fetches the newsletter HTML from Mailchimp, parses it into sections, writes them to a Google Doc, looks up the service moderator in Planning Center, and emails them the link

## Analytics

The landing page includes Google Analytics 4 tracking. It records page views and tracks which buttons visitors click (`order_of_worship`, `giving`, `newsletter`, `connect_card`).

To distinguish where scans come from, use UTM parameters on your QR codes:

| QR code location | URL |
|---|---|
| Pew cards | `https://sunday.icprague.cz/?utm_source=pew&utm_medium=qr` |
| Take-home cards | `https://sunday.icprague.cz/?utm_source=takeaway&utm_medium=qr` |

GA4 picks up UTM parameters automatically — no extra code needed.

**Setup**: Create a GA4 property at [analytics.google.com](https://analytics.google.com), copy the Measurement ID (e.g. `G-XXXXXXXXXX`), and replace the placeholder in `index.html`.

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
| `GMAIL_USER` | Gmail address used to send the announcements email |
| `GMAIL_APP_PASSWORD` | Gmail app password (requires 2FA enabled — generate at [App Passwords](https://myaccount.google.com/apppasswords)) |
| `CC_EMAIL` | Email address to CC on announcements emails |
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
3. Set general access to **Anyone with the link → Viewer**
4. Copy the doc ID from the URL (the string between `/d/` and `/edit`)
5. Add it as the `GOOGLE_DOC_ID` secret

### 7. Test the workflows

All workflows can be triggered manually:

1. Go to **Actions** → select the workflow → **Run workflow**
2. The **Test: Preview Announcements** workflow is a dry run that updates the Google Doc and logs the Planning Center lookup, but does not send email

---

## How the automations work

### Newsletter link update

Runs on Tuesdays (schedule disabled by default — trigger manually or uncomment the cron in the workflow file).

1. Calls the Mailchimp API to get the most recently sent campaign
2. Extracts the campaign's `archive_url` (the public link to the newsletter)
3. Writes it to `newsletter-link.json` and commits if changed
4. The landing page reads this file at load time and updates the newsletter button

### Announcements email

Runs on Fridays (schedule disabled by default).

1. Calls the Mailchimp API to get the latest campaign's full HTML
2. Parses the HTML to extract headings (h1–h3), paragraphs, and bullet points, stopping at the "Offering Report" section and filtering out footer content
3. Clears the Google Doc and rewrites it with the extracted content
4. Calls the Planning Center API to find the upcoming Sunday's service plan
5. Looks through the plan's team members for someone in a moderator-type position
6. Sends an email to that person with the Google Doc link (CC to `CC_EMAIL`)

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
│   ├── update-newsletter-link.js      Fetches latest newsletter URL from Mailchimp
│   ├── send-announcements.js          Full pipeline: Mailchimp → parse → Google Doc → Planning Center → email
│   ├── test-announcements.js          Dry-run version (no email sent)
│   ├── parse-newsletter.js            HTML parser for Mailchimp newsletter content
│   └── google-docs.js                 Google Docs API helper (clear and rewrite doc)
└── .github/workflows/
    ├── update-newsletter-link.yml     Tuesday newsletter link update
    ├── send-announcements.yml         Friday announcements pipeline
    └── test-announcements.yml         Manual dry-run test
```

## Maintenance

- **Change button URLs**: Edit `config.json` and commit. Changes take effect immediately.
- **Enable scheduled runs**: Uncomment the `schedule` section in the workflow YAML files. Times are in UTC — see the comments in each file for Prague time equivalents.
- **Moderator lookup**: The script searches Planning Center team positions for keywords like "moderator" or "host". If your position names differ, edit the `moderatorKeywords` array in `scripts/send-announcements.js`.
- **Newsletter parsing**: If the Mailchimp template structure changes significantly, the content extraction in `scripts/parse-newsletter.js` may need adjustment.
- **Rotate API keys**: Update the corresponding GitHub secret. No code changes needed.
