/**
 * parse-sermon-info.js
 *
 * Extracts sermon title and scripture reference from the newsletter HTML.
 *
 * Looks for the "This Sunday" section in the newsletter, then extracts:
 *   - H2 tag content → sermon title
 *   - H3 tag content → scripture reference
 *
 * Returns: { sermonTitle: string|null, scripture: string|null }
 */

/**
 * Clean HTML tags and decode entities from a string.
 */
function cleanHtml(html) {
  if (!html) return '';
  let text = html.replace(/<br\s*\/?>/gi, ' ');
  text = text.replace(/<[^>]+>/g, '');
  text = text.replace(/&nbsp;/g, ' ');
  text = text.replace(/&amp;/g, '&');
  text = text.replace(/&lt;/g, '<');
  text = text.replace(/&gt;/g, '>');
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");
  text = text.replace(/&mdash;/g, '\u2014');
  text = text.replace(/&ndash;/g, '\u2013');
  text = text.replace(/[ \t]+/g, ' ');
  return text.trim();
}

/**
 * Extract sermon title and scripture reference from newsletter HTML.
 *
 * Strategy:
 *   1. Split the HTML by </tr> boundaries (same as parse-newsletter.js)
 *   2. Find the block containing a heading that matches "This Sunday"
 *   3. From that block and subsequent blocks (until the next major section),
 *      extract the first H2 (sermon title) and first H3 (scripture reference)
 *
 * @param {string} html – raw newsletter HTML
 * @returns {{ sermonTitle: string|null, scripture: string|null }}
 */
function extractSermonInfo(html) {
  if (!html) return { sermonTitle: null, scripture: null };

  // Remove style/script tags
  html = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  html = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');

  // Split into blocks like parse-newsletter.js does
  const blocks = html.split(/<\/tr>/gi);

  let inThisSundaySection = false;
  let sermonTitle = null;
  let scripture = null;

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];

    // Check all headings in this block
    const allHeadings = block.match(/<h[1-3][^>]*>(.*?)<\/h[1-3]>/gi) || [];

    for (const heading of allHeadings) {
      const text = cleanHtml(heading);
      if (/this\s+sunday/i.test(text)) {
        inThisSundaySection = true;
        break;
      }
    }

    if (!inThisSundaySection) continue;

    // Once we're in the "This Sunday" section, look for H2 and H3 tags
    // If we hit another major heading (H1) that isn't "This Sunday", stop
    const h1Matches = block.match(/<h1[^>]*>(.*?)<\/h1>/gi) || [];
    for (const h1 of h1Matches) {
      const text = cleanHtml(h1);
      if (text && !/this\s+sunday/i.test(text)) {
        // We've left the "This Sunday" section
        return { sermonTitle, scripture };
      }
    }

    // Extract H2 = sermon title (take the first one we find)
    if (!sermonTitle) {
      const h2Matches = block.match(/<h2[^>]*>([\s\S]*?)<\/h2>/gi);
      if (h2Matches) {
        for (const h2 of h2Matches) {
          const text = cleanHtml(h2);
          // Skip if it's just "This Sunday" itself
          if (text && !/this\s+sunday/i.test(text)) {
            sermonTitle = text;
            break;
          }
        }
      }
    }

    // Extract H3 = scripture reference (take the first one we find)
    if (!scripture) {
      const h3Matches = block.match(/<h3[^>]*>([\s\S]*?)<\/h3>/gi);
      if (h3Matches) {
        for (const h3 of h3Matches) {
          const text = cleanHtml(h3);
          if (text && !/this\s+sunday/i.test(text)) {
            scripture = text;
            break;
          }
        }
      }
    }

    // If we found both, we're done
    if (sermonTitle && scripture) break;

    // If we've moved past "This Sunday" into a new section heading, stop
    if (inThisSundaySection && allHeadings.length > 0) {
      const hasNonSundayHeading = allHeadings.some((h) => {
        const text = cleanHtml(h);
        return text && !/this\s+sunday/i.test(text) && !text.includes(sermonTitle) && !text.includes(scripture);
      });
      // Only break if we already found at least the title or both
      if (hasNonSundayHeading && sermonTitle) break;
    }
  }

  return { sermonTitle, scripture };
}

/**
 * Format sermon title and scripture into the plan item format.
 *
 * @param {string|null} sermonTitle
 * @param {string|null} scripture
 * @returns {string|null} e.g. "Sermon Title (Scripture)" or null if nothing found
 */
function formatSermonForPlanItem(sermonTitle, scripture) {
  if (!sermonTitle) return null;
  if (scripture) return `${sermonTitle} (${scripture})`;
  return sermonTitle;
}

module.exports = { extractSermonInfo, formatSermonForPlanItem };
