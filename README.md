# Safe Gmail MCP

A **security-hardened** Gmail MCP server for Claude Code. Supports reading, labeling, archiving, and drafting emails - but **cannot send or delete**.

## Quick Start

```bash
git clone <this-repo>
cd safe-gmail-mcp
npm install
npm run init
```

The setup wizard will guide you through:
1. Creating Google Cloud OAuth credentials
2. Authenticating with your Gmail account
3. Configuring Claude Code

## Why This Exists

The original Gmail MCP has powerful capabilities that could be dangerous if misused:
- Send emails (impersonation risk)
- Delete emails (data loss)
- Create filters (auto-forward/delete)

This fork removes those dangerous operations while keeping everything needed for email triage workflows.

## What You Can Do

| Tool | Description |
|------|-------------|
| `draft_email` | Create a draft email (you send manually) |
| `send_email` | Send email to yourself only (for reminders) |
| `read_email` | Read email content by ID |
| `search_emails` | Search with Gmail syntax |
| `list_email_labels` | List all labels |
| `create_label` | Create a new label |
| `update_label` | Update a label |
| `delete_label` | Delete a user-created label |
| `get_or_create_label` | Get existing or create new label |
| `modify_email` | Add/remove labels from an email |
| `batch_modify_emails` | Bulk label modifications |
| `download_attachment` | Save attachment to disk |

## What You CANNOT Do

- Send emails to others (only drafts)
- Delete emails
- Create filters

## Commands

| Command | Description |
|---------|-------------|
| `npm run init` | Interactive setup wizard |
| `npm run auth` | Re-authenticate (if token expires) |
| `npm run status` | Check authentication status |
| `npm start` | Run the MCP server |

## Manual Setup

If you prefer not to use the wizard:

### 1. Create Google Cloud OAuth Credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project
3. Enable the Gmail API: APIs & Services > Library > Gmail API > Enable
4. Configure OAuth consent screen:
   - User type: External
   - Add your email as a test user
5. Create credentials: Credentials > Create > OAuth Client ID > Desktop app
6. Download the JSON file

### 2. Set Up Credentials

```bash
mkdir -p ~/.safe-gmail-mcp
chmod 700 ~/.safe-gmail-mcp
mv ~/Downloads/client_secret_*.json ~/.safe-gmail-mcp/gcp-oauth.keys.json
chmod 600 ~/.safe-gmail-mcp/gcp-oauth.keys.json
```

### 3. Authenticate

```bash
npm run auth
```

### 4. Configure Claude Code

Add to your `.mcp.json`:

```json
{
  "mcpServers": {
    "safe-gmail": {
      "command": "node",
      "args": ["/path/to/safe-gmail-mcp/src/index.js"],
      "env": {
        "GMAIL_OAUTH_PATH": "/Users/you/.safe-gmail-mcp/gcp-oauth.keys.json",
        "GMAIL_CREDENTIALS_PATH": "/Users/you/.safe-gmail-mcp/credentials.json"
      }
    }
  }
}
```

## Troubleshooting

### "Gmail API has not been used"
Enable Gmail API: APIs & Services > Library > Gmail API > Enable

### "Access denied" or 403 error
Add your email as a test user in the OAuth consent screen.

### Token expired
Run `npm run auth` to re-authenticate.

### Port already in use
The auth flow tries ports 3000, 3001, 3002. Close any apps using these ports.

## Security

See [SECURITY.md](./SECURITY.md) for detailed security design documentation.

## License

ISC (inherited from original project)

## Credits

Fork of [@gongrzhe/server-gmail-autoauth-mcp](https://github.com/gongrzhe/server-gmail-autoauth-mcp)
