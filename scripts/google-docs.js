/**
 * google-docs.js
 *
 * Helper module for updating a Google Doc with the structured announcements.
 * Requires a pre-created Google Doc shared with the service account as Editor.
 * The doc content is cleared and rewritten each run, keeping the same URL.
 *
 * Document structure (complete overwrite each run):
 *   1. Title: "Sunday Announcements" + auto-generated date
 *   2. Missionary Prayers section (special background/text formatting)
 *   3. Permanent Announcements (hardcoded in config.js)
 *   4. Weekly Announcements (from newsletter, minus prayers)
 *   5. Regular Reminders (from Google Spreadsheet, 4-week rotation)
 *
 * Uses an access token from the google-github-actions/auth workflow step
 * (GOOGLE_ACCESS_TOKEN env var), obtained via Workload Identity Federation.
 */

const { google } = require('googleapis');

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

function getAuth() {
  const token = process.env.GOOGLE_ACCESS_TOKEN;
  if (!token) {
    throw new Error('GOOGLE_ACCESS_TOKEN is not set. The google-github-actions/auth step must provide it.');
  }
  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: token });
  return oauth2Client;
}

// ---------------------------------------------------------------------------
// Color helpers
// ---------------------------------------------------------------------------

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return {
    red: parseInt(h.substring(0, 2), 16) / 255,
    green: parseInt(h.substring(2, 4), 16) / 255,
    blue: parseInt(h.substring(4, 6), 16) / 255,
  };
}

// ---------------------------------------------------------------------------
// Request builder
// ---------------------------------------------------------------------------

/**
 * Build a Google Docs batchUpdate requests array for the full document.
 *
 * @param {object} opts
 * @param {string}  opts.title             – e.g. "Sunday Announcements"
 * @param {string}  opts.subtitle          – e.g. "Sunday, February 16, 2025"
 * @param {Array}   opts.prayerSections    – Extracted missionary prayer sections
 * @param {Array}   opts.permanentAnnouncements – [{ heading, text }]
 * @param {Array}   opts.weeklySections    – Newsletter sections minus prayers
 * @param {Array}   opts.regularReminders  – [{ heading, text }] from spreadsheet
 * @returns {Array} requests for docs.documents.batchUpdate
 */
