/**
 * google-sheets.js
 *
 * Reads "Regular Reminders" from a Google Spreadsheet.
 * The spreadsheet is expected to have columns:
 *   A: Active   (TRUE / FALSE)
 *   B: Week     (1, 2, 3, or 4)
 *   C: Title    (Announcement heading)
 *   D: Text     (Announcement body text)
 *
 * Uses the same access token / Workload Identity Federation auth as google-docs.js.
 */

const { google } = require('googleapis');

/**
 * Get auth client using the access token from the workflow.
 */
function getAuth() {
  const token = process.env.GOOGLE_ACCESS_TOKEN;
  if (!token) {
    throw new Error('GOOGLE_ACCESS_TOKEN is not set. The google-github-actions/auth step must provide it.');
  }
  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: token });
  return oauth2Client;
}

/**
 * Fetch regular reminders for a specific week in the 4-week cycle.
 *
 * @param {string} spreadsheetId – Google Spreadsheet ID
 * @param {string} sheetName – Name of the sheet/tab (e.g. "Regular Reminders")
 * @param {number} cycleWeek – Which week to fetch (1–4)
 * @returns {Array<{ heading: string, text: string }>} Matching reminders
 */
async function fetchRegularReminders(spreadsheetId, sheetName, cycleWeek) {
  if (!spreadsheetId) {
    console.log('  No GOOGLE_SPREADSHEET_ID configured — skipping regular reminders.');
    return [];
  }

  const auth = getAuth();
  const sheets = google.sheets({ version: 'v4', auth });

  console.log(`  Reading spreadsheet ${spreadsheetId}, sheet "${sheetName}"...`);

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!A:D`,
  });

  const rows = res.data.values;
  if (!rows || rows.length <= 1) {
    console.log('  Spreadsheet is empty or has only a header row.');
    return [];
  }

  // Skip the header row (row 0)
  const reminders = [];
  for (let i = 1; i < rows.length; i++) {
    const [active, week, title, text] = rows[i];

    const isActive = String(active).toUpperCase() === 'TRUE';
    const weekNum = parseInt(week, 10);

    if (isActive && weekNum === cycleWeek) {
      reminders.push({
        heading: (title || '').trim(),
        text: (text || '').trim(),
      });
    }
  }

  console.log(`  Found ${reminders.length} reminder(s) for cycle week ${cycleWeek}.`);
  return reminders;
}

module.exports = { fetchRegularReminders };
