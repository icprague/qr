/**
 * Loads configuration from the Vercel serverless endpoint.
 * Env vars are injected server-side and never committed to the repo.
 */
var AppConfig = (function () {
  var _config = null;

  async function load() {
    if (_config) return _config;
    var resp = await fetch('/api/config');
    if (!resp.ok) throw new Error('Failed to load config');
    _config = await resp.json();
    return _config;
  }

  return { load: load };
})();
