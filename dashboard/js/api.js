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

    // newUsers metric only works for unfiltered queries (counts first_visit events).
    // With button_click filter it returns 0, so use separate metric arrays.
    var metricsBase = [
      { name: 'eventCount' },
      { name: 'totalUsers' }
    ];
    var metricsWithNew = [
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
      metrics: metricsBase,
      dimensionFilter: DIMENSION_FILTER,
      limit: 10000
    };

    // Totals only — no dimensions so users are properly deduplicated
    var totalsBody = {
      dateRanges: dateRanges,
      metrics: metricsBase,
      dimensionFilter: DIMENSION_FILTER
    };

    // Per-button totals — single dimension so users are deduplicated per button
    var perButtonBody = {
      dateRanges: dateRanges,
      dimensions: [
        { name: 'customEvent:button_name' }
      ],
      metrics: metricsBase,
      dimensionFilter: DIMENSION_FILTER,
      limit: 10000
    };

    // Per-source totals — single dimension so users are deduplicated per source
    var perSourceBody = {
      dateRanges: dateRanges,
      dimensions: [
        { name: 'sessionSource' }
      ],
      metrics: metricsBase,
      dimensionFilter: DIMENSION_FILTER,
      limit: 10000
    };

    // Per-button × newVsReturning — shows new vs returning users per button
    var perButtonNvrBody = {
      dateRanges: dateRanges,
      dimensions: [
        { name: 'customEvent:button_name' },
        { name: 'newVsReturning' }
      ],
      metrics: metricsBase,
      dimensionFilter: DIMENSION_FILTER,
      limit: 10000
    };

    // Deduplicated new vs returning totals (no button dimension)
    var nvrTotalsBody = {
      dateRanges: dateRanges,
      dimensions: [
        { name: 'newVsReturning' }
      ],
      metrics: metricsBase,
      dimensionFilter: DIMENSION_FILTER
    };

    // Visitor totals — ALL users who visited (no button_click filter)
    // Uses metricsWithNew since newUsers metric works here
    var visitorTotalsBody = {
      dateRanges: dateRanges,
      metrics: metricsWithNew
    };

    // Visitor NVR — returning visitors (no button_click filter)
    var visitorNvrBody = {
      dateRanges: dateRanges,
      dimensions: [
        { name: 'newVsReturning' }
      ],
      metrics: metricsBase
    };

    var results = await Promise.all([
      fetchJSON(url, headers, detailBody),
      fetchJSON(url, headers, totalsBody),
      fetchJSON(url, headers, perButtonBody),
      fetchJSON(url, headers, perSourceBody),
      fetchJSON(url, headers, perButtonNvrBody),
      fetchJSON(url, headers, nvrTotalsBody),
      fetchJSON(url, headers, visitorTotalsBody),
      fetchJSON(url, headers, visitorNvrBody)
    ]);

    return parseReport(results[0], results[1], results[2], results[3], results[4], results[5], results[6], results[7]);
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

  function parseReport(detailData, totalsData, perButtonData, perSourceData, perButtonNvrData, nvrTotalsData, visitorTotalsData, visitorNvrData) {
    var rows = [];

    // Deduplicated totals from the dimension-less query
    // metrics: [eventCount, totalUsers]
    var totals = { eventCount: 0, totalUsers: 0, newUsers: 0, returningUsers: 0 };
    if (totalsData.rows && totalsData.rows.length > 0) {
      var t = totalsData.rows[0].metricValues;
      totals.eventCount = parseInt(t[0].value, 10) || 0;
      totals.totalUsers = parseInt(t[1].value, 10) || 0;
    }

    // New and returning clicker counts from NVR dimension
    // (newUsers metric doesn't work with button_click filter)
    if (nvrTotalsData && nvrTotalsData.rows) {
      nvrTotalsData.rows.forEach(function (row) {
        var nvrType = row.dimensionValues[0].value;
        var users = parseInt(row.metricValues[1].value, 10) || 0;
        if (nvrType === 'new') {
          totals.newUsers = users;
        } else if (nvrType === 'returning') {
          totals.returningUsers = users;
        }
      });
    }

    // Deduplicated per-button totals (single-dimension query)
    var byButton = [];
    if (perButtonData && perButtonData.rows) {
      perButtonData.rows.forEach(function (row) {
        var buttonName = row.dimensionValues[0].value;
        byButton.push({
          key: buttonName,
          label: LABELS[buttonName] || buttonName,
          eventCount: parseInt(row.metricValues[0].value, 10) || 0,
          totalUsers: parseInt(row.metricValues[1].value, 10) || 0
        });
      });
      byButton = BUTTON_NAMES.filter(function (n) {
        return byButton.some(function (b) { return b.key === n; });
      }).map(function (n) {
        return byButton.find(function (b) { return b.key === n; });
      });
    }

    // Per-button new vs returning breakdown
    var byButtonNvr = {};
    if (perButtonNvrData && perButtonNvrData.rows) {
      console.log('[NVR per-button] rows:', JSON.stringify(perButtonNvrData.rows));
      perButtonNvrData.rows.forEach(function (row) {
        var buttonName = row.dimensionValues[0].value;
        var nvrType = row.dimensionValues[1].value;
        var users = parseInt(row.metricValues[1].value, 10) || 0;
        console.log('[NVR per-button] button="' + buttonName + '" type="' + nvrType + '" users=' + users);
        if (!byButtonNvr[buttonName]) {
          byButtonNvr[buttonName] = { newUsers: 0, returningUsers: 0 };
        }
        if (nvrType === 'new') {
          byButtonNvr[buttonName].newUsers += users;
        } else if (nvrType === 'returning') {
          byButtonNvr[buttonName].returningUsers += users;
        }
      });
    }
    // Attach nvr data to byButton entries
    byButton.forEach(function (b) {
      var nvr = byButtonNvr[b.key] || { newUsers: 0, returningUsers: 0 };
      b.newUsers = nvr.newUsers;
      b.returningUsers = nvr.returningUsers;
    });

    // Deduplicated per-source totals (single-dimension query)
    var bySource = [];
    if (perSourceData && perSourceData.rows) {
      perSourceData.rows.forEach(function (row) {
        var src = row.dimensionValues[0].value;
        bySource.push({
          key: src,
          label: sourceLabel(src),
          eventCount: parseInt(row.metricValues[0].value, 10) || 0,
          totalUsers: parseInt(row.metricValues[1].value, 10) || 0
        });
      });
      bySource.sort(function (a, b) { return b.eventCount - a.eventCount; });
    }

    // Visitor totals (all users, not just button clickers)
    // newUsers from metric, returningUsers from NVR dimension — each sourced independently
    var visitors = { totalUsers: 0, newUsers: 0, returningUsers: 0 };
    if (visitorTotalsData && visitorTotalsData.rows && visitorTotalsData.rows.length > 0) {
      var vt = visitorTotalsData.rows[0].metricValues;
      visitors.totalUsers = parseInt(vt[1].value, 10) || 0;
      visitors.newUsers = parseInt(vt[2].value, 10) || 0;
    }
    if (visitorNvrData && visitorNvrData.rows) {
      visitorNvrData.rows.forEach(function (row) {
        var nvrType = row.dimensionValues[0].value;
        var users = parseInt(row.metricValues[1].value, 10) || 0;
        if (nvrType === 'returning') {
          visitors.returningUsers = users;
        }
      });
    }

    if (!detailData.rows || detailData.rows.length === 0) {
      return { rows: rows, totals: totals, byButton: byButton, bySource: bySource, visitors: visitors };
    }

    detailData.rows.forEach(function (row) {
      var buttonName = row.dimensionValues[0].value;
      var source = row.dimensionValues[1].value;
      var eventCount = parseInt(row.metricValues[0].value, 10) || 0;
      var totalUsers = parseInt(row.metricValues[1].value, 10) || 0;

      rows.push({
        eventName: buttonName,
        label: LABELS[buttonName] || buttonName,
        source: source,
        sourceLabel: sourceLabel(source),
        eventCount: eventCount,
        totalUsers: totalUsers
      });
    });

    return { rows: rows, totals: totals, byButton: byButton, bySource: bySource, visitors: visitors };
  }

  /**
   * Aggregate rows by a key (e.g. 'eventName' or 'source').
   * Returns a Map-like array of { key, label, eventCount, totalUsers }.
   */
  function aggregateBy(rows, keyField, labelField) {
    var map = {};
    rows.forEach(function (r) {
      var k = r[keyField];
      if (!map[k]) {
        map[k] = { key: k, label: r[labelField], eventCount: 0, totalUsers: 0 };
      }
      map[k].eventCount += r.eventCount;
      map[k].totalUsers += r.totalUsers;
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
