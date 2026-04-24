# Zulip MCP Server

An [MCP](https://modelcontextprotocol.io/) server that wraps the Zulip REST API, exposing it as tools over SSE transport. Built with TypeScript and the official MCP SDK.

## Available Tools

| Tool | Description |
|------|-------------|
| `get_messages` | Fetch messages from Zulip. Supports narrow filters (by stream, topic, sender), anchoring, and pagination via `num_before`/`num_after`. |
| `get_message` | Fetch a single message by its ID. |
| `get_streams` | List channels (streams) visible to the authenticated user. |
| `get_topics` | List topics in a channel by its ID. |
| `get_drafts` | Retrieve all drafts for the authenticated user. |
| `create_drafts` | Create one or more message drafts (stream or private). |
| `edit_draft` | Edit an existing draft by ID (type, recipient, topic, content). |
| `delete_draft` | Delete a draft by ID. |
| `send_notification` | Send a direct message to the configured notification user (`ZULIP_NOTIFICATION_USER`). |

## Setup

### Prerequisites

- Node.js 22+ **or** Docker

### Configuration

Copy the example env file and fill in your Zulip credentials:

```sh
cp .env.example .env
```

You'll need:
- `ZULIP_URL` — your Zulip server URL (e.g. `https://your-org.zulipchat.com`)
- `ZULIP_EMAIL` — the bot's email address
- `ZULIP_API_KEY` — the bot's API key (see below)
- `ZULIP_NOTIFICATION_USER` — email of the user to receive notifications via `send_notification`

#### Getting your Zulip API key

1. Log in to your Zulip organization
2. Go to **Personal settings** > **Account & privacy**
3. Scroll down to the **API key** section
4. Click **Manage your API key** and enter your password to reveal it

Alternatively, if you're using a bot account:

1. Go to **Organization settings** > **Bots**
2. Create a new bot or select an existing one
3. The API key is shown on the bot's card — click to copy it

See the [Zulip API keys documentation](https://zulip.com/api/api-keys) for more details.

### Run with Docker (recommended)

```sh
docker compose up -d
```

### Run locally

```sh
npm install
npm run build
npm start
```

The server listens on `http://localhost:3000/sse`.

## Claude Code Integration

Add this to your `.mcp.json`:

```json
{
  "mcpServers": {
    "zulip": {
      "url": "http://localhost:3000/sse"
    }
  }
}
```
