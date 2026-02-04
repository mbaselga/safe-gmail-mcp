import { existsSync, readFileSync } from 'fs';

/**
 * Validates an OAuth JSON file and provides specific error messages for common mistakes.
 * @param {string} filePath - Path to the OAuth JSON file
 * @returns {{ valid: true, clientId: string } | { valid: false, error: string }}
 */
export function validateOAuthFile(filePath) {
  // 1. File exists
  if (!existsSync(filePath)) {
    return { valid: false, error: `File not found: ${filePath}` };
  }

  // 2. Valid JSON
  let data;
  try {
    const content = readFileSync(filePath, 'utf-8');
    data = JSON.parse(content);
  } catch {
    return { valid: false, error: 'Invalid JSON file - check file is complete' };
  }

  // 3. NOT a service account
  if (data.type === 'service_account') {
    return { valid: false, error: 'This is a service account. Create OAuth Client ID > Desktop app instead.' };
  }

  // 4. NOT web app OAuth
  if ('web' in data) {
    return { valid: false, error: 'This is a Web app OAuth. Create Desktop app instead.' };
  }

  // 5. Has "installed" key
  if (!('installed' in data)) {
    return { valid: false, error: 'Invalid OAuth file format - expected Desktop app credentials' };
  }

  const keys = data.installed;

  // 6. Has client_id field
  if (!keys.client_id) {
    return { valid: false, error: 'Invalid OAuth file - missing client_id' };
  }

  // 7. client_id ends with .apps.googleusercontent.com
  if (!keys.client_id.endsWith('.apps.googleusercontent.com')) {
    return { valid: false, error: 'Invalid client_id format' };
  }

  // 8. Has client_secret field
  if (!keys.client_secret) {
    return { valid: false, error: 'Invalid OAuth file - missing client_secret' };
  }

  // 9. Has redirect_uris field
  if (!keys.redirect_uris) {
    return { valid: false, error: 'Invalid OAuth file - missing redirect_uris' };
  }

  // Success
  return { valid: true, clientId: keys.client_id };
}
