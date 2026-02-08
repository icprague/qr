/**
 * update-newsletter-link.js
 *
 * Fetches the Mailchimp campaign archive page, extracts the most recent
 * newsletter URL, and writes it to newsletter-link.json so the landing
 * page can link to it dynamically.
 *
 * Environment variables:
 *   MAILCHIMP_ARCHIVE_URL – Full URL to your Mailchimp campaign archive page
 *                           (e.g. https://us1.campaign-archive.com/home/?u=xxx&id=yyy)
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const ARCHIVE_URL = process.env.MAILCHIMP_ARCHIVE_URL;
const OUTPUT_FILE = path.resolve(__dirname, '..', 'newsletter-link.json');

if (!ARCHIVE_URL) {
  console.error('Error: MAILCHIMP_ARCHIVE_URL environment variable is not set.');
  process.exit(1);
}

/**
 * Simple HTTP(S) GET that follows redirects (up to 5).
 */
function fetch(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('Too many redirects'));
    const client = url.startsWith('https') ? https : http;
    client
      .get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return resolve(fetch(res.headers.location, redirects + 1));
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        }
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
      })
      .on('error', reject);
  });
}

async function main() {
  console.log(`Fetching Mailchimp archive: ${ARCHIVE_URL}`);
  const html = await fetch(ARCHIVE_URL);

  // Mailchimp archive pages list campaigns as links like:
  //   <a href="https://mailchi.mp/..." ...>  or
  //   <a href="https://us1.campaign-archive.com/..." ...>
  // We grab the first campaign link on the page (most recent).
  const linkPatterns = [
    // mailchi.mp short links
    /href="(https?:\/\/mailchi\.mp\/[^"]+)"/gi,
    // campaign-archive.com full links (but not the /home/ page itself)
    /href="(https?:\/\/[^"]*campaign-archive\.com\/\?[^"]+)"/gi,
  ];

  let newestUrl = null;

  for (const pattern of linkPatterns) {
    const match = pattern.exec(html);
    if (match) {
      newestUrl = match[1];
      break;
    }
  }

  if (!newestUrl) {
    console.error('Error: Could not find any newsletter link on the archive page.');
    console.error('The archive page HTML may have changed. Check the URL and page structure.');
    process.exit(1);
  }

  const data = {
    url: newestUrl,
    updatedAt: new Date().toISOString(),
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  console.log(`Updated newsletter-link.json:`);
  console.log(`  url: ${data.url}`);
  console.log(`  updatedAt: ${data.updatedAt}`);
}

main().catch((err) => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
