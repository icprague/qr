# International Church of Prague – Sunday Service Hub

A single-page landing page and automated workflow system that replaces the physical bulletin and automates weekly announcements.

## What's in this repo

| File/Folder | Purpose |
|---|---|
| `index.html` | Landing page with 4 buttons (Order of Worship, Give Online, Newsletter, Connect Card) |
| `config.json` | Static button URLs (Order of Worship, Give Online, Connect Card) |
| `newsletter-link.json` | Auto-updated each Tuesday with the latest Mailchimp newsletter URL |
| `robots.txt` | Blocks all search engine indexing |
| `scripts/update-newsletter-link.js` | Fetches latest newsletter URL via Mailchimp API |
| `scripts/send-announcements.js` | Fetches newsletter via Mailchimp API, creates Google Doc, looks up moderator, emails link |
| `scripts/test-announcements.js` | Dry-run version — creates Google Doc and shows Planning Center lookup, no email sent |
| `scripts/google-docs.js` | Shared module for creating/updating a single reusable Google Doc |
| `.github/workflows/update-newsletter-link.yml` | Updates newsletter link (schedule disabled — manual only until enabled) |
| `.github/workflows/send-announcements.yml` | Generates announcements and emails (schedule disabled — manual only until enabled) |
| `.github/workflows/test-announcements.yml` | Manual-only dry run for testing |

---

## Setup Guide

### 1. Enable GitHub Pages

1. Go to your repo on GitHub → **Settings** → **Pages**
2. Under **Source**, select **Deploy from a branch**
3. Choose the branch `main` (or whichever branch you deploy from) and folder `/ (root)`
4. Click **Save**
5. Your site will be live at `https://<username>.github.io/<repo-name>/`

### 2. Set up a custom domain (Squarespace DNS)

To use a custom domain like `sunday.yourchurch.com`:

1. In GitHub → **Settings** → **Pages** → **Custom domain**, enter your domain (e.g. `sunday.yourchurch.com`) and save
2. In your Squarespace DNS settings, add a **CNAME record**:
   - **Host**: `sunday` (or whatever subdomain you want)
   - **Type**: CNAME
   - **Value**: `<username>.github.io`
3. Wait for DNS to propagate (can be up to 48 hours, usually much faster)
4. Back in GitHub Pages settings, check **Enforce HTTPS**

