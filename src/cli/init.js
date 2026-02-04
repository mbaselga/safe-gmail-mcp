#!/usr/bin/env node

/**
 * Interactive Init Wizard for safe-gmail-mcp
 *
 * Guides users through:
 * 1. GCP OAuth setup instructions
 * 2. OAuth JSON file validation and copying
 * 3. Authentication flow
 * 4. MCP configuration generation
 */

import prompts from 'prompts';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { validateOAuthFile } from '../utils/oauth-validator.js';
import { loadOAuthClient, authenticate } from '../auth/oauth.js';

// Configuration paths
const CONFIG_DIR = path.join(os.homedir(), '.safe-gmail-mcp');
const OAUTH_KEYS_PATH = path.join(CONFIG_DIR, 'gcp-oauth.keys.json');
const CREDENTIALS_PATH = path.join(CONFIG_DIR, 'credentials.json');

/**
 * Prints a nicely formatted box with content
 */
function printBox(title, lines) {
  const maxLength = Math.max(title.length, ...lines.map(l => l.length));
  const width = maxLength + 4;

  console.log();
  console.log('┏' + '━'.repeat(width) + '┓');
  console.log('┃  ' + title.padEnd(maxLength) + '  ┃');
  console.log('┣' + '━'.repeat(width) + '┫');
  for (const line of lines) {
    console.log('┃  ' + line.padEnd(maxLength) + '  ┃');
  }
  console.log('┗' + '━'.repeat(width) + '┛');
  console.log();
}

/**
 * Prints a section header
 */
function printStep(number, title) {
  console.log();
  console.log(`Step ${number}: ${title}`);
  console.log('━'.repeat(title.length + 8));
}

/**
 * Checks the current setup state
 */
function checkSetupState() {
  const hasConfigDir = fs.existsSync(CONFIG_DIR);
  const hasOAuthKeys = fs.existsSync(OAUTH_KEYS_PATH);
  const hasCredentials = fs.existsSync(CREDENTIALS_PATH);

  return { hasConfigDir, hasOAuthKeys, hasCredentials };
}

/**
 * Handles idempotency - checks existing setup and prompts accordingly
 */
async function handleExistingSetup() {
  const { hasOAuthKeys, hasCredentials } = checkSetupState();

  if (hasCredentials) {
    // Fully set up
    const response = await prompts({
      type: 'confirm',
      name: 'rerun',
      message: 'Already set up. Re-run setup?',
      initial: false
    });

    if (!response.rerun) {
      console.log('Setup cancelled.');
      process.exit(0);
    }
    return 'rerun';
  }

  if (hasOAuthKeys) {
    // OAuth configured but not authenticated
    const response = await prompts({
      type: 'confirm',
      name: 'continueAuth',
      message: 'OAuth configured but not authenticated. Continue auth?',
      initial: true
    });

    if (!response.continueAuth) {
      console.log('Setup cancelled.');
      process.exit(0);
    }
    return 'continue-auth';
  }

  return 'fresh';
}

/**
 * Display GCP setup instructions
 */
function displayGCPInstructions() {
  printStep(1, 'Create Google Cloud OAuth Credentials');

  printBox('Google Cloud Console Setup', [
    '1. Go to https://console.cloud.google.com/',
    '2. Create a new project (or select existing)',
    '3. Enable the Gmail API:',
    '   - APIs & Services > Library',
    '   - Search "Gmail API" and enable it',
    '4. Create OAuth credentials:',
    '   - APIs & Services > Credentials',
    '   - Create Credentials > OAuth Client ID',
    '   - Application type: Desktop app',
    '   - Name: safe-gmail-mcp',
    '5. Download the JSON file',
    '',
    'Note: If prompted to configure consent screen:',
    '  - User type: External',
    '  - Add your email as a test user'
  ]);
}

/**
 * Wait for user to press Enter
 */
async function waitForEnter(message = 'Press Enter when ready...') {
  await prompts({
    type: 'text',
    name: 'continue',
    message
  });
}

/**
 * Prompt for OAuth JSON path with validation
 */
