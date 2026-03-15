/**
 * Google Analytics Data API v1 (REST).
 * Queries the runReport endpoint directly with specified dimensions/metrics.
 */
var GA = (function () {
  var API_BASE = 'https://analyticsdata.googleapis.com/v1beta/properties/';

  /** Event names we care about. */
  var EVENT_NAMES = [
    'order_of_worship',
    'newsletter',
    'connect_card',
    'supporting_icp',
    'giving_usd',
    'giving_czk',
    'location'
  ];

  /** Human-friendly labels for event names. */
  var LABELS = {
    order_of_worship: 'Order of Worship',
    newsletter: 'Newsletter',
    connect_card: 'Connect Card',
    supporting_icp: 'Supporting ICP',
    giving_usd: 'Stripe',
    giving_czk: 'Giving (CZK)',
    location: 'Location'
  };

  /** Human-friendly source labels. */
  function sourceLabel(src) {
    if (!src || src === '(not set)') return 'Unknown';
    return src.charAt(0).toUpperCase() + src.slice(1);
  }

  /**
   * Fetch report for a single date range.
   * Returns { rows: [...], totals: { eventCount, totalUsers, newUsers } }
   */
  async function fetchReport(propertyId, startDate, endDate, token) {
    var url = API_BASE + propertyId + ':runReport';
    var body = {
      dateRanges: [{ startDate: startDate, endDate: endDate }],
      dimensions: [
        { name: 'eventName' },
        { name: 'sessionSource' }
      ],
      metrics: [
        { name: 'eventCount' },
        { name: 'totalUsers' },
        { name: 'newUsers' }
      ],
      dimensionFilter: {
        filter: {
          fieldName: 'eventName',
          inListFilter: {
            values: EVENT_NAMES
          }
        }
      },
      limit: 10000
    };

    var resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (!resp.ok) {
      var err = await resp.text();
      throw new Error('GA API error (' + resp.status + '): ' + err);
    }

    var data = await resp.json();
    return parseReport(data);
  }

  function parseReport(data) {
    var rows = [];
    var totals = { eventCount: 0, totalUsers: 0, newUsers: 0 };

    if (!data.rows || data.rows.length === 0) {
      return { rows: rows, totals: totals };
    }

    data.rows.forEach(function (row) {
      var eventName = row.dimensionValues[0].value;
      var source = row.dimensionValues[1].value;
      var eventCount = parseInt(row.metricValues[0].value, 10) || 0;
      var totalUsers = parseInt(row.metricValues[1].value, 10) || 0;
      var newUsers = parseInt(row.metricValues[2].value, 10) || 0;

      rows.push({
        eventName: eventName,
        label: LABELS[eventName] || eventName,
        source: source,
        sourceLabel: sourceLabel(source),
        eventCount: eventCount,
        totalUsers: totalUsers,
        newUsers: newUsers
      });

      totals.eventCount += eventCount;
      totals.totalUsers += totalUsers;
      totals.newUsers += newUsers;
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
    // Return in a stable order matching EVENT_NAMES for event-based aggregation
    if (keyField === 'eventName') {
      return EVENT_NAMES.filter(function (n) { return map[n]; })
                        .map(function (n) { return map[n]; });
    }
    return Object.values(map).sort(function (a, b) { return b.eventCount - a.eventCount; });
  }

  return {
    fetchReport: fetchReport,
    aggregateBy: aggregateBy,
    EVENT_NAMES: EVENT_NAMES,
    LABELS: LABELS,
    sourceLabel: sourceLabel
  };
})();
