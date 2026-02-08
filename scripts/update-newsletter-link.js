/**
 * update-newsletter-link.js
 *
 * Fetches the Mailchimp campaign archive page, extracts the most recent
 * newsletter URL, and writes it to newsletter-link.json so the landing
 * page can link to it dynamically.
 *
 * Environment variables:
 *   MAILCHIMP_ARCHIVE_URL – Full URL to your Mailchimp campaign archive page
 *                           (e.g. https://us7.campaign-archive.com/home/?u=xxx&id=yyy)
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const cheerio = require('cheerio');

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
          let next = res.headers.location;
          if (next.startsWith('/')) {
            const u = new URL(url);
            next = u.origin + next;
          }
          return resolve(fetch(next, redirects + 1));
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
  console.log(`Fetched ${html.length} bytes`);

  const $ = cheerio.load(html);

  // Collect ALL links on the page for analysis
  const allLinks = [];
  $('a[href]').each((_, el) => {
    allLinks.push($(el).attr('href'));
  });

  console.log(`Found ${allLinks.length} total links on archive page`);

  // Parse the archive URL so we can exclude it and its variations
  const archiveUrlObj = new URL(ARCHIVE_URL);

  // Filter for campaign links — these are links that:
  //  - Point to campaign-archive.com (without /home/ path) OR
  //  - Point to mailchi.mp OR
  //  - Point to eepurl.com
  // We exclude the archive page itself (/home/ path)
  const campaignLinks = allLinks.filter((href) => {
    if (!href) return false;

    // Normalize HTML entities
    const link = href.replace(/&amp;/g, '&');

    // Skip the archive page itself (contains /home/)
    if (link.includes('/home/')) return false;
    // Skip anchors and javascript
    if (link.startsWith('#') || link.startsWith('javascript:')) return false;
    // Skip mailchimp.com main site links
    if (link.includes('mailchimp.com')) return false;

    // Match known campaign link patterns
    if (/campaign-archive\.com/i.test(link)) return true;
    if (/mailchi\.mp/i.test(link)) return true;
    if (/eepurl\.com/i.test(link)) return true;

    return false;
  });

  // Log what we found for debugging
  if (campaignLinks.length === 0) {
    console.log('\nNo campaign links found. All links on page:');
    allLinks.forEach((link, i) => {
      console.log(`  [${i}] ${link}`);
    });
    // Also dump a snippet of the HTML for debugging
    console.log('\nFirst 2000 chars of HTML:');
    console.log(html.substring(0, 2000));
    console.error('\nError: Could not find any newsletter link on the archive page.');
    process.exit(1);
  }

  console.log(`Found ${campaignLinks.length} campaign links:`);
  campaignLinks.slice(0, 5).forEach((link, i) => {
    console.log(`  [${i}] ${link}`);
  });

  // Take the first one (most recent campaign — Mailchimp lists newest first)
  let newestUrl = campaignLinks[0].replace(/&amp;/g, '&');

  // Make sure it's an absolute URL
  if (newestUrl.startsWith('/')) {
    newestUrl = archiveUrlObj.origin + newestUrl;
  }

  const data = {
    url: newestUrl,
    updatedAt: new Date().toISOString(),
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  console.log(`\nUpdated newsletter-link.json:`);
  console.log(`  url: ${data.url}`);
  console.log(`  updatedAt: ${data.updatedAt}`);
}

main().catch((err) => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
