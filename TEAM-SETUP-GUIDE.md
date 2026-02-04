# Safe Gmail MCP Setup Guide

This tool lets Claude Code read, search, label, and draft emails in your Gmail account.

## Prerequisites

- **Node.js 18+**: Download from https://nodejs.org (choose "LTS" version)
- **A Google account** with Gmail

## Step 1: Download the Code

Open your terminal:
- **Mac**: Press `Cmd + Space`, type "Terminal", press Enter
- **Windows**: Press `Win + R`, type "cmd", press Enter

Run these commands one at a time:

```bash
# Go to your home folder
cd ~

# Download the project
git clone https://github.com/mbaselga/safe-gmail-mcp.git

# Go into the project folder
cd safe-gmail-mcp

# Install dependencies
npm install
```

## Step 2: Run the Setup Wizard

```bash
npm run init
```

The wizard will guide you through:

1. **Creating Google Cloud credentials** (takes ~5 minutes, one-time setup)
   - Go to https://console.cloud.google.com/
   - Create a project called "Safe Gmail MCP"
   - Enable the Gmail API
   - Create OAuth credentials (Desktop app)
   - Download the JSON file

2. **Authenticating** - A browser window will open asking you to sign into Google

3. **Configuring Claude Code** - The wizard will show you exactly what to copy into your `.mcp.json` file

## Step 3: Add to Claude Code

The wizard will output something like this at the end:

```json
{
  "mcpServers": {
    "safe-gmail": {
      "command": "node",
      "args": ["/Users/yourname/safe-gmail-mcp/src/index.js"],
      "env": {
        "GMAIL_OAUTH_PATH": "/Users/yourname/.safe-gmail-mcp/gcp-oauth.keys.json",
        "GMAIL_CREDENTIALS_PATH": "/Users/yourname/.safe-gmail-mcp/credentials.json"
      }
    }
  }
}
```

Add this to your Claude Code MCP configuration:
- **VS Code**: Settings → Extensions → Claude Code → MCP Servers
- **CLI**: Add to `~/.claude/mcp.json` or your project's `.mcp.json`

## Step 4: Restart Claude Code

Restart Claude Code (or reload the window in VS Code) to pick up the new MCP server.

## Verify It's Working

Ask Claude: "Search my Gmail for emails from the last week"

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `git: command not found` | Install Git: https://git-scm.com/downloads |
| `node: command not found` | Install Node.js: https://nodejs.org |
| "Gmail API has not been used" | Go back to Google Cloud Console → APIs & Services → Library → Search "Gmail API" → Enable |
| "Access denied" error | In Google Cloud Console → OAuth consent screen → Test users → Add your email |
| Token expired | Run `npm run auth` in the safe-gmail-mcp folder |

---

## What This Tool Can Do

- ✅ Read and search emails
- ✅ Create labels and organize emails
- ✅ Archive emails
- ✅ Create draft emails (you send manually)
- ✅ Download attachments

## What This Tool Cannot Do (by design)

- ❌ Send emails to others
- ❌ Delete emails
- ❌ Create auto-forwarding rules

---

Questions? Ask Marc or check https://github.com/mbaselga/safe-gmail-mcp
