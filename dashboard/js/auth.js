/**
 * Google OAuth via Google Identity Services (GIS).
 * Uses the token model (implicit grant) for client-side access.
 */
var Auth = (function () {
  var _tokenClient = null;
  var _accessToken = null;
  var _onSignIn = null;
  var _onSignOut = null;
  var _userEmail = null;

  /** Scopes needed: GA read-only + Sheets (for export). */
  var SCOPES = [
    'https://www.googleapis.com/auth/analytics.readonly',
    'https://www.googleapis.com/auth/spreadsheets'
  ].join(' ');

  function waitForGIS() {
    return new Promise(function (resolve) {
      if (typeof google !== 'undefined' && google.accounts && google.accounts.oauth2 && google.accounts.oauth2.initTokenModel) {
        resolve();
        return;
      }
      var interval = setInterval(function () {
        if (typeof google !== 'undefined' && google.accounts && google.accounts.oauth2 && google.accounts.oauth2.initTokenModel) {
          clearInterval(interval);
          resolve();
        }
      }, 100);
    });
  }

  async function init(clientId, onSignIn, onSignOut) {
    _onSignIn = onSignIn;
    _onSignOut = onSignOut;

    await waitForGIS();

    _tokenClient = google.accounts.oauth2.initTokenModel({
      client_id: clientId,
      scope: SCOPES,
      callback: handleTokenResponse
    });

    document.getElementById('btn-signin').disabled = false;
    document.getElementById('btn-signin').addEventListener('click', requestToken);
    document.getElementById('btn-signout').addEventListener('click', signOut);
  }

  function requestToken() {
    _tokenClient.requestAccessToken();
  }

  function handleTokenResponse(resp) {
    if (resp.error) {
      console.error('OAuth error:', resp);
      return;
    }
    _accessToken = resp.access_token;

    // Fetch user info for display
    fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: 'Bearer ' + _accessToken }
    })
      .then(function (r) { return r.json(); })
      .then(function (info) {
        _userEmail = info.email || '';
        if (_onSignIn) _onSignIn(_accessToken, _userEmail);
      })
      .catch(function () {
        if (_onSignIn) _onSignIn(_accessToken, '');
      });
  }

  function signOut() {
    if (_accessToken) {
      google.accounts.oauth2.revoke(_accessToken);
    }
    _accessToken = null;
    _userEmail = null;
    if (_onSignOut) _onSignOut();
  }

  function getToken() { return _accessToken; }

  return { init: init, getToken: getToken, requestToken: requestToken };
})();
