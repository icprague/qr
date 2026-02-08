/**
 * google-docs.js
 *
 * Helper module for creating a Google Doc from announcements sections
 * and sharing it as "anyone with the link can view".
 *
 * Requires GOOGLE_SERVICE_ACCOUNT_KEY env var (JSON key for a service account
 * with Google Docs API and Google Drive API enabled).
 */

const { google } = require('googleapis');

/**
 * Authenticate with Google using a service account key.
 * @param {string} keyJson – JSON string of the service account key
 * @returns {google.auth.JWT}
 */
function getAuth(keyJson) {
  const key = JSON.parse(keyJson);
  return new google.auth.JWT(
    key.client_email,
    null,
    key.private_key,
    [
      'https://www.googleapis.com/auth/documents',
      'https://www.googleapis.com/auth/drive',
    ]
  );
}

/**
 * Build a Google Docs batchUpdate requests array from announcement sections.
 * The Google Docs API inserts text at indices — we build from bottom up.
 *
 * @param {Array} sections – [{ heading, content: [{ type, text }] }]
 * @param {string} title – Document title line
 * @param {string} subtitle – Date subtitle line
 * @returns {Array} requests for docs.documents.batchUpdate
 */
function buildDocRequests(sections, title, subtitle) {
  // We'll build the full document as a flat list of insert operations.
  // Google Docs API inserts at an index, so we insert everything at index 1
  // in reverse order (last content first).
  const requests = [];
  let idx = 1; // Start after the initial newline

  // Helper: insert text and track index
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

    // Blank line between sections
    insertNewline();
  }

  return requests;
}

/**
 * Convert hex color to Google API RGB format (0-1 range).
 */
function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return {
    red: parseInt(h.substring(0, 2), 16) / 255,
    green: parseInt(h.substring(2, 4), 16) / 255,
    blue: parseInt(h.substring(4, 6), 16) / 255,
  };
}

/**
 * Create a Google Doc with announcements content and share it publicly.
 *
 * @param {string} keyJson – GOOGLE_SERVICE_ACCOUNT_KEY env var
 * @param {Array} sections – Parsed newsletter sections
 * @param {string} title – "SUNDAY ANNOUNCEMENTS"
 * @param {string} subtitle – Formatted date string
 * @param {string} docTitle – Document title (shown in Google Drive)
 * @returns {{ docUrl: string, docId: string }}
 */
async function createAnnouncementsDoc(keyJson, sections, title, subtitle, docTitle) {
  const auth = getAuth(keyJson);

  const docs = google.docs({ version: 'v1', auth });
  const drive = google.drive({ version: 'v3', auth });

  // 1. Create an empty document
  console.log('  Creating Google Doc...');
  const createRes = await docs.documents.create({
    requestBody: { title: docTitle },
  });
  const docId = createRes.data.documentId;
  console.log(`  Doc ID: ${docId}`);

  // 2. Insert formatted content
  console.log('  Writing content...');
  const requests = buildDocRequests(sections, title, subtitle);
  if (requests.length > 0) {
    await docs.documents.batchUpdate({
      documentId: docId,
      requestBody: { requests },
    });
  }

  // 3. Share as "anyone with the link can view"
  console.log('  Setting sharing to "anyone with link"...');
  await drive.permissions.create({
    fileId: docId,
    requestBody: {
      role: 'reader',
      type: 'anyone',
    },
  });

  const docUrl = `https://docs.google.com/document/d/${docId}/edit?usp=sharing`;
  console.log(`  Public URL: ${docUrl}`);

  return { docUrl, docId };
}

module.exports = { createAnnouncementsDoc };