async function promptForOAuthPath() {
  printStep(2, 'Locate OAuth JSON File');

  // Find potential default files in Downloads
  const downloadsDir = path.join(os.homedir(), 'Downloads');
  let defaultPath = '';

  if (fs.existsSync(downloadsDir)) {
    const files = fs.readdirSync(downloadsDir);
    const clientSecretFile = files.find(f => f.startsWith('client_secret_') && f.endsWith('.json'));
    if (clientSecretFile) {
      defaultPath = path.join(downloadsDir, clientSecretFile);
    }
  }

  while (true) {
    const response = await prompts({
      type: 'text',
      name: 'oauthPath',
      message: 'Path to OAuth JSON file:',
      initial: defaultPath,
      validate: value => value.length > 0 || 'Please enter a path'
    });

    if (!response.oauthPath) {
      console.log('Setup cancelled.');
      process.exit(1);
    }

    // Expand ~ to home directory
    const expandedPath = response.oauthPath.replace(/^~/, os.homedir());
    const absolutePath = path.resolve(expandedPath);

    // Validate the file
    const validation = validateOAuthFile(absolutePath);

    if (validation.valid) {
      console.log(`\n  Valid OAuth file found (Client ID: ${validation.clientId.substring(0, 20)}...)`);
      return absolutePath;
    }

    console.log(`\n  Error: ${validation.error}`);
    console.log('  Please try again.\n');
  }
}

/**
 * Create config directory and copy OAuth file
 */
function setupConfigDirectory(oauthSourcePath) {
  printStep(3, 'Configure safe-gmail-mcp');

  // Create directory with mode 700 (owner read/write/execute only)
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { mode: 0o700 });
    console.log(`  Created ${CONFIG_DIR}`);
  }

  // Copy OAuth file with mode 600 (owner read/write only)
  fs.copyFileSync(oauthSourcePath, OAUTH_KEYS_PATH);
  fs.chmodSync(OAUTH_KEYS_PATH, 0o600);
  console.log(`  Copied OAuth keys to ${OAUTH_KEYS_PATH}`);
}

/**
 * Run the OAuth authentication flow
 */
async function runAuthFlow() {
  printStep(4, 'Authenticate with Google');

  console.log('  Opening browser for authentication...\n');

  const { client, port } = await loadOAuthClient(OAUTH_KEYS_PATH, CREDENTIALS_PATH);
  await authenticate(client, CREDENTIALS_PATH, port);

  // Set permissions on credentials file
  if (fs.existsSync(CREDENTIALS_PATH)) {
    fs.chmodSync(CREDENTIALS_PATH, 0o600);
  }

  console.log('\n  Authentication successful!');
}

/**
 * Display MCP configuration
 */
function displayMCPConfig() {
  printStep(5, 'Add to Claude Code');

  const projectPath = process.cwd();

  const config = {
    mcpServers: {
      'safe-gmail': {
        command: 'node',
        args: [path.join(projectPath, 'src/index.js')],
        env: {
          GMAIL_OAUTH_PATH: OAUTH_KEYS_PATH,
          GMAIL_CREDENTIALS_PATH: CREDENTIALS_PATH
        }
      }
    }
  };

  console.log('Copy this to your .mcp.json:\n');
  console.log(JSON.stringify(config, null, 2));
  console.log();
}

/**
 * Cleanup partial files on failure
 */
function cleanup() {
  console.log('\n  Cleaning up partial setup...');

  // Remove credentials if it exists but is incomplete
  if (fs.existsSync(CREDENTIALS_PATH)) {
    try {
      const content = fs.readFileSync(CREDENTIALS_PATH, 'utf8');
      JSON.parse(content); // Validate it's proper JSON
    } catch {
      fs.unlinkSync(CREDENTIALS_PATH);
      console.log(`  Removed incomplete ${CREDENTIALS_PATH}`);
    }
  }
}

/**
 * Main wizard entry point
 */
async function main() {
  console.log('\n========================================');
  console.log('  safe-gmail-mcp Setup Wizard');
  console.log('========================================\n');

  try {
    // Check for existing setup
    const setupState = await handleExistingSetup();

    if (setupState === 'fresh' || setupState === 'rerun') {
      // Full setup flow
      displayGCPInstructions();
      await waitForEnter('Press Enter when you have downloaded the OAuth JSON file...');

      const oauthPath = await promptForOAuthPath();
      setupConfigDirectory(oauthPath);
    }

    // Run auth flow (for fresh, rerun, and continue-auth states)
    await runAuthFlow();

    // Show MCP config
    displayMCPConfig();

    console.log('Done! Your safe-gmail-mcp is ready to use.\n');

  } catch (error) {
    console.error(`\n  Error: ${error.message}`);
    cleanup();
    process.exit(1);
  }
}

// Run the wizard
main();
