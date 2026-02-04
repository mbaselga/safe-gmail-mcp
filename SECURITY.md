# Security Design

This is a **security-hardened fork** of `@gongrzhe/server-gmail-autoauth-mcp`.

## What Was Removed

| Operation | Reason |
|-----------|--------|
| `send_email` | Prevents unauthorized email sending/impersonation |
| `delete_email` | Prevents permanent data loss |
| `batch_delete_emails` | Prevents bulk data destruction |
| `create_filter` | Prevents automated email manipulation (auto-forward/delete) |
| `list_filters` | Not needed without create capability |
| `get_filter` | Not needed without create capability |
| `delete_filter` | Not needed without create capability |
| `create_filter_from_template` | Same risks as create_filter |

## OAuth Scope Reduction

| Original | This Fork |
|----------|-----------|
| `gmail.modify` | `gmail.modify` (kept - required for label changes) |
| `gmail.settings.basic` | **Removed** (was used for filter operations) |

## Defense in Depth

### Layer 1: OAuth Scopes
- Only `gmail.modify` scope requested
- No `gmail.send` scope
- No `gmail.settings.basic` scope

### Layer 2: Code-Level Blocks
- `send_email` function does not exist
- `delete_email` function does not exist
- All filter functions do not exist
- `handleEmailAction` only supports draft creation

### Layer 3: Credential Isolation
- Credentials stored in `~/.safe-gmail-mcp/` (separate from original)
- No conflict with other Gmail MCP installations

## What This MCP CAN Do

| Operation | Description |
|-----------|-------------|
| Read emails | Full email content retrieval |
| Search emails | Gmail search syntax |
| List labels | View all labels |
| Create labels | Organize emails |
| Update labels | Rename/modify labels |
| Delete labels | Remove user-created labels |
| Apply labels | Add/remove labels from emails |
| Archive emails | Remove INBOX label (reversible) |
| Batch modify | Bulk label operations |
| Create drafts | Draft emails for manual review |
| Download attachments | Save attachments locally |

## What This MCP CANNOT Do

- Send emails
- Delete emails
- Create email filters
- Auto-forward emails
- Access Gmail settings

## Revoking Access

If you want to revoke this MCP's access to your Gmail:

1. Go to https://myaccount.google.com/permissions
2. Find "Safe Gmail MCP" (or your OAuth app name)
3. Click "Remove Access"

## Credential Storage

Credentials are stored at:
- OAuth keys: `~/.safe-gmail-mcp/gcp-oauth.keys.json`
- Access tokens: `~/.safe-gmail-mcp/credentials.json`

To completely remove credentials:
```bash
rm -rf ~/.safe-gmail-mcp
```
