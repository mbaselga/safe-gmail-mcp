/**
 * OAuth Authentication Module
 *
 * Reusable authentication logic for Gmail OAuth2.
 * Handles loading credentials, browser OAuth flow, and token refresh.
 */

import { OAuth2Client } from 'google-auth-library';
import http from 'http';
import fs from 'fs';
import open from 'open';

// Ports to try for OAuth callback server
const OAUTH_PORTS = [3000, 3001, 3002];

// Timeout for OAuth callback (5 minutes)
const OAUTH_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Loads OAuth client from credential files.
 *
 * @param {string} oauthPath - Path to gcp-oauth.keys.json file
 * @param {string} credentialsPath - Path to stored user credentials/tokens
 * @returns {Promise<{client: OAuth2Client, port: number}>} Configured OAuth2Client and the port to use
 * @throws {Error} If OAuth keys file is missing or invalid
 */
export async function loadOAuthClient(oauthPath, credentialsPath) {
    // Validate OAuth keys file exists
    if (!fs.existsSync(oauthPath)) {
        throw new Error(`OAuth keys file not found at: ${oauthPath}`);
    }

    // Parse and validate OAuth keys
    const keysContent = JSON.parse(fs.readFileSync(oauthPath, 'utf8'));
    const keys = keysContent.installed || keysContent.web;

    if (!keys) {
        throw new Error('Invalid OAuth keys file format. File should contain either "installed" or "web" credentials.');
    }

    // Find an available port
    const port = await findAvailablePort();
    const callbackUrl = `http://localhost:${port}/oauth2callback`;

    // Create OAuth2 client
    const oauth2Client = new OAuth2Client(
        keys.client_id,
        keys.client_secret,
        callbackUrl
    );

    // Load existing credentials if available
    if (fs.existsSync(credentialsPath)) {
        try {
            const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
            oauth2Client.setCredentials(credentials);
        } catch (error) {
            // Credentials file exists but is invalid - will need to re-authenticate
            console.warn('Warning: Could not parse existing credentials, re-authentication required.');
        }
    }

    return { client: oauth2Client, port };
}

/**
 * Runs the browser OAuth flow and saves tokens.
 *
 * @param {OAuth2Client} oauth2Client - The OAuth2 client to authenticate
 * @param {string} credentialsPath - Path to save the credentials/tokens
 * @param {number} [port=3000] - Port for the OAuth callback server
 * @returns {Promise<void>}
 * @throws {Error} If authentication fails, times out, or is cancelled
 */
