/**
 * parse-newsletter.js
 *
 * Parses Mailchimp newsletter HTML to extract announcement sections.
 * Ported from a proven Google Apps Script implementation.
 *
 * - Only h1-h3 tags are treated as headings (not h4, not <strong>)
 * - Stops at "Offering Report" heading — everything after is excluded
 * - Skips "In This Issue" sections
 * - Filters footer content (unsubscribe, preferences, etc.)
 */

function parseNewsletter(html) {
  const sections = extractSections(html);
  console.log(`Extracted ${sections.length} sections from newsletter.\n`);
  return sections;
}

function extractSections(html) {
  const sections = [];

  html = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  html = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');

  const sectionSplits = html.split(/<\/tr>/gi);

  var foundOfferingReport = false;
  var lastHeading = null;
  var lastContent = [];
  var skipNextContent = false;

  for (var i = 0; i < sectionSplits.length; i++) {
    var block = sectionSplits[i];

    if (foundOfferingReport) break;

    const headings = extractAllHeadings(block);

    var shouldSkip = false;
    for (var h = 0; h < headings.length; h++) {
      if (headings[h].match(/in\s+this\s+issue/i)) {
        shouldSkip = true;
        skipNextContent = true;
        break;
      }
      if (headings[h].match(/offering\s+report/i)) {
        foundOfferingReport = true;
        break;
      }
    }

    if (foundOfferingReport || shouldSkip) {
      if (foundOfferingReport) break;
      continue;
    }

    const contentItems = extractContent(block);

    if (skipNextContent && contentItems.length > 0 && headings.length === 0) {
      continue;
    } else if (headings.length > 0) {
      skipNextContent = false;
    }

    if (headings.length > 0) {
      if (lastHeading || lastContent.length > 0) {
        sections.push({
          heading: lastHeading || '',
          content: lastContent
        });
        lastContent = [];
      }

      for (var h = 0; h < headings.length; h++) {
        var heading = headings[h];
        if (!isFooterContent(heading)) {
          if (h === headings.length - 1) {
            lastHeading = heading;
            lastContent = contentItems;
          } else {
            sections.push({
              heading: heading,
              content: []
            });
          }
        }
      }
    } else if (contentItems.length > 0 && !isFooterContent(contentItems[0].text)) {
      for (var c = 0; c < contentItems.length; c++) {
        lastContent.push(contentItems[c]);
      }
    }
  }

  if (lastHeading || lastContent.length > 0) {
    sections.push({
      heading: lastHeading || '',
      content: lastContent
    });
  }

  return sections;
}

function extractAllHeadings(html) {
  const headings = [];

  // ONLY look for h1, h2, h3 tags — nothing else
  var hMatches = html.match(/<h[1-3][^>]*>(.*?)<\/h[1-3]>/gi);
  if (hMatches) {
    for (var i = 0; i < hMatches.length; i++) {
      const text = cleanHtml(hMatches[i]);
      if (text && text.length > 0) {
        headings.push(text);
      }
    }
  }

  return headings;
}

