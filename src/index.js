#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, } from "@modelcontextprotocol/sdk/types.js";
import { google } from 'googleapis';
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import fs from 'fs';
import path from 'path';
import os from 'os';
import { createEmailMessage, createEmailWithNodemailer } from "./utl.js";
import { createLabel, updateLabel, deleteLabel, listLabels, getOrCreateLabel } from "./label-manager.js";
import { loadOAuthClient, authenticate, refreshIfNeeded } from "./auth/oauth.js";

// Configuration paths
const CONFIG_DIR = path.join(os.homedir(), '.safe-gmail-mcp');
const OAUTH_PATH = process.env.GMAIL_OAUTH_PATH || path.join(CONFIG_DIR, 'gcp-oauth.keys.json');
const CREDENTIALS_PATH = process.env.GMAIL_CREDENTIALS_PATH || path.join(CONFIG_DIR, 'credentials.json');

// OAuth2 client (set during initialization)
let oauth2Client;

/**
 * Recursively extract email body content from MIME message parts
 * Handles complex email structures with nested parts
 */
function extractEmailContent(messagePart) {
    // Initialize containers for different content types
    let textContent = '';
    let htmlContent = '';
    // If the part has a body with data, process it based on MIME type
    if (messagePart.body && messagePart.body.data) {
        const content = Buffer.from(messagePart.body.data, 'base64').toString('utf8');
        // Store content based on its MIME type
        if (messagePart.mimeType === 'text/plain') {
            textContent = content;
        }
        else if (messagePart.mimeType === 'text/html') {
            htmlContent = content;
        }
    }
    // If the part has nested parts, recursively process them
    if (messagePart.parts && messagePart.parts.length > 0) {
        for (const part of messagePart.parts) {
            const { text, html } = extractEmailContent(part);
            if (text)
                textContent += text;
            if (html)
                htmlContent += html;
        }
    }
    // Return both plain text and HTML content
    return { text: textContent, html: htmlContent };
}

async function loadCredentials() {
    try {
        const { client, port } = await loadOAuthClient(OAUTH_PATH, CREDENTIALS_PATH);
        oauth2Client = client;

        // Store port for potential auth use
        oauth2Client._authPort = port;
    }
    catch (error) {
        console.error('Error loading credentials:', error.message);
        console.error('Run "npm run init" to set up safe-gmail-mcp.');
        process.exit(1);
    }
}

