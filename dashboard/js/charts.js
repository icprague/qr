/**
 * Chart.js rendering for the dashboard.
 */
var Charts = (function () {
  var COLORS = [
    '#222a58', '#4d6fff', '#36b37e', '#ff9f43',
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

  /** Horizontal bar chart of event counts per button. */
  function renderButtonsChart(byEvent) {
    destroy('chart-buttons');
    var ctx = document.getElementById('chart-buttons').getContext('2d');
    _charts['chart-buttons'] = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: byEvent.map(function (e) { return e.label; }),
        datasets: [{
          label: 'Clicks',
          data: byEvent.map(function (e) { return e.eventCount; }),
          backgroundColor: COLORS.slice(0, byEvent.length),
          borderRadius: 4,
          maxBarThickness: 48
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: function (c) { return c.parsed.x + ' clicks'; } } }
        },
        scales: {
          x: { beginAtZero: true, ticks: { precision: 0 }, grid: { display: false } },
          y: { grid: { display: false } }
        }
      }
    });
  }

  /** Grouped bar chart: totalUsers & newUsers per button. */
  function renderUsersChart(byEvent) {
    destroy('chart-users');
    var ctx = document.getElementById('chart-users').getContext('2d');
    _charts['chart-users'] = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: byEvent.map(function (e) { return e.label; }),
        datasets: [
          {
            label: 'Total Users',
            data: byEvent.map(function (e) { return e.totalUsers; }),
            backgroundColor: '#222a58',
            borderRadius: 4,
            maxBarThickness: 36
          },
          {
            label: 'New Users',
            data: byEvent.map(function (e) { return e.newUsers; }),
            backgroundColor: '#4d6fff',
            borderRadius: 4,
            maxBarThickness: 36
          }
        ]
      },
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

  /** Doughnut chart of traffic by source. */
  function renderSourcesChart(bySource) {
    destroy('chart-sources');
    var ctx = document.getElementById('chart-sources').getContext('2d');
    _charts['chart-sources'] = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: bySource.map(function (s) { return s.label; }),
        datasets: [{
          data: bySource.map(function (s) { return s.eventCount; }),
          backgroundColor: COLORS.slice(0, bySource.length),
          borderWidth: 0
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'right',
            labels: { boxWidth: 12, font: { size: 12 }, padding: 12 }
          }
        },
        cutout: '55%'
      }
    });
  }

  /**
   * Grouped bar chart comparing event counts across multiple Sundays.
   * datasets: one per Sunday date, groups: event labels.
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

  return {
    renderButtonsChart: renderButtonsChart,
    renderUsersChart: renderUsersChart,
    renderSourcesChart: renderSourcesChart,
    renderComparisonChart: renderComparisonChart,
    destroyAll: destroyAll
  };
})();
