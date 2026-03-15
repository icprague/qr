/**
 * Google Analytics Data API v1 (REST).
 * Queries the runReport endpoint directly with specified dimensions/metrics.
 *
 * The QR landing pages fire:  gtag('event', 'button_click', { button_name: '...' })
 * So the GA eventName is always "button_click" and the button identity lives
 * in the custom dimension "customEvent:button_name".
 */
var GA = (function () {
  var API_BASE = 'https://analyticsdata.googleapis.com/v1beta/properties/';

  /** button_name values we care about. */
  var BUTTON_NAMES = [
    'order_of_worship',
    'newsletter',
    'connect_card',
    'supporting_icp',
    'giving_usd',
    'giving_czk',
    'location'
  ];

  /** Human-friendly labels for button names. */
  var LABELS = {
    order_of_worship: 'Order of Worship',
    newsletter: 'Newsletter',
    connect_card: 'Connect Card',
    supporting_icp: 'Supporting ICP',
    giving_usd: 'Card Payment',
    giving_czk: 'Czech Bank Transfer',
    location: 'Location'
  };

  /** Human-friendly source labels. */
  function sourceLabel(src) {
    if (!src || src === '(not set)') return 'Unknown';
    return src.charAt(0).toUpperCase() + src.slice(1);
  }

  /** Shared filter: eventName=button_click AND button_name in BUTTON_NAMES. */
  var DIMENSION_FILTER = {
    andGroup: {
      expressions: [
        {
          filter: {
            fieldName: 'eventName',
            stringFilter: { value: 'button_click', matchType: 'EXACT' }
          }
        },
        {
          filter: {
            fieldName: 'customEvent:button_name',
            inListFilter: { values: BUTTON_NAMES }
          }
        }
      ]
    }
  };

  /**
   * Fetch report for a single date range.
   * Makes two parallel calls:
   *   1. Detailed rows (button_name × source) for charts/tables
   *   2. Totals-only query (no dimensions) so GA deduplicates users correctly
   * Returns { rows: [...], totals: { eventCount, totalUsers, newUsers } }
   */
  async function fetchReport(propertyId, startDate, endDate, token) {
    var url = API_BASE + propertyId + ':runReport';
    var headers = {
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/json'
    };
    var dateRanges = [{ startDate: startDate, endDate: endDate }];
    var metrics = [
      { name: 'eventCount' },
      { name: 'totalUsers' },
      { name: 'newUsers' }
    ];

    // Detailed breakdown by button × source
    var detailBody = {
      dateRanges: dateRanges,
      dimensions: [
        { name: 'customEvent:button_name' },
        { name: 'sessionSource' }
      ],
      metrics: metrics,
      dimensionFilter: DIMENSION_FILTER,
      limit: 10000
    };

    // Totals only — no dimensions so users are properly deduplicated
    var totalsBody = {
      dateRanges: dateRanges,
      metrics: metrics,
      dimensionFilter: DIMENSION_FILTER
    };

    var results = await Promise.all([
      fetchJSON(url, headers, detailBody),
      fetchJSON(url, headers, totalsBody)
    ]);

    return parseReport(results[0], results[1]);
  }

  async function fetchJSON(url, headers, body) {
    var resp = await fetch(url, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(body)
    });
    if (!resp.ok) {
      var err = await resp.text();
      throw new Error('GA API error (' + resp.status + '): ' + err);
    }
    return resp.json();
  }

  function parseReport(detailData, totalsData) {
    var rows = [];

    // Deduplicated totals from the dimension-less query
    var totals = { eventCount: 0, totalUsers: 0, newUsers: 0 };
    if (totalsData.rows && totalsData.rows.length > 0) {
      var t = totalsData.rows[0].metricValues;
      totals.eventCount = parseInt(t[0].value, 10) || 0;
      totals.totalUsers = parseInt(t[1].value, 10) || 0;
      totals.newUsers   = parseInt(t[2].value, 10) || 0;
    }

    if (!detailData.rows || detailData.rows.length === 0) {
      return { rows: rows, totals: totals };
    }

    detailData.rows.forEach(function (row) {
      var buttonName = row.dimensionValues[0].value;
      var source = row.dimensionValues[1].value;
      var eventCount = parseInt(row.metricValues[0].value, 10) || 0;
      var totalUsers = parseInt(row.metricValues[1].value, 10) || 0;
      var newUsers = parseInt(row.metricValues[2].value, 10) || 0;

      rows.push({
        eventName: buttonName,
        label: LABELS[buttonName] || buttonName,
        source: source,
        sourceLabel: sourceLabel(source),
        eventCount: eventCount,
        totalUsers: totalUsers,
        newUsers: newUsers
      });
    });

    return { rows: rows, totals: totals };
  }

  /**
   * Aggregate rows by a key (e.g. 'eventName' or 'source').
   * Returns a Map-like array of { key, label, eventCount, totalUsers, newUsers }.
   */
  function aggregateBy(rows, keyField, labelField) {
    var map = {};
    rows.forEach(function (r) {
      var k = r[keyField];
      if (!map[k]) {
        map[k] = { key: k, label: r[labelField], eventCount: 0, totalUsers: 0, newUsers: 0 };
      }
      map[k].eventCount += r.eventCount;
      map[k].totalUsers += r.totalUsers;
      map[k].newUsers += r.newUsers;
    });
    // Return in a stable order matching BUTTON_NAMES for event-based aggregation
    if (keyField === 'eventName') {
      return BUTTON_NAMES.filter(function (n) { return map[n]; })
                        .map(function (n) { return map[n]; });
    }
    return Object.values(map).sort(function (a, b) { return b.eventCount - a.eventCount; });
  }

  return {
    fetchReport: fetchReport,
    aggregateBy: aggregateBy,
    EVENT_NAMES: BUTTON_NAMES,
    LABELS: LABELS,
    sourceLabel: sourceLabel
  };
})();