export async function authenticate(oauth2Client, credentialsPath, port = 3000) {
    const server = http.createServer();

    // Try to start server on the specified port
    await new Promise((resolve, reject) => {
        server.on('error', (err) => {
            if (err.code === 'EADDRINUSE') {
                reject(new Error(`Port ${port} is already in use. Try a different port.`));
            } else {
                reject(err);
            }
        });
        server.listen(port, () => resolve());
    });

    return new Promise((resolve, reject) => {
        let timeoutId;
        let isResolved = false;

        // Helper to cleanup and resolve/reject only once
        const cleanup = (error, success) => {
            if (isResolved) return;
            isResolved = true;

            clearTimeout(timeoutId);
            server.close();

            if (error) {
                reject(error);
            } else {
                resolve();
            }
        };

        // Set up timeout
        timeoutId = setTimeout(() => {
            cleanup(new Error('OAuth authentication timed out after 5 minutes. Please try again.'));
        }, OAUTH_TIMEOUT_MS);

        // Generate and open auth URL
        const authUrl = oauth2Client.generateAuthUrl({
            access_type: 'offline',
            scope: ['https://www.googleapis.com/auth/gmail.modify'],
            prompt: 'consent' // Force consent screen to always get refresh token
        });

        console.log('\nPlease visit this URL to authenticate:');
        console.log(authUrl);
        console.log('\nWaiting for authentication (will timeout in 5 minutes)...\n');

        open(authUrl).catch(() => {
            console.log('Could not open browser automatically. Please copy the URL above and paste it in your browser.');
        });

        // Handle OAuth callback
        server.on('request', async (req, res) => {
            // Only process OAuth callback requests
            if (!req.url?.startsWith('/oauth2callback')) {
                res.writeHead(404);
                res.end('Not found');
                return;
            }

            const url = new URL(req.url, `http://localhost:${port}`);

            // Check for user cancellation/error
            const error = url.searchParams.get('error');
            if (error) {
                res.writeHead(400);
                res.end(`Authentication was cancelled or failed: ${error}`);
                cleanup(new Error(`Authentication cancelled: ${error}`));
                return;
            }

            const code = url.searchParams.get('code');
            if (!code) {
                res.writeHead(400);
                res.end('No authorization code provided');
                cleanup(new Error('No authorization code provided in callback'));
                return;
            }

            try {
                // Exchange code for tokens
                const { tokens } = await oauth2Client.getToken(code);
                oauth2Client.setCredentials(tokens);

                // Save tokens to file
                const dir = credentialsPath.substring(0, credentialsPath.lastIndexOf('/'));
                if (dir && !fs.existsSync(dir)) {
                    fs.mkdirSync(dir, { recursive: true });
                }
                fs.writeFileSync(credentialsPath, JSON.stringify(tokens, null, 2));

                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end(`
                    <html>
                        <body style="font-family: sans-serif; text-align: center; padding-top: 50px;">
                            <h1>Authentication Successful!</h1>
                            <p>You can close this window and return to the terminal.</p>
                        </body>
                    </html>
                `);

                cleanup(null, true);
            } catch (err) {
                res.writeHead(500);
                res.end('Authentication failed: ' + err.message);
                cleanup(new Error('Failed to exchange authorization code: ' + err.message));
            }
        });

        // Handle server errors
        server.on('error', (err) => {
            cleanup(err);
        });
    });
}

/**
 * Checks token expiry and refreshes if needed.
 *
 * @param {OAuth2Client} oauth2Client - The OAuth2 client to check/refresh
 * @param {string} credentialsPath - Path to save refreshed credentials
 * @returns {Promise<boolean>} True if tokens were refreshed, false if no refresh needed
 * @throws {Error} If refresh fails and re-authentication is required
 */
export async function refreshIfNeeded(oauth2Client, credentialsPath) {
    const credentials = oauth2Client.credentials;

    // Check if we have tokens
    if (!credentials || !credentials.access_token) {
        throw new Error('No credentials loaded. Authentication required.');
    }

    // Check if token is expired or will expire in the next 5 minutes
    const expiryBuffer = 5 * 60 * 1000; // 5 minutes
    const expiryDate = credentials.expiry_date;

    if (!expiryDate || Date.now() >= expiryDate - expiryBuffer) {
        // Token is expired or expiring soon
        if (!credentials.refresh_token) {
            throw new Error('Token expired and no refresh token available. Re-authentication required.');
        }

        try {
            // Refresh the token
            const { credentials: newCredentials } = await oauth2Client.refreshAccessToken();
            oauth2Client.setCredentials(newCredentials);

            // Save refreshed tokens
            fs.writeFileSync(credentialsPath, JSON.stringify(newCredentials, null, 2));

            return true;
        } catch (err) {
            throw new Error('Failed to refresh token: ' + err.message + '. Re-authentication may be required.');
        }
    }

    return false;
}

/**
 * Finds an available port from the predefined list.
 *
 * @returns {Promise<number>} An available port
 * @throws {Error} If no ports are available
 */
async function findAvailablePort() {
    for (const port of OAUTH_PORTS) {
        if (await isPortAvailable(port)) {
            return port;
        }
    }
    throw new Error(`No available ports found. Tried: ${OAUTH_PORTS.join(', ')}`);
}

/**
 * Checks if a port is available.
 *
 * @param {number} port - Port to check
 * @returns {Promise<boolean>} True if port is available
 */
function isPortAvailable(port) {
    return new Promise((resolve) => {
        const server = http.createServer();
        server.once('error', () => resolve(false));
        server.once('listening', () => {
            server.close();
            resolve(true);
        });
        server.listen(port);
    });
}

export default {
    loadOAuthClient,
    authenticate,
    refreshIfNeeded
};
