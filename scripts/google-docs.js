/**
 * google-docs.js
 *
 * Helper module for updating a Google Doc with announcements content.
 * Requires a pre-created Google Doc shared with the service account as Editor.
 * The doc content is cleared and rewritten each week, keeping the same URL.
 *
 * Uses an access token from the google-github-actions/auth workflow step
 * (GOOGLE_ACCESS_TOKEN env var), obtained via Workload Identity Federation.
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
 * Build a Google Docs batchUpdate requests array from announcement sections.
 *
 * @param {Array} sections – [{ heading, content: [{ type, text }] }]
 * @param {string} title – Document title line
 * @param {string} subtitle – Date subtitle line
 * @returns {Array} requests for docs.documents.batchUpdate
 */
function buildDocRequests(sections, title, subtitle) {
  const requests = [];
  let idx = 1;

  function insertText(text, bold = false, italic = false, fontSize = 11, color = '#181C3A', alignment = 'START', fontFamily = 'Lato') {
    const endIdx = idx + text.length;
    requests.push({
      insertText: { location: { index: idx }, text },
    });
    requests.push({
      updateTextStyle: {
        range: { startIndex: idx, endIndex: endIdx },
        textStyle: {
          bold,
          italic,
          fontSize: { magnitude: fontSize, unit: 'PT' },
          foregroundColor: {
            color: { rgbColor: hexToRgb(color) },
          },
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
    return endIdx;
  }

  function insertNewline() {
    requests.push({ insertText: { location: { index: idx }, text: '\n' } });
    idx += 1;
  }

  // --- Title ---
  insertText(title, true, false, 16, '#222A58', 'CENTER', 'Raleway');
  insertNewline();

  // --- Subtitle ---
  insertText(subtitle, false, true, 12, '#444444', 'CENTER', 'Lato');
  insertNewline();

  // --- Horizontal rule ---
  requests.push({ insertText: { location: { index: idx }, text: '\n' } });
  idx += 1;

  // --- Sections ---
  for (const section of sections) {
    if (section.heading) {
      insertText(section.heading, true, false, 14, '#222A58', 'START', 'Raleway');
      insertNewline();
    }

    for (const item of section.content) {
      if (item.type === 'bullet') {
        insertText(`\u2022 ${item.text}`, false, false, 11, '#181C3A', 'START', 'Lato');
        insertNewline();
      } else {
        insertText(item.text, false, false, 11, '#181C3A', 'START', 'Lato');
        insertNewline();
      }
    }

    insertNewline();
  }

  return requests;
}

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return {
    red: parseInt(h.substring(0, 2), 16) / 255,
    green: parseInt(h.substring(2, 4), 16) / 255,
    blue: parseInt(h.substring(4, 6), 16) / 255,
  };
}

/**
 * Update an existing Google Doc with announcements content.
 * The doc must be pre-created and shared with the service account as Editor.
 *
 * @param {string} docId – The Google Doc ID (from GOOGLE_DOC_ID secret)
 * @param {Array} sections – Parsed newsletter sections
 * @param {string} title – "SUNDAY ANNOUNCEMENTS"
 * @param {string} subtitle – Formatted date string
 * @returns {{ docUrl: string, docId: string }}
 */
async function updateAnnouncementsDoc(docId, sections, title, subtitle) {
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
  const requests = buildDocRequests(sections, title, subtitle);
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
