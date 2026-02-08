/**
 * google-docs.js
 *
 * Helper module for creating/updating a Google Doc with announcements.
 * Supports reusing a single doc (same URL each week) by passing an
 * existing doc ID — the content is cleared and rewritten in place.
 *
 * Uses Application Default Credentials (ADC), which are automatically
 * provided by the google-github-actions/auth workflow step via
 * Workload Identity Federation.
 */

const { google } = require('googleapis');

/**
 * Get auth client using Application Default Credentials.
 * In GitHub Actions, these are set by google-github-actions/auth.
 */
function getAuth() {
  return new google.auth.GoogleAuth({
    scopes: [
      'https://www.googleapis.com/auth/documents',
      'https://www.googleapis.com/auth/drive',
    ],
  });
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
 * Create or update a Google Doc with announcements content.
 *
 * If `existingDocId` is provided, the existing doc is cleared and rewritten
 * (keeping the same URL — ideal for a permanent QR code).
 * If not, a new doc is created and shared publicly.
 *
 * @param {Array} sections – Parsed newsletter sections
 * @param {string} title – "SUNDAY ANNOUNCEMENTS"
 * @param {string} subtitle – Formatted date string
 * @param {string} docTitle – Document title (shown in Google Drive)
 * @param {string} [existingDocId] – If set, reuse this doc instead of creating a new one
 * @returns {{ docUrl: string, docId: string }}
 */
async function createAnnouncementsDoc(sections, title, subtitle, docTitle, existingDocId) {
  // Debug: check credentials
  console.log(`  GOOGLE_APPLICATION_CREDENTIALS: ${process.env.GOOGLE_APPLICATION_CREDENTIALS ? 'SET' : 'NOT SET'}`);
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    try {
      const fs = require('fs');
      const creds = JSON.parse(fs.readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8'));
      console.log(`  Credential type: ${creds.type}`);
      console.log(`  Service account: ${creds.service_account_impersonation_url || creds.client_email || 'N/A'}`);
    } catch (e) { console.log(`  Could not read credential file: ${e.message}`); }
  }

  const auth = getAuth();

  // Debug: verify auth works
  try {
    const client = await auth.getClient();
    console.log(`  Auth client type: ${client.constructor.name}`);
    const token = await client.getAccessToken();
    console.log(`  Access token obtained: ${token ? 'YES' : 'NO'}`);
  } catch (e) {
    console.error(`  Auth error: ${e.message}`);
  }

  const docs = google.docs({ version: 'v1', auth });
  const drive = google.drive({ version: 'v3', auth });

  let docId;

  if (existingDocId) {
    // --- Reuse existing doc ---
    docId = existingDocId;
    console.log(`  Reusing existing Google Doc: ${docId}`);

    // Get current doc to find content length
    const doc = await docs.documents.get({ documentId: docId });
    const endIndex = doc.data.body.content.reduce(
      (max, el) => Math.max(max, el.endIndex || 0),
      0
    );

    // Clear all content (index 1 to end - 1; index 0 is reserved)
    if (endIndex > 2) {
      await docs.documents.batchUpdate({
        documentId: docId,
        requestBody: {
          requests: [{ deleteContentRange: { range: { startIndex: 1, endIndex: endIndex - 1 } } }],
        },
      });
    }

    // Update the document title
    await drive.files.update({
      fileId: docId,
      requestBody: { name: docTitle },
    });

    console.log('  Cleared existing content.');
  } else {
    // --- Create new doc ---
    console.log('  Creating new Google Doc...');
    const createRes = await docs.documents.create({
      requestBody: { title: docTitle },
    });
    docId = createRes.data.documentId;
    console.log(`  Doc ID: ${docId}`);

    // Share as "anyone with the link can view"
    console.log('  Setting sharing to "anyone with link"...');
    await drive.permissions.create({
      fileId: docId,
      requestBody: { role: 'reader', type: 'anyone' },
    });
  }

  // Insert formatted content
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

module.exports = { createAnnouncementsDoc };
