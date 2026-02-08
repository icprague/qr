# International Church of Prague – Sunday Service Hub

A single-page landing page and automated workflow system that replaces the physical bulletin and automates weekly announcements.

## What's in this repo

| File/Folder | Purpose |
|---|---|
| `index.html` | Landing page with 4 buttons (Order of Worship, Give Online, Newsletter, Connect Card) |
| `config.json` | Static button URLs (Order of Worship, Give Online, Connect Card) |
| `newsletter-link.json` | Auto-updated each Tuesday with the latest Mailchimp newsletter URL |
| `robots.txt` | Blocks all search engine indexing |
| `scripts/update-newsletter-link.js` | Fetches latest newsletter URL from Mailchimp archive |
| `scripts/send-announcements.js` | Parses newsletter, looks up moderator in Planning Center, emails announcements |
| `.github/workflows/update-newsletter-link.yml` | Tuesday 9 AM (Prague) – updates newsletter link |
| `.github/workflows/send-announcements.yml` | Friday 4 PM (Prague) – generates and sends announcements email |

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
| `MAILCHIMP_ARCHIVE_URL` | Your Mailchimp campaign archive page URL | Mailchimp → Campaigns → View Archive → copy the URL |
| `PLANNING_CENTER_APP_ID` | Planning Center API application ID | [Planning Center Developer](https://api.planningcenteronline.com/oauth/applications) → create a Personal Access Token → copy the App ID |
| `PLANNING_CENTER_SECRET` | Planning Center API secret token | Same as above → copy the Secret |
| `GMAIL_USER` | Church Gmail address (e.g. `church@gmail.com`) | Your church's Gmail account |
| `GMAIL_APP_PASSWORD` | Gmail app password (NOT your regular password) | Google Account → Security → 2-Step Verification → App passwords → generate one for "Mail" |
| `CC_EMAIL` | Your email address (for CC on announcements) | Your personal/church email |

> **Gmail app password**: You must have 2-Step Verification enabled on the Gmail account. Then go to [App Passwords](https://myaccount.google.com/apppasswords), select "Mail" and "Other", and generate a 16-character password.

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
2. The script fetches your Mailchimp campaign archive page
3. It finds the most recent newsletter link on the page
4. It writes the URL to `newsletter-link.json`
5. If the URL changed, it commits and pushes the update
6. The landing page reads `newsletter-link.json` and updates the "This Week's Newsletter" button

### Announcements Email (Fridays at 4 PM Prague time)

1. The workflow runs and executes `scripts/send-announcements.js`
2. The script fetches the latest newsletter from Mailchimp
3. It parses the HTML to extract headings, paragraphs, and bullet points
4. It calls the Planning Center API to find who is assigned as moderator for the upcoming Sunday
5. It generates a styled HTML announcements document
6. It sends the document via Gmail to the moderator (CC to your email)

---

## Folder structure

```
qr/
├── .github/
│   └── workflows/
│       ├── update-newsletter-link.yml
│       └── send-announcements.yml
├── scripts/
│   ├── update-newsletter-link.js
│   └── send-announcements.js
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
- **Change schedule**: Edit the `cron` lines in the workflow YAML files. Use [crontab.guru](https://crontab.guru/) to build cron expressions. Remember the cron times are in **UTC**.
- **Moderator detection**: The announcements script looks for Planning Center team positions containing: "moderator", "mc", "host", "emcee", or "worship leader". If your church uses different position names, edit the `moderatorKeywords` array in `scripts/send-announcements.js`.
- **Newsletter parsing**: If Mailchimp changes their HTML structure, you may need to update the CSS selectors in `scripts/send-announcements.js` (the `contentSelectors` and heading-walking logic).

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