function buildDocRequests(opts) {
  const {
    title,
    subtitle,
    prayerSections,
    permanentAnnouncements,
    weeklySections,
    regularReminders,
  } = opts;

  const requests = [];
  let idx = 1;

  // --- Insertion helpers ---------------------------------------------------

  function insertText(text, style = {}) {
    const {
      bold = false,
      italic = false,
      fontSize = 11,
      color = '#181C3A',
      alignment = 'START',
      fontFamily = 'Lato',
    } = style;

    const endIdx = idx + text.length;
    requests.push({ insertText: { location: { index: idx }, text } });
    requests.push({
      updateTextStyle: {
        range: { startIndex: idx, endIndex: endIdx },
        textStyle: {
          bold,
          italic,
          fontSize: { magnitude: fontSize, unit: 'PT' },
          foregroundColor: { color: { rgbColor: hexToRgb(color) } },
          weightedFontFamily: { fontFamily },
        },
        fields: 'bold,italic,fontSize,foregroundColor,weightedFontFamily',
      },
    });
    if (alignment !== 'START') {
      requests.push({
        updateParagraphStyle: {
          range: { startIndex: idx, endIndex: endIdx },
          paragraphStyle: { alignment },
          fields: 'alignment',
        },
      });
    }
    idx = endIdx;
  }

  function insertNewline() {
    requests.push({ insertText: { location: { index: idx }, text: '\n' } });
    idx += 1;
  }

  /**
   * Apply a background color to a range of paragraphs.
   * Must be called AFTER the text is inserted.
   */
  function applyParagraphBackground(startIdx, endIdx, bgColor) {
    requests.push({
      updateParagraphStyle: {
        range: { startIndex: startIdx, endIndex: endIdx },
        paragraphStyle: {
          shading: {
            backgroundColor: { color: { rgbColor: hexToRgb(bgColor) } },
          },
        },
        fields: 'shading.backgroundColor',
      },
    });
  }

  // --- 1. Title ------------------------------------------------------------

  insertText(title, { bold: true, fontSize: 16, color: '#222A58', alignment: 'CENTER', fontFamily: 'Raleway' });
  insertNewline();
  insertText(subtitle, { italic: true, fontSize: 12, color: '#444444', alignment: 'CENTER' });
  insertNewline();

  // Horizontal rule / spacer
  insertNewline();

  // --- 2. Missionary Prayers -----------------------------------------------

  const prayerStartIdx = idx;

  insertText('INCLUDE IN PRAYERS THIS WEEK', {
    bold: true,
    fontSize: 14,
    color: '#222a58',
    alignment: 'CENTER',
    fontFamily: 'Raleway',
  });
  insertNewline();

  if (prayerSections.length === 0) {
    insertText('No prayers for our ministry partners this week', {
      italic: true,
      fontSize: 11,
      color: '#181c3a',
    });
    insertNewline();
  } else {
    for (const section of prayerSections) {
      // Include the original heading
      if (section.heading) {
        insertText(section.heading, {
          bold: true,
          italic: true,
          fontSize: 12,
          color: '#181c3a',
        });
        insertNewline();
      }
      // Include the content
      for (const item of section.content) {
        if (item.type === 'bullet') {
          insertText(`\u2022 ${item.text}`, {
            italic: true,
            fontSize: 11,
            color: '#181c3a',
            alignment: 'JUSTIFIED',
          });
          insertNewline();
        } else {
          const lines = item.text.split('\n');
          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed) {
              insertText(trimmed, {
                italic: true,
                fontSize: 11,
                color: '#181c3a',
                alignment: 'JUSTIFIED',
              });
              insertNewline();
            }
          }
        }
      }
    }
  }

  const prayerEndIdx = idx;

  // Apply background color to the entire prayer section
  applyParagraphBackground(prayerStartIdx, prayerEndIdx, '#e2e3f3');

  // Spacer after prayer section
  insertNewline();

  // --- 3. Permanent Announcements ------------------------------------------

  insertText('PERMANENT ANNOUNCEMENTS', {
    bold: true,
    fontSize: 14,
    color: '#222A58',
    alignment: 'CENTER',
    fontFamily: 'Raleway',
  });
  insertNewline();
  insertNewline();

  for (const ann of permanentAnnouncements) {
    if (ann.heading) {
      insertText(ann.heading, {
        bold: true,
        fontSize: 12,
        color: '#222A58',
        alignment: 'CENTER',
        fontFamily: 'Raleway',
      });
      insertNewline();
    }
    if (ann.text) {
      const lines = ann.text.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed) {
          insertText(trimmed, { fontSize: 11, color: '#181C3A', alignment: 'JUSTIFIED' });
          insertNewline();
        }
      }
    }
    insertNewline();
  }

  // --- 4. Weekly Announcements ---------------------------------------------

  insertText('WEEKLY ANNOUNCEMENTS', {
    bold: true,
    fontSize: 14,
    color: '#222A58',
    alignment: 'CENTER',
    fontFamily: 'Raleway',
  });
  insertNewline();
  insertNewline();

  for (const section of weeklySections) {
    if (section.heading) {
      insertText(section.heading, {
        bold: true,
        fontSize: 14,
        color: '#222A58',
        alignment: 'CENTER',
        fontFamily: 'Raleway',
      });
      insertNewline();
    }

    for (const item of section.content) {
      if (item.type === 'bullet') {
        insertText(`\u2022 ${item.text}`, { fontSize: 11, color: '#181C3A', alignment: 'JUSTIFIED' });
        insertNewline();
      } else {
        const lines = item.text.split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed) {
            insertText(trimmed, { fontSize: 11, color: '#181C3A', alignment: 'JUSTIFIED' });
            insertNewline();
          }
        }
      }
    }

    // Only add spacer after sections that have content, so consecutive
    // headings (e.g. "This Sunday" → sermon series → sermon title) stay tight.
    if (section.content.length > 0) {
      insertNewline();
    }
  }

  // --- 5. Regular Reminders ------------------------------------------------

  insertText('REGULAR REMINDERS', {
    bold: true,
    fontSize: 14,
    color: '#222A58',
    alignment: 'CENTER',
    fontFamily: 'Raleway',
  });
  insertNewline();
  insertNewline();

  if (regularReminders.length === 0) {
    insertText('No regular reminders this week', {
      italic: true,
      fontSize: 11,
      color: '#181C3A',
    });
    insertNewline();
  } else {
    for (const reminder of regularReminders) {
      if (reminder.heading) {
        insertText(reminder.heading, {
          bold: true,
          fontSize: 12,
          color: '#222A58',
          alignment: 'CENTER',
          fontFamily: 'Raleway',
        });
        insertNewline();
      }
      if (reminder.text) {
        const lines = reminder.text.split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed) {
            insertText(trimmed, { fontSize: 11, color: '#181C3A', alignment: 'JUSTIFIED' });
            insertNewline();
          }
        }
      }
      insertNewline();
    }
  }

  return requests;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Update an existing Google Doc with the full announcements structure.
 *
 * @param {string} docId
 * @param {object} opts – Same shape as buildDocRequests opts
 * @returns {{ docUrl: string, docId: string }}
 */
async function updateAnnouncementsDoc(docId, opts) {
  if (!docId) {
    throw new Error(
      'GOOGLE_DOC_ID is required. Create a Google Doc manually, share it with the service account as Editor, and add the doc ID as a GitHub secret.'
    );
  }

  const auth = getAuth();
  const docs = google.docs({ version: 'v1', auth });

  // 1. Get current doc to find content length
  console.log(`  Updating Google Doc: ${docId}`);
  const doc = await docs.documents.get({ documentId: docId });
  const endIndex = doc.data.body.content.reduce(
    (max, el) => Math.max(max, el.endIndex || 0),
    0
  );

  // 2. Clear all content (index 1 to end - 1; index 0 is reserved)
  if (endIndex > 2) {
    await docs.documents.batchUpdate({
      documentId: docId,
      requestBody: {
        requests: [{ deleteContentRange: { range: { startIndex: 1, endIndex: endIndex - 1 } } }],
      },
    });
    console.log('  Cleared existing content.');
  }

  // 3. Insert formatted content
  console.log('  Writing content...');
  const requests = buildDocRequests(opts);
  if (requests.length > 0) {
    await docs.documents.batchUpdate({
      documentId: docId,
      requestBody: { requests },
    });
  }

  const docUrl = `https://docs.google.com/document/d/${docId}/edit?usp=sharing`;
  console.log(`  Public URL: ${docUrl}`);

  return { docUrl, docId };
}

module.exports = { updateAnnouncementsDoc };