function extractContent(html) {
  const items = [];

  var contentRegex = /(<ul[^>]*>[\s\S]*?<\/ul>)|(<p[^>]*>[\s\S]*?<\/p>)|(<div[^>]*class="[^"]*mcnText[^"]*"[^>]*>[\s\S]*?<\/div>)|(<td[^>]*class="[^"]*mcnTextContent[^"]*"[^>]*>[\s\S]*?<\/td>)/gi;
  var matches = html.match(contentRegex);

  if (!matches) return items;

  for (var i = 0; i < matches.length; i++) {
    var block = matches[i];

    if (block.match(/^<ul/i)) {
      var liMatches = block.match(/<li[^>]*>(.*?)<\/li>/gis);
      if (liMatches) {
        for (var j = 0; j < liMatches.length; j++) {
          const text = cleanHtml(liMatches[j]);
          if (text.trim().length > 0 && !isFooterContent(text)) {
            items.push({ type: 'bullet', text: text });
          }
        }
      }
    } else if (block.match(/^<p/i)) {
      const text = cleanHtml(block);
      if (text.trim().length > 0 && !isFooterContent(text)) {
        items.push({ type: 'paragraph', text: text });
      }
    } else if (block.match(/^<(div|td)/i)) {
      if (block.match(/<ul[^>]*>/i) || block.match(/<p[^>]*>/i)) {
        var innerUL = block.match(/<ul[^>]*>[\s\S]*?<\/ul>/gi);
        var innerP = block.match(/<p[^>]*>[\s\S]*?<\/p>/gi);

        if (innerUL || innerP) {
          var allInner = [];
          if (innerUL) {
            for (var k = 0; k < innerUL.length; k++) {
              allInner.push({ tag: 'ul', content: innerUL[k], pos: block.indexOf(innerUL[k]) });
            }
          }
          if (innerP) {
            for (var k = 0; k < innerP.length; k++) {
              allInner.push({ tag: 'p', content: innerP[k], pos: block.indexOf(innerP[k]) });
            }
          }

          allInner.sort(function(a, b) { return a.pos - b.pos; });

          for (var k = 0; k < allInner.length; k++) {
            if (allInner[k].tag === 'ul') {
              var liMatches = allInner[k].content.match(/<li[^>]*>(.*?)<\/li>/gis);
              if (liMatches) {
                for (var j = 0; j < liMatches.length; j++) {
                  const text = cleanHtml(liMatches[j]);
                  if (text.trim().length > 0 && !isFooterContent(text)) {
                    items.push({ type: 'bullet', text: text });
                  }
                }
              }
            } else {
              const text = cleanHtml(allInner[k].content);
              if (text.trim().length > 0 && !isFooterContent(text)) {
                items.push({ type: 'paragraph', text: text });
              }
            }
          }
        }
      } else {
        const text = cleanHtml(block);
        if (text.trim().length > 0 && !isFooterContent(text)) {
          items.push({ type: 'paragraph', text: text });
        }
      }
    }
  }

  return items;
}

function cleanHtml(html) {
  if (!html) return '';

  var text = html.replace(/<br\s*\/?>/gi, '\n');
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
  text = text.replace(/\n\s+/g, '\n');
  text = text.replace(/\s+\n/g, '\n');
  text = text.replace(/\n{3,}/g, '\n\n');
  text = text.trim();

  return text;
}

function isFooterContent(text) {
  const lowerText = text.toLowerCase();
  return lowerText.indexOf('unsubscribe') >= 0 ||
         lowerText.indexOf('preferences') >= 0 ||
         lowerText.indexOf('why did i get this') >= 0 ||
         lowerText.indexOf('sent with mailchimp') >= 0 ||
         lowerText.indexOf('follow us') >= 0 ||
         lowerText.indexOf('view this email in your browser') >= 0 ||
         lowerText.indexOf('view email in browser') >= 0 ||
         lowerText.indexOf('view in your browser') >= 0 ||
         lowerText.indexOf('in this issue') >= 0 ||
         lowerText.trim() === 'subscribe';
}

/**
 * Separate missionary prayer sections from the rest of the newsletter sections.
 *
 * @param {Array} sections – All parsed sections from parseNewsletter()
 * @param {Array<string>} patterns – Heading prefixes to match (case-insensitive)
 * @returns {{ prayerSections: Array, weeklySections: Array }}
 */
function separatePrayerSections(sections, patterns) {
  const prayerSections = [];
  const weeklySections = [];

  for (const section of sections) {
    const heading = (section.heading || '').trim();
    const isPrayer = patterns.some((pattern) =>
      heading.toLowerCase().startsWith(pattern.toLowerCase())
    );
    if (isPrayer) {
      prayerSections.push(section);
    } else {
      weeklySections.push(section);
    }
  }

  return { prayerSections, weeklySections };
}

module.exports = { parseNewsletter, separatePrayerSections };