// Schema definitions
const SendEmailSchema = z.object({
    to: z.array(z.string()).describe("List of recipient email addresses"),
    subject: z.string().describe("Email subject"),
    body: z.string().describe("Email body content (used for text/plain or when htmlBody not provided)"),
    htmlBody: z.string().optional().describe("HTML version of the email body"),
    mimeType: z.enum(['text/plain', 'text/html', 'multipart/alternative']).optional().default('text/plain').describe("Email content type"),
    cc: z.array(z.string()).optional().describe("List of CC recipients"),
    bcc: z.array(z.string()).optional().describe("List of BCC recipients"),
    threadId: z.string().optional().describe("Thread ID to reply to"),
    inReplyTo: z.string().optional().describe("Message ID being replied to"),
    attachments: z.array(z.string()).optional().describe("List of file paths to attach to the email"),
});
const ReadEmailSchema = z.object({
    messageId: z.string().describe("ID of the email message to retrieve"),
});
const SearchEmailsSchema = z.object({
    query: z.string().describe("Gmail search query (e.g., 'from:example@gmail.com')"),
    maxResults: z.number().optional().describe("Maximum number of results to return"),
});
// Updated schema to include removeLabelIds
const ModifyEmailSchema = z.object({
    messageId: z.string().describe("ID of the email message to modify"),
    labelIds: z.array(z.string()).optional().describe("List of label IDs to apply"),
    addLabelIds: z.array(z.string()).optional().describe("List of label IDs to add to the message"),
    removeLabelIds: z.array(z.string()).optional().describe("List of label IDs to remove from the message"),
});
// New schema for listing email labels
const ListEmailLabelsSchema = z.object({}).describe("Retrieves all available Gmail labels");
// Label management schemas
const CreateLabelSchema = z.object({
    name: z.string().describe("Name for the new label"),
    messageListVisibility: z.enum(['show', 'hide']).optional().describe("Whether to show or hide the label in the message list"),
    labelListVisibility: z.enum(['labelShow', 'labelShowIfUnread', 'labelHide']).optional().describe("Visibility of the label in the label list"),
}).describe("Creates a new Gmail label");
const UpdateLabelSchema = z.object({
    id: z.string().describe("ID of the label to update"),
    name: z.string().optional().describe("New name for the label"),
    messageListVisibility: z.enum(['show', 'hide']).optional().describe("Whether to show or hide the label in the message list"),
    labelListVisibility: z.enum(['labelShow', 'labelShowIfUnread', 'labelHide']).optional().describe("Visibility of the label in the label list"),
}).describe("Updates an existing Gmail label");
const DeleteLabelSchema = z.object({
    id: z.string().describe("ID of the label to delete"),
}).describe("Deletes a Gmail label");
const GetOrCreateLabelSchema = z.object({
    name: z.string().describe("Name of the label to get or create"),
    messageListVisibility: z.enum(['show', 'hide']).optional().describe("Whether to show or hide the label in the message list"),
    labelListVisibility: z.enum(['labelShow', 'labelShowIfUnread', 'labelHide']).optional().describe("Visibility of the label in the label list"),
}).describe("Gets an existing label by name or creates it if it doesn't exist");
// Schemas for batch operations
const BatchModifyEmailsSchema = z.object({
    messageIds: z.array(z.string()).describe("List of message IDs to modify"),
    addLabelIds: z.array(z.string()).optional().describe("List of label IDs to add to all messages"),
    removeLabelIds: z.array(z.string()).optional().describe("List of label IDs to remove from all messages"),
    batchSize: z.number().optional().default(100).describe("Number of messages to process in each batch (default: 100)"),
});
const DownloadAttachmentSchema = z.object({
    messageId: z.string().describe("ID of the email message containing the attachment"),
    attachmentId: z.string().describe("ID of the attachment to download"),
    filename: z.string().optional().describe("Filename to save the attachment as (if not provided, uses original filename)"),
    savePath: z.string().optional().describe("Directory path to save the attachment (defaults to current directory)"),
});

