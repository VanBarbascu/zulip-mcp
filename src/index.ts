import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import express from "express";
import { z } from "zod";

// --- Configuration ---

const ZULIP_URL = process.env.ZULIP_URL;
const ZULIP_EMAIL = process.env.ZULIP_EMAIL;
const ZULIP_API_KEY = process.env.ZULIP_API_KEY;
const ZULIP_NOTIFICATION_USER = process.env.ZULIP_NOTIFICATION_USER;

const missing = [
  ["ZULIP_URL", ZULIP_URL],
  ["ZULIP_EMAIL", ZULIP_EMAIL],
  ["ZULIP_API_KEY", ZULIP_API_KEY],
  ["ZULIP_NOTIFICATION_USER", ZULIP_NOTIFICATION_USER],
]
  .filter(([, v]) => !v)
  .map(([k]) => k);

if (missing.length > 0) {
  console.error(`Missing required environment variables: ${missing.join(", ")}`);
  process.exit(1);
}

// --- Zulip API Helper ---

const authHeader =
  "Basic " + Buffer.from(`${ZULIP_EMAIL}:${ZULIP_API_KEY}`).toString("base64");

async function zulipRequest(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  endpoint: string,
  params?: Record<string, string>,
): Promise<unknown> {
  let url = `${ZULIP_URL}/api/v1${endpoint}`;
  const headers: Record<string, string> = { Authorization: authHeader };

  const init: RequestInit = { method, headers };

  if (params && Object.keys(params).length > 0) {
    if (method === "GET") {
      url += "?" + new URLSearchParams(params).toString();
    } else {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      init.body = new URLSearchParams(params).toString();
    }
  }

  const res = await fetch(url, init);
  const json = (await res.json()) as { result: string; msg: string };

  if (json.result !== "success") {
    throw new Error(`Zulip API error (${endpoint}): ${json.msg}`);
  }

  return json;
}

async function handleToolCall(fn: () => Promise<unknown>) {
  try {
    const result = await fn();
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  } catch (err) {
    return { content: [{ type: "text" as const, text: String(err) }], isError: true };
  }
}

// --- MCP Server Factory ---

function createServer(): McpServer {
  const server = new McpServer({
    name: "zulip",
    version: "1.0.0",
  });

// --- Tool: get_messages ---

server.tool(
  "get_messages",
  "Fetch messages from Zulip. Use `narrow` to filter by stream, topic, sender, etc.",
  {
    anchor: z
      .string()
      .default("newest")
      .describe("Message ID anchor, or 'newest'/'oldest'/'first_unread'"),
    num_before: z
      .number()
      .int()
      .default(5)
      .describe("Number of messages before anchor"),
    num_after: z
      .number()
      .int()
      .default(0)
      .describe("Number of messages after anchor"),
    narrow: z
      .string()
      .optional()
      .describe(
        'JSON-encoded narrow filter, e.g. [{"operator":"stream","operand":"general"}]',
      ),
    apply_markdown: z
      .boolean()
      .default(true)
      .describe("Whether to render message content as HTML"),
  },
  async ({ anchor, num_before, num_after, narrow, apply_markdown }) => {
    const params: Record<string, string> = {
      anchor,
      num_before: String(num_before),
      num_after: String(num_after),
      apply_markdown: String(apply_markdown),
    };
    if (narrow) {
      params.narrow = narrow;
    }
    return handleToolCall(() => zulipRequest("GET", "/messages", params));
  },
);

// --- Tool: get_drafts ---

server.tool(
  "get_drafts",
  "Retrieve all drafts for the authenticated Zulip user.",
  {},
  async () => handleToolCall(() => zulipRequest("GET", "/drafts")),
);

// --- Tool: create_drafts ---

server.tool(
  "create_drafts",
  "Create one or more message drafts in Zulip.",
  {
    drafts: z
      .array(
        z.object({
          type: z.enum(["stream", "private"]).describe("Draft type"),
          to: z
            .union([z.number(), z.array(z.number())])
            .describe("Stream ID (for stream) or array of user IDs (for private)"),
          topic: z.string().describe("Topic name (required for stream type)"),
          content: z.string().describe("Message content in Markdown"),
        }),
      )
      .describe("Array of draft objects to create"),
  },
  async ({ drafts }) =>
    handleToolCall(() => zulipRequest("POST", "/drafts", { drafts: JSON.stringify(drafts) })),
);

// --- Tool: edit_draft ---

server.tool(
  "edit_draft",
  "Edit an existing Zulip draft by its ID.",
  {
    draft_id: z.number().int().describe("ID of the draft to edit"),
    draft: z.object({
      type: z.enum(["stream", "private"]).describe("Draft type"),
      to: z
        .union([z.number(), z.array(z.number())])
        .describe("Stream ID (for stream) or array of user IDs (for private)"),
      topic: z.string().describe("Topic name"),
      content: z.string().describe("Message content in Markdown"),
    }),
  },
  async ({ draft_id, draft }) =>
    handleToolCall(() =>
      zulipRequest("PATCH", `/drafts/${draft_id}`, { draft: JSON.stringify(draft) }),
    ),
);

// --- Tool: delete_draft ---

server.tool(
  "delete_draft",
  "Delete a Zulip draft by its ID.",
  {
    draft_id: z.number().int().describe("ID of the draft to delete"),
  },
  async ({ draft_id }) => handleToolCall(() => zulipRequest("DELETE", `/drafts/${draft_id}`)),
);

// --- Tool: send_notification ---

server.tool(
  "send_notification",
  `Send a direct message to the configured notification user (${ZULIP_NOTIFICATION_USER}).`,
  {
    content: z.string().describe("Message content in Markdown"),
  },
  async ({ content }) =>
    handleToolCall(() =>
      zulipRequest("POST", "/messages", {
        type: "direct",
        to: JSON.stringify([ZULIP_NOTIFICATION_USER]),
        content,
      }),
    ),
);

  return server;
}

// --- Start Server (SSE over HTTP) ---

const PORT = parseInt(process.env.PORT || "3000", 10);
const app = express();

const transports = new Map<string, SSEServerTransport>();

app.get("/sse", async (_req, res) => {
  const transport = new SSEServerTransport("/messages", res);
  transports.set(transport.sessionId, transport);
  res.on("close", () => transports.delete(transport.sessionId));
  const server = createServer();
  await server.connect(transport);
});

app.post("/messages", async (req, res) => {
  const sessionId = req.query.sessionId as string;
  const transport = transports.get(sessionId);
  if (!transport) {
    res.status(400).json({ error: "Unknown session" });
    return;
  }
  await transport.handlePostMessage(req, res);
});

app.listen(PORT, "0.0.0.0", () => {
  console.error(`Zulip MCP server listening on http://0.0.0.0:${PORT}/sse`);
});
