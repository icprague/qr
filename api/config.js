/**
 * Vercel serverless function that exposes environment variables to the client.
 * These values are not secret (they're visible in the browser anyway for OAuth),
 * but this keeps them out of the repo.
 */
export default function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.status(200).json({
    GA_PROPERTY_ID: process.env.GA_PROPERTY_ID || '',
    OAUTH_CLIENT_ID: process.env.OAUTH_CLIENT_ID || ''
  });
}
