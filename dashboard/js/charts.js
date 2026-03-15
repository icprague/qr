/**
 * Chart.js rendering for the dashboard.
 */
var Charts = (function () {
  var PURPLE = '#7c6cbc';
  var PURPLE_LIGHT = '#b8aed8';
  var COLORS = [
    '#7c6cbc', '#4d6fff', '#36b37e', '#ff9f43',
    '#eb4d4b', '#8854d0', '#20bf6b', '#778ca3'
  ];

  var _charts = {};

  function destroy(id) {
    if (_charts[id]) {
      _charts[id].destroy();
      delete _charts[id];
    }
  }

  function destroyAll() {
    Object.keys(_charts).forEach(destroy);
  }

  /**
   * Vertical bar chart: users per button.
   * showNew = false → single "Total users" bar
   * showNew = true  → grouped "Total users" + "New users"
   */
  function renderUsersChart(byEvent, showNew) {
    destroy('chart-users');
    var ctx = document.getElementById('chart-users').getContext('2d');

    var datasets = [{
      label: 'Total users',
      data: byEvent.map(function (e) { return e.totalUsers; }),
      backgroundColor: PURPLE,
      borderRadius: 4,
      maxBarThickness: showNew ? 36 : 48
    }];

    if (showNew) {
      datasets.push({
        label: 'New users',
        data: byEvent.map(function (e) { return e.newUsers; }),
        backgroundColor: PURPLE_LIGHT,
        borderRadius: 4,
        maxBarThickness: 36
      });
    }

    _charts['chart-users'] = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: byEvent.map(function (e) { return e.label; }),
        datasets: datasets
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: true,
            position: 'top',
            align: 'start',
            labels: { boxWidth: 12, font: { size: 12 }, padding: 16 }
          },
          datalabels: false
        },
        scales: {
          x: { grid: { display: false } },
          y: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: '#f0f0f5' } }
        }
      },
      plugins: [barValuePlugin]
    });
  }

  /**
   * Sources chart.
   * bySourceOnly = true  → horizontal bar of users per source
   * bySourceOnly = false → grouped bar: each source has bars per button
   */
  function renderSourcesChart(bySource, rows, bySourceOnly) {
    destroy('chart-sources');
    var ctx = document.getElementById('chart-sources').getContext('2d');

    if (bySourceOnly) {
      // Simple horizontal bar: users per source
      _charts['chart-sources'] = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: bySource.map(function (s) { return s.label; }),
          datasets: [{
            label: 'Users',
            data: bySource.map(function (s) { return s.totalUsers; }),
            backgroundColor: COLORS.slice(0, bySource.length),
            borderRadius: 4,
            maxBarThickness: 40
          }]
        },
        options: {
          indexAxis: 'y',
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false }
          },
          scales: {
            x: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: '#f0f0f5' } },
            y: { grid: { display: false } }
          }
        }
      });
    } else {
      // Grouped bar: source × button
      var sourceMap = buildSourceButtonMap(rows);
      var sourceLabels = bySource.map(function (s) { return s.label; });
      var sourceKeys = bySource.map(function (s) { return s.key; });

      // One dataset per button
      var buttonNames = GA.EVENT_NAMES.filter(function (n) {
        return sourceKeys.some(function (sk) { return sourceMap[sk] && sourceMap[sk][n]; });
      });

      var datasets = buttonNames.map(function (name, i) {
        return {
          label: GA.LABELS[name] || name,
          data: sourceKeys.map(function (sk) {
            return sourceMap[sk] && sourceMap[sk][name] ? sourceMap[sk][name].eventCount : 0;
          }),
          backgroundColor: COLORS[i % COLORS.length],
          borderRadius: 4,
          maxBarThickness: 28
        };
      });

      _charts['chart-sources'] = new Chart(ctx, {
        type: 'bar',
        data: { labels: sourceLabels, datasets: datasets },
        options: {
          indexAxis: 'y',
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: 'top',
              align: 'start',
              labels: { boxWidth: 12, font: { size: 11 }, padding: 12 }
            }
          },
          scales: {
            x: { beginAtZero: true, stacked: true, ticks: { precision: 0 }, grid: { color: '#f0f0f5' } },
            y: { stacked: true, grid: { display: false } }
          }
        }
      });
    }
  }

  /** Build { sourceKey: { buttonName: { eventCount, ... } } } from raw rows. */
  function buildSourceButtonMap(rows) {
    var map = {};
    rows.forEach(function (r) {
      var sk = r.source;
      if (!map[sk]) map[sk] = {};
      if (!map[sk][r.eventName]) {
        map[sk][r.eventName] = { eventCount: 0, totalUsers: 0, newUsers: 0 };
      }
      map[sk][r.eventName].eventCount += r.eventCount;
      map[sk][r.eventName].totalUsers += r.totalUsers;
      map[sk][r.eventName].newUsers += r.newUsers;
    });
    return map;
  }

  /**
   * Grouped bar chart comparing event counts across multiple Sundays.
   */
  function renderComparisonChart(eventNames, dataPerDate) {
    destroy('chart-comparison');
    var ctx = document.getElementById('chart-comparison').getContext('2d');

    var labels = eventNames.map(function (n) { return GA.LABELS[n] || n; });
    var dates = Object.keys(dataPerDate).sort();
    var datasets = dates.map(function (dateStr, i) {
      var byEvent = dataPerDate[dateStr];
      return {
        label: Dates.shortLabel(dateStr),
        data: eventNames.map(function (n) { return byEvent[n] ? byEvent[n].eventCount : 0; }),
        backgroundColor: COLORS[i % COLORS.length],
        borderRadius: 4,
        maxBarThickness: 32
      };
    });

    _charts['chart-comparison'] = new Chart(ctx, {
      type: 'bar',
      data: { labels: labels, datasets: datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'top', labels: { boxWidth: 12, font: { size: 12 } } }
        },
        scales: {
          x: { grid: { display: false } },
          y: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: '#f0f0f5' } }
        }
      }
    });
  }

  /** Plugin that draws the value above each bar. */
  var barValuePlugin = {
    id: 'barValues',
    afterDatasetsDraw: function (chart) {
      var ctx = chart.ctx;
      chart.data.datasets.forEach(function (dataset, di) {
        var meta = chart.getDatasetMeta(di);
        meta.data.forEach(function (bar, index) {
          var val = dataset.data[index];
          if (val === 0) return;
          ctx.save();
          ctx.fillStyle = '#666';
          ctx.font = '500 12px Inter, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'bottom';
          ctx.fillText(val, bar.x, bar.y - 4);
          ctx.restore();
        });
      });
    }
  };

  return {
    renderUsersChart: renderUsersChart,
    renderSourcesChart: renderSourcesChart,
    renderComparisonChart: renderComparisonChart,
    destroyAll: destroyAll
  };
})();
