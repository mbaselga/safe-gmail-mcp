#!/usr/bin/env node

/**
 * Status CLI for safe-gmail-mcp
 *
 * Displays current authentication status and configuration.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { google } from 'googleapis';
import { loadOAuthClient, refreshIfNeeded } from '../auth/oauth.js';

// Configuration paths
const CONFIG_DIR = path.join(os.homedir(), '.safe-gmail-mcp');
const OAUTH_KEYS_PATH = path.join(CONFIG_DIR, 'gcp-oauth.keys.json');
const CREDENTIALS_PATH = path.join(CONFIG_DIR, 'credentials.json');

/**
 * Format a timestamp as a human-readable date
 */
function formatDate(timestamp) {
  if (!timestamp) return 'Unknown';
  return new Date(timestamp).toLocaleString();
}

/**
 * Main status check
 */
async function main() {
  console.log('\n=== safe-gmail-mcp Status ===\n');

  // Check config directory
  if (!fs.existsSync(CONFIG_DIR)) {
    console.log('Status: Not configured');
    console.log('\nRun "npm run init" to set up safe-gmail-mcp.\n');
    process.exit(1);
  }

  // Check OAuth keys
  if (!fs.existsSync(OAUTH_KEYS_PATH)) {
    console.log('Status: OAuth keys missing');
    console.log(`Expected at: ${OAUTH_KEYS_PATH}`);
    console.log('\nRun "npm run init" to set up safe-gmail-mcp.\n');
    process.exit(1);
  }

  console.log('OAuth Keys: Found');
  console.log(`  Path: ${OAUTH_KEYS_PATH}`);

  // Check credentials
  if (!fs.existsSync(CREDENTIALS_PATH)) {
    console.log('\nCredentials: Not authenticated');
    console.log('\nRun "npm run auth" to authenticate.\n');
    process.exit(1);
  }

  // Parse credentials
  let credentials;
  try {
    credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
  } catch (error) {
    console.log('\nCredentials: Invalid (corrupted file)');
    console.log('\nRun "npm run auth" to re-authenticate.\n');
    process.exit(1);
  }

  console.log('\nCredentials: Found');
  console.log(`  Path: ${CREDENTIALS_PATH}`);
  console.log(`  Token expiry: ${formatDate(credentials.expiry_date)}`);

  // Check if token is expired
  const now = Date.now();
  if (credentials.expiry_date && now >= credentials.expiry_date) {
    console.log('  Status: Expired');
    if (credentials.refresh_token) {
      console.log('  Refresh token: Available (will auto-refresh)');
    } else {
      console.log('  Refresh token: Missing (re-auth required)');
      console.log('\nRun "npm run auth" to re-authenticate.\n');
      process.exit(1);
    }
  } else {
    console.log('  Status: Valid');
  }

  // Try to get the authenticated email
  try {
    const { client } = await loadOAuthClient(OAUTH_KEYS_PATH, CREDENTIALS_PATH);

    // Refresh token if needed
    await refreshIfNeeded(client, CREDENTIALS_PATH);

    // Get user profile
    const gmail = google.gmail({ version: 'v1', auth: client });
    const profile = await gmail.users.getProfile({ userId: 'me' });

    console.log('\nAuthenticated Account:');
    console.log(`  Email: ${profile.data.emailAddress}`);
    console.log(`  Messages: ${profile.data.messagesTotal}`);
    console.log(`  Threads: ${profile.data.threadsTotal}`);

    console.log('\nStatus: Ready\n');

  } catch (error) {
    console.log('\nAPI Test: Failed');
    console.log(`  Error: ${error.message}`);

    // Check for common errors
    if (error.message.includes('invalid_grant')) {
      console.log('\n  Your token has been revoked. Run "npm run auth" to re-authenticate.\n');
    } else if (error.message.includes('Gmail API has not been used')) {
      console.log('\n  Enable Gmail API: APIs & Services > Library > Gmail API > Enable\n');
    } else if (error.message.includes('access_denied')) {
      console.log('\n  Add your email as a test user in the OAuth consent screen.\n');
    } else {
      console.log('\n  Run "npm run auth" to re-authenticate.\n');
    }

    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Error:', error.message);
  process.exit(1);
});