> If using an apex domain (e.g. `yourchurch.com`), you'll need A records instead. See [GitHub's docs on apex domains](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site#configuring-an-apex-domain).

### 3. Configure button URLs

Edit **`config.json`** in the repo root and replace the placeholder URLs:

```json
{
  "orderOfWorshipUrl": "https://services.planningcenteronline.com/...",
  "giveOnlineUrl": "https://your-giving-page.com/...",
  "connectCardUrl": "https://your-connect-card.com/..."
}
```

These are loaded by the landing page at runtime, so changes take effect as soon as you commit.

### 4. Add GitHub Secrets

Go to your repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret** and add each of these:

| Secret name | What to put | Where to get it |
|---|---|---|
| `MAILCHIMP_API_KEY` | Your Mailchimp API key (e.g. `abc123-us7`) | Mailchimp → Account → Extras → [API keys](https://us1.admin.mailchimp.com/account/api/) → Create A Key |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | WIF provider resource name | See "Set up Google Cloud (Workload Identity Federation)" below |
| `GCP_SERVICE_ACCOUNT` | Service account email | Same section below |
| `PLANNING_CENTER_APP_ID` | Planning Center API application ID | [Planning Center Developer](https://api.planningcenteronline.com/oauth/applications) → create a Personal Access Token → copy the App ID |
| `PLANNING_CENTER_SECRET` | Planning Center API secret token | Same as above → copy the Secret |
| `GMAIL_USER` | Church Gmail address (e.g. `church@gmail.com`) | Your church's Gmail account |
| `GMAIL_APP_PASSWORD` | Gmail app password (NOT your regular password) | Google Account → Security → 2-Step Verification → App passwords → generate one for "Mail" |
| `CC_EMAIL` | Your email address (for CC on announcements) | Your personal/church email |
| `GOOGLE_DOC_ID` | Google Doc ID for announcements | See "Set up Google Doc" below |

> **Gmail app password**: You must have 2-Step Verification enabled on the Gmail account. Then go to [App Passwords](https://myaccount.google.com/apppasswords), select "Mail" and "Other", and generate a 16-character password.

#### Set up Google Cloud (Workload Identity Federation)

The announcements workflow needs access to edit a Google Doc. This uses **Workload Identity Federation** (WIF) — no long-lived JSON keys needed.

You should already have a Google Cloud project with:
- **Google Docs API** enabled
- A **service account** (e.g. `announcements@YOUR_PROJECT_ID.iam.gserviceaccount.com`)
- A **Workload Identity Pool + Provider** linked to your GitHub repo
- `GCP_WORKLOAD_IDENTITY_PROVIDER` and `GCP_SERVICE_ACCOUNT` secrets set in GitHub

If you haven't set these up yet, see the [Google guide for WIF with GitHub Actions](https://github.com/google-github-actions/auth#workload-identity-federation-through-a-service-account).

#### Set up Google Doc (for QR codes)

The announcements are written to a **single Google Doc** that gets overwritten each week, so the URL never changes. This is perfect for a permanent QR code. Multiple people can also have edit access.

1. Go to [docs.google.com](https://docs.google.com) and create a new blank document
2. Name it whatever you like (e.g. "Sunday Announcements")
3. Click **Share** and add your **service account email** (e.g. `announcements@project-e65cf4b1-d33a-42d1-9ce.iam.gserviceaccount.com`) as **Editor**
4. Also add anyone else who needs edit access
5. Set "General access" to **Anyone with the link** → **Viewer** (so the congregation can read it)
6. Copy the **doc ID** from the URL — it's the long string between `/d/` and `/edit`:
   ```
   https://docs.google.com/document/d/THIS_IS_THE_DOC_ID/edit
   ```
7. Add it as the `GOOGLE_DOC_ID` secret in your repo

> The permanent URL for your QR code: `https://docs.google.com/document/d/YOUR_DOC_ID/edit?usp=sharing`

### 5. Verify the workflows

Both workflows can be triggered manually for testing:

1. Go to your repo → **Actions** tab
2. Click on **Update Newsletter Link** or **Send Sunday Announcements**
3. Click **Run workflow** → **Run workflow**
4. Check the run logs for any errors

---

## How the automations work

### Newsletter Link Update (Tuesdays at 9 AM Prague time)

1. The workflow runs and executes `scripts/update-newsletter-link.js`
2. The script calls the Mailchimp API to get the most recent sent campaign
3. It reads the campaign's `archive_url` (the direct link to the newsletter)
4. It writes the URL to `newsletter-link.json`
5. If the URL changed, it commits and pushes the update
6. The landing page reads `newsletter-link.json` and updates the "This Week's Newsletter" button

### Announcements Email (Fridays at 4 PM Prague time)

1. The workflow runs and executes `scripts/send-announcements.js`
2. The script calls the Mailchimp API to get the latest campaign's HTML content
3. It parses the HTML to extract headings, paragraphs, and bullet points
4. It clears and rewrites the Google Doc with the new announcements (same URL every week — ideal for a permanent QR code)
5. It calls the Planning Center API to find who is assigned as moderator for the upcoming Sunday
6. It sends an email with the Google Doc link to the moderator (CC to your email)

---

## Folder structure

```
qr/
├── .github/
│   └── workflows/
│       ├── update-newsletter-link.yml
│       ├── send-announcements.yml
│       └── test-announcements.yml
├── scripts/
│   ├── update-newsletter-link.js
│   ├── send-announcements.js
│   ├── test-announcements.js
│   └── google-docs.js
├── .gitignore
├── config.json
├── index.html
├── newsletter-link.json
├── package.json
├── robots.txt
└── README.md
```

---

## Maintenance

- **Change button URLs**: Edit `config.json` and commit
- **Enable schedules**: The cron schedules are commented out by default. To enable automatic runs, edit the workflow YAML files and uncomment the `schedule` section. The times are in **UTC** — use [crontab.guru](https://crontab.guru/) to adjust.
- **Moderator detection**: The announcements script looks for Planning Center team positions containing: "moderator", "mc", "host", "emcee", or "worship leader". If your church uses different position names, edit the `moderatorKeywords` array in `scripts/send-announcements.js`.
- **Newsletter parsing**: If Mailchimp changes their email template structure, you may need to update the CSS selectors in `scripts/send-announcements.js` (the `contentSelectors` and heading-walking logic).
- **Mailchimp API key**: If your key is revoked or rotated, update the `MAILCHIMP_API_KEY` secret. The data center (e.g. `us7`) is extracted automatically from the key.

---

## Troubleshooting

| Problem | Solution |
|---|---|
| Newsletter button shows nothing | Check that `newsletter-link.json` has a valid URL. Run the Update Newsletter workflow manually. |
| Workflow fails with "secret not set" | Make sure all GitHub Secrets listed above are added correctly. |
| Gmail send fails | Verify the app password is correct and 2FA is enabled. Check that "Less secure app access" is not needed (app passwords bypass this). |
| Planning Center lookup fails | Verify your API credentials. Make sure there's an upcoming plan with team members assigned. |
| Wrong moderator email | Check the position names in Planning Center match the keywords in the script. |
| Pages site shows 404 | Make sure GitHub Pages is enabled and pointing to the correct branch and folder. |