// Main function
async function main() {
    await loadCredentials();

    if (process.argv[2] === 'auth') {
        await authenticate(oauth2Client, CREDENTIALS_PATH, oauth2Client._authPort);
        console.log('Authentication completed successfully');
        process.exit(0);
    }

    // Refresh token if needed before starting server
    try {
        await refreshIfNeeded(oauth2Client, CREDENTIALS_PATH);
    } catch (error) {
        console.error('Token refresh failed:', error.message);
        console.error('Run "npm run auth" to re-authenticate.');
        process.exit(1);
    }

    // Initialize Gmail API
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    // Server implementation
    const server = new Server({
        name: "safe-gmail",
        version: "1.0.0",
        capabilities: {
            tools: {},
        },
    });
    // Tool handlers
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: [
            {
                name: "draft_email",
                description: "Draft a new email",
                inputSchema: zodToJsonSchema(SendEmailSchema),
            },
            {
                name: "send_email",
                description: "Sends an email (RESTRICTED: can only send to yourself - the authenticated account's email address)",
                inputSchema: zodToJsonSchema(SendEmailSchema),
            },
            {
                name: "read_email",
                description: "Retrieves the content of a specific email",
                inputSchema: zodToJsonSchema(ReadEmailSchema),
            },
            {
                name: "search_emails",
                description: "Searches for emails using Gmail search syntax",
                inputSchema: zodToJsonSchema(SearchEmailsSchema),
            },
            {
                name: "modify_email",
                description: "Modifies email labels (move to different folders, archive by removing INBOX)",
                inputSchema: zodToJsonSchema(ModifyEmailSchema),
            },
            {
                name: "list_email_labels",
                description: "Retrieves all available Gmail labels",
                inputSchema: zodToJsonSchema(ListEmailLabelsSchema),
            },
            {
                name: "batch_modify_emails",
                description: "Modifies labels for multiple emails in batches (for bulk archiving)",
                inputSchema: zodToJsonSchema(BatchModifyEmailsSchema),
            },
            {
                name: "create_label",
                description: "Creates a new Gmail label",
                inputSchema: zodToJsonSchema(CreateLabelSchema),
            },
            {
                name: "update_label",
                description: "Updates an existing Gmail label",
                inputSchema: zodToJsonSchema(UpdateLabelSchema),
            },
            {
                name: "delete_label",
                description: "Deletes a Gmail label",
                inputSchema: zodToJsonSchema(DeleteLabelSchema),
            },
            {
                name: "get_or_create_label",
                description: "Gets an existing label by name or creates it if it doesn't exist",
                inputSchema: zodToJsonSchema(GetOrCreateLabelSchema),
            },
            {
                name: "download_attachment",
                description: "Downloads an email attachment to a specified location",
                inputSchema: zodToJsonSchema(DownloadAttachmentSchema),
            },
        ],
    }));
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
        const { name, arguments: args } = request.params;
        // Helper function for creating email drafts
        async function handleEmailAction(action, validatedArgs) {
            let message;
            try {
                // Check if we have attachments
                if (validatedArgs.attachments && validatedArgs.attachments.length > 0) {
                    // Use Nodemailer to create properly formatted RFC822 message
                    message = await createEmailWithNodemailer(validatedArgs);
                    const encodedMessage = Buffer.from(message).toString('base64')
                        .replace(/\+/g, '-')
                        .replace(/\//g, '_')
                        .replace(/=+$/, '');
                    const messageRequest = {
                        raw: encodedMessage,
                        ...(validatedArgs.threadId && { threadId: validatedArgs.threadId })
                    };
                    const response = await gmail.users.drafts.create({
                        userId: 'me',
                        requestBody: {
                            message: messageRequest,
                        },
                    });
                    return {
                        content: [
                            {
                                type: "text",
                                text: `Email draft created successfully with ID: ${response.data.id}`,
                            },
                        ],
                    };
                }
                else {
                    // For emails without attachments, use the existing simple method
                    message = createEmailMessage(validatedArgs);
                    const encodedMessage = Buffer.from(message).toString('base64')
                        .replace(/\+/g, '-')
                        .replace(/\//g, '_')
                        .replace(/=+$/, '');
                    const messageRequest = {
                        raw: encodedMessage,
                    };
                    // Add threadId if specified
                    if (validatedArgs.threadId) {
                        messageRequest.threadId = validatedArgs.threadId;
                    }
                    const response = await gmail.users.drafts.create({
                        userId: 'me',
                        requestBody: {
                            message: messageRequest,
                        },
                    });
                    return {
                        content: [
                            {
                                type: "text",
                                text: `Email draft created successfully with ID: ${response.data.id}`,
                            },
                        ],
                    };
                }
            }
            catch (error) {
                // Log attachment-related errors for debugging
                if (validatedArgs.attachments && validatedArgs.attachments.length > 0) {
                    console.error(`Failed to create draft with ${validatedArgs.attachments.length} attachments:`, error.message);
                }
                throw error;
            }
        }
        // Helper function to process operations in batches
        async function processBatches(items, batchSize, processFn) {
            const successes = [];
            const failures = [];
            // Process in batches
            for (let i = 0; i < items.length; i += batchSize) {
                const batch = items.slice(i, i + batchSize);
                try {
                    const results = await processFn(batch);
                    successes.push(...results);
                }
                catch (error) {
                    // If batch fails, try individual items
                    for (const item of batch) {
                        try {
                            const result = await processFn([item]);
                            successes.push(...result);
                        }
                        catch (itemError) {
                            failures.push({ item, error: itemError });
                        }
                    }
                }
            }
            return { successes, failures };
        }
        try {
            switch (name) {
                case "draft_email": {
                    const validatedArgs = SendEmailSchema.parse(args);
                    return await handleEmailAction("draft", validatedArgs);
                }
                case "send_email": {
                    const validatedArgs = SendEmailSchema.parse(args);

                    // Get authenticated user's email
                    const profile = await gmail.users.getProfile({ userId: 'me' });
                    const userEmail = profile.data.emailAddress.toLowerCase();

                    // Validate all recipients are self (security: can only send to yourself)
                    const allRecipients = [
                        ...validatedArgs.to,
                        ...(validatedArgs.cc || []),
                        ...(validatedArgs.bcc || [])
                    ];

                    for (const recipient of allRecipients) {
                        // Extract email from "Name <email>" format if present
                        const emailMatch = recipient.match(/<(.+)>/) || [null, recipient];
                        const recipientEmail = (emailMatch[1] || recipient).toLowerCase().trim();

                        if (recipientEmail !== userEmail) {
                            return {
                                content: [{
                                    type: "text",
                                    text: `Error: send_email can only send to yourself (${userEmail}). Recipient "${recipient}" is not allowed. Use draft_email for other recipients.`
                                }]
                            };
                        }
                    }

                    // Create and send the email
                    let message;
                    if (validatedArgs.attachments && validatedArgs.attachments.length > 0) {
                        message = await createEmailWithNodemailer(validatedArgs);
                    } else {
                        message = createEmailMessage(validatedArgs);
                    }

                    const encodedMessage = Buffer.from(message).toString('base64')
                        .replace(/\+/g, '-')
                        .replace(/\//g, '_')
                        .replace(/=+$/, '');

                    const response = await gmail.users.messages.send({
                        userId: 'me',
                        requestBody: {
                            raw: encodedMessage,
                            ...(validatedArgs.threadId && { threadId: validatedArgs.threadId })
                        },
                    });

                    return {
                        content: [{
                            type: "text",
                            text: `Email sent successfully to ${userEmail}. Message ID: ${response.data.id}`
                        }]
                    };
                }
                case "read_email": {
                    const validatedArgs = ReadEmailSchema.parse(args);
                    const response = await gmail.users.messages.get({
                        userId: 'me',
                        id: validatedArgs.messageId,
                        format: 'full',
                    });
                    const headers = response.data.payload?.headers || [];
                    const subject = headers.find(h => h.name?.toLowerCase() === 'subject')?.value || '';
                    const from = headers.find(h => h.name?.toLowerCase() === 'from')?.value || '';
                    const to = headers.find(h => h.name?.toLowerCase() === 'to')?.value || '';
                    const date = headers.find(h => h.name?.toLowerCase() === 'date')?.value || '';
                    const threadId = response.data.threadId || '';
                    // Extract email content using the recursive function
                    const { text, html } = extractEmailContent(response.data.payload || {});
                    // Use plain text content if available, otherwise use HTML content
                    let body = text || html || '';
                    // If we only have HTML content, add a note for the user
                    const contentTypeNote = !text && html ?
                        '[Note: This email is HTML-formatted. Plain text version not available.]\n\n' : '';
                    // Get attachment information
                    const attachments = [];
                    const processAttachmentParts = (part, path = '') => {
                        if (part.body && part.body.attachmentId) {
                            const filename = part.filename || `attachment-${part.body.attachmentId}`;
                            attachments.push({
                                id: part.body.attachmentId,
                                filename: filename,
                                mimeType: part.mimeType || 'application/octet-stream',
                                size: part.body.size || 0
                            });
                        }
                        if (part.parts) {
                            part.parts.forEach((subpart) => processAttachmentParts(subpart, `${path}/parts`));
                        }
                    };
                    if (response.data.payload) {
                        processAttachmentParts(response.data.payload);
                    }
                    // Add attachment info to output if any are present
                    const attachmentInfo = attachments.length > 0 ?
                        `\n\nAttachments (${attachments.length}):\n` +
                            attachments.map(a => `- ${a.filename} (${a.mimeType}, ${Math.round(a.size / 1024)} KB, ID: ${a.id})`).join('\n') : '';
                    return {
                        content: [
                            {
                                type: "text",
                                text: `Thread ID: ${threadId}\nSubject: ${subject}\nFrom: ${from}\nTo: ${to}\nDate: ${date}\n\n${contentTypeNote}${body}${attachmentInfo}`,
                            },
                        ],
                    };
                }
                case "search_emails": {
                    const validatedArgs = SearchEmailsSchema.parse(args);
                    const response = await gmail.users.messages.list({
                        userId: 'me',
                        q: validatedArgs.query,
                        maxResults: validatedArgs.maxResults || 250,
                    });
                    const messages = response.data.messages || [];
                    const results = await Promise.all(messages.map(async (msg) => {
                        const detail = await gmail.users.messages.get({
                            userId: 'me',
                            id: msg.id,
                            format: 'metadata',
                            metadataHeaders: ['Subject', 'From', 'Date'],
                        });
                        const headers = detail.data.payload?.headers || [];
                        return {
                            id: msg.id,
                            subject: headers.find(h => h.name === 'Subject')?.value || '',
                            from: headers.find(h => h.name === 'From')?.value || '',
                            date: headers.find(h => h.name === 'Date')?.value || '',
                        };
                    }));
                    return {
                        content: [
                            {
                                type: "text",
                                text: results.map(r => `ID: ${r.id}\nSubject: ${r.subject}\nFrom: ${r.from}\nDate: ${r.date}\n`).join('\n'),
                            },
                        ],
                    };
                }
                // Updated implementation for the modify_email handler
                case "modify_email": {
                    const validatedArgs = ModifyEmailSchema.parse(args);
                    // Prepare request body
                    const requestBody = {};
                    if (validatedArgs.labelIds) {
                        requestBody.addLabelIds = validatedArgs.labelIds;
                    }
                    if (validatedArgs.addLabelIds) {
                        requestBody.addLabelIds = validatedArgs.addLabelIds;
                    }
                    if (validatedArgs.removeLabelIds) {
                        requestBody.removeLabelIds = validatedArgs.removeLabelIds;
                    }
                    await gmail.users.messages.modify({
                        userId: 'me',
                        id: validatedArgs.messageId,
                        requestBody: requestBody,
                    });
                    return {
                        content: [
                            {
                                type: "text",
                                text: `Email ${validatedArgs.messageId} labels updated successfully`,
                            },
                        ],
                    };
                }
                case "list_email_labels": {
                    const labelResults = await listLabels(gmail);
                    const systemLabels = labelResults.system;
                    const userLabels = labelResults.user;
                    return {
                        content: [
                            {
                                type: "text",
                                text: `Found ${labelResults.count.total} labels (${labelResults.count.system} system, ${labelResults.count.user} user):\n\n` +
                                    "System Labels:\n" +
                                    systemLabels.map((l) => `ID: ${l.id}\nName: ${l.name}\n`).join('\n') +
                                    "\nUser Labels:\n" +
                                    userLabels.map((l) => `ID: ${l.id}\nName: ${l.name}\n`).join('\n')
                            },
                        ],
                    };
                }
                case "batch_modify_emails": {
                    const validatedArgs = BatchModifyEmailsSchema.parse(args);
                    const messageIds = validatedArgs.messageIds;
                    const batchSize = validatedArgs.batchSize || 50;
                    // Prepare request body
                    const requestBody = {};
                    if (validatedArgs.addLabelIds) {
                        requestBody.addLabelIds = validatedArgs.addLabelIds;
                    }
                    if (validatedArgs.removeLabelIds) {
                        requestBody.removeLabelIds = validatedArgs.removeLabelIds;
                    }
                    // Process messages in batches
                    const { successes, failures } = await processBatches(messageIds, batchSize, async (batch) => {
                        const results = await Promise.all(batch.map(async (messageId) => {
                            const result = await gmail.users.messages.modify({
                                userId: 'me',
                                id: messageId,
                                requestBody: requestBody,
                            });
                            return { messageId, success: true };
                        }));
                        return results;
                    });
                    // Generate summary of the operation
                    const successCount = successes.length;
                    const failureCount = failures.length;
                    let resultText = `Batch label modification complete.\n`;
                    resultText += `Successfully processed: ${successCount} messages\n`;
                    if (failureCount > 0) {
                        resultText += `Failed to process: ${failureCount} messages\n\n`;
                        resultText += `Failed message IDs:\n`;
                        resultText += failures.map(f => `- ${f.item.substring(0, 16)}... (${f.error.message})`).join('\n');
                    }
                    return {
                        content: [
                            {
                                type: "text",
                                text: resultText,
                            },
                        ],
                    };
                }
                // Label management handlers
                case "create_label": {
                    const validatedArgs = CreateLabelSchema.parse(args);
                    const result = await createLabel(gmail, validatedArgs.name, {
                        messageListVisibility: validatedArgs.messageListVisibility,
                        labelListVisibility: validatedArgs.labelListVisibility,
                    });
                    return {
                        content: [
                            {
                                type: "text",
                                text: `Label created successfully:\nID: ${result.id}\nName: ${result.name}\nType: ${result.type}`,
                            },
                        ],
                    };
                }
                case "update_label": {
                    const validatedArgs = UpdateLabelSchema.parse(args);
                    // Prepare request body with only the fields that were provided
                    const updates = {};
                    if (validatedArgs.name)
                        updates.name = validatedArgs.name;
                    if (validatedArgs.messageListVisibility)
                        updates.messageListVisibility = validatedArgs.messageListVisibility;
                    if (validatedArgs.labelListVisibility)
                        updates.labelListVisibility = validatedArgs.labelListVisibility;
                    const result = await updateLabel(gmail, validatedArgs.id, updates);
                    return {
                        content: [
                            {
                                type: "text",
                                text: `Label updated successfully:\nID: ${result.id}\nName: ${result.name}\nType: ${result.type}`,
                            },
                        ],
                    };
                }
                case "delete_label": {
                    const validatedArgs = DeleteLabelSchema.parse(args);
                    const result = await deleteLabel(gmail, validatedArgs.id);
                    return {
                        content: [
                            {
                                type: "text",
                                text: result.message,
                            },
                        ],
                    };
                }
                case "get_or_create_label": {
                    const validatedArgs = GetOrCreateLabelSchema.parse(args);
                    const result = await getOrCreateLabel(gmail, validatedArgs.name, {
                        messageListVisibility: validatedArgs.messageListVisibility,
                        labelListVisibility: validatedArgs.labelListVisibility,
                    });
                    const action = result.type === 'user' && result.name === validatedArgs.name ? 'found existing' : 'created new';
                    return {
                        content: [
                            {
                                type: "text",
                                text: `Successfully ${action} label:\nID: ${result.id}\nName: ${result.name}\nType: ${result.type}`,
                            },
                        ],
                    };
                }
                case "download_attachment": {
                    const validatedArgs = DownloadAttachmentSchema.parse(args);
                    try {
                        // Get the attachment data from Gmail API
                        const attachmentResponse = await gmail.users.messages.attachments.get({
                            userId: 'me',
                            messageId: validatedArgs.messageId,
                            id: validatedArgs.attachmentId,
                        });
                        if (!attachmentResponse.data.data) {
                            throw new Error('No attachment data received');
                        }
                        // Decode the base64 data
                        const data = attachmentResponse.data.data;
                        const buffer = Buffer.from(data, 'base64url');
                        // Determine save path and filename
                        const savePath = validatedArgs.savePath || process.cwd();
                        let filename = validatedArgs.filename;
                        if (!filename) {
                            // Get original filename from message if not provided
                            const messageResponse = await gmail.users.messages.get({
                                userId: 'me',
                                id: validatedArgs.messageId,
                                format: 'full',
                            });
                            // Find the attachment part to get original filename
                            const findAttachment = (part) => {
                                if (part.body && part.body.attachmentId === validatedArgs.attachmentId) {
                                    return part.filename || `attachment-${validatedArgs.attachmentId}`;
                                }
                                if (part.parts) {
                                    for (const subpart of part.parts) {
                                        const found = findAttachment(subpart);
                                        if (found)
                                            return found;
                                    }
                                }
                                return null;
                            };
                            filename = findAttachment(messageResponse.data.payload) || `attachment-${validatedArgs.attachmentId}`;
                        }
                        // Ensure save directory exists
                        if (!fs.existsSync(savePath)) {
                            fs.mkdirSync(savePath, { recursive: true });
                        }
                        // Write file
                        const fullPath = path.join(savePath, filename);
                        fs.writeFileSync(fullPath, buffer);
                        return {
                            content: [
                                {
                                    type: "text",
                                    text: `Attachment downloaded successfully:\nFile: ${filename}\nSize: ${buffer.length} bytes\nSaved to: ${fullPath}`,
                                },
                            ],
                        };
                    }
                    catch (error) {
                        return {
                            content: [
                                {
                                    type: "text",
                                    text: `Failed to download attachment: ${error.message}`,
                                },
                            ],
                        };
                    }
                }
                default:
                    throw new Error(`Unknown tool: ${name}`);
            }
        }
        catch (error) {
            return {
                content: [
                    {
                        type: "text",
                        text: `Error: ${error.message}`,
                    },
                ],
            };
        }
    });
    const transport = new StdioServerTransport();
    server.connect(transport);
}
main().catch((error) => {
    console.error('Server error:', error);
    process.exit(1);
});
