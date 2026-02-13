/**
 * config.js
 *
 * Central configuration for the announcements pipeline.
 * Edit this file to change permanent announcements, prayer heading patterns,
 * spreadsheet settings, and the 4-week rotation logic.
 */

// ---------------------------------------------------------------------------
// Missionary Prayers – heading patterns
// ---------------------------------------------------------------------------

/**
 * Headings that start with any of these patterns (case-insensitive) will be
 * treated as the missionary prayers section. The match is a "starts with" check.
 *
 * Examples that match:
 *   "Prayers for our Ministry Partners"
 *   "Prayers for Missionaries – Wycliffe Bible Translators"
 */
const MISSIONARY_PRAYER_HEADING_PATTERNS = [
  'Prayers for our Ministry Partners',
  'Prayers for Missionaries',
];

// ---------------------------------------------------------------------------
// Permanent Announcements – shown every week
// ---------------------------------------------------------------------------

/**
 * Array of { heading, text } objects. Each becomes a sub-section in the
 * "Permanent Announcements" part of the Google Doc. Edit freely.
 */
const PERMANENT_ANNOUNCEMENTS = [
  {
    heading: 'How to Sign Up for the Newsletter',
    text: '(add text)',
  },
  {
    heading: 'QR Code',
    text: '(add text)',
  },
];

// ---------------------------------------------------------------------------
// Google Spreadsheet – Regular Reminders (4-week rotation)
// ---------------------------------------------------------------------------

/**
 * The ID of the Google Spreadsheet that holds the regular reminders.
 * Overridden by the GOOGLE_SPREADSHEET_ID environment variable if set.
 *
 * The spreadsheet should have a sheet named "Regular Reminders" with columns:
 *   A: Active   (TRUE / FALSE)
 *   B: Week     (1, 2, 3, or 4)
 *   C: Title    (Announcement heading)
 *   D: Text     (Announcement body text)
 */
const DEFAULT_SPREADSHEET_ID = '';

function getSpreadsheetId() {
  return process.env.GOOGLE_SPREADSHEET_ID || DEFAULT_SPREADSHEET_ID;
}

/**
 * The name of the sheet (tab) inside the spreadsheet.
 */
const REMINDERS_SHEET_NAME = 'Regular Reminders';

/**
 * Calculate which week in the 4-week cycle a given date falls in.
 *
 * Uses ISO week number modulo 4, yielding values 1–4.
 * Adjust this function if you need a different rotation anchor.
 *
 * @param {Date} [date] – defaults to now
 * @returns {number} 1, 2, 3, or 4
 */
function getCurrentCycleWeek(date) {
  const d = date || new Date();
  // ISO week number calculation
  const target = new Date(d.valueOf());
  target.setHours(0, 0, 0, 0);
  // Set to nearest Thursday (current date + 4 - current day number, with Sunday = 7)
  const dayNum = target.getDay() || 7;
  target.setDate(target.getDate() + 4 - dayNum);
  const yearStart = new Date(target.getFullYear(), 0, 1);
  const weekNum = Math.ceil(((target - yearStart) / 86400000 + 1) / 7);
  return ((weekNum - 1) % 4) + 1; // 1-based: 1, 2, 3, 4
}

module.exports = {
  MISSIONARY_PRAYER_HEADING_PATTERNS,
  PERMANENT_ANNOUNCEMENTS,
  REMINDERS_SHEET_NAME,
  getSpreadsheetId,
  getCurrentCycleWeek,
};
