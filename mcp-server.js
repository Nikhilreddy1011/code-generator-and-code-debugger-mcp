import "dotenv/config";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema
} from "@modelcontextprotocol/sdk/types.js";
import { GoogleGenAI } from "@google/genai";
import { z } from "zod";

/* -----------------------------
   Gemini Setup
------------------------------*/
if (!process.env.GEMINI_API_KEY) {
  // Fail loudly at startup instead of surfacing a confusing 400 on the first
  // tool call. stderr is safe to write to — stdout is the JSON-RPC channel.
  console.error(
    "FATAL: GEMINI_API_KEY is not set. Create a .env file next to mcp-server.js containing:\n" +
      "  GEMINI_API_KEY=your_gemini_api_key\n" +
      "  GEMINI_MODEL=gemini-2.5-flash"
  );
  process.exit(1);
}

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY
});

const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

// Gemini 2.5 models spend part of the output budget on internal "thinking"
// tokens. With the default budget a long answer can exhaust the cap before any
// visible text is produced, which comes back as finishReason MAX_TOKENS and an
// empty response. Capping thinking and raising the output cap leaves plenty of
// room for the actual code.
const MAX_OUTPUT_TOKENS = Number(process.env.GEMINI_MAX_OUTPUT_TOKENS || 8192);
const THINKING_BUDGET = Number(process.env.GEMINI_THINKING_BUDGET || 2048);
const REQUEST_TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS || 120000);
const MAX_ATTEMPTS = Number(process.env.GEMINI_MAX_ATTEMPTS || 4);

/* -----------------------------
   Input Validation Schemas
   (The MCP SDK's low-level Server does NOT auto-validate
   arguments against the declared inputSchema below — that
   JSON schema is only advertised to clients. We validate for
   real here with zod so a malformed call fails fast with a
   clear message instead of crashing inside the Gemini call.)
------------------------------*/
const GenerateCodeArgs = z.object({
  prompt: z.string().min(1, "prompt is required")
});

const DebugCodeArgs = z.object({
  code: z.string().min(1, "code is required"),
  errorMessage: z.string().optional()
});

/* -----------------------------
   Gemini Call Helper
------------------------------*/

// Gemini returns 429/500/503 under load. These are transient — the original
// code surfaced them straight to the user as "generation failed", which is why
// the tools appeared to randomly stop working.
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

function isRetryable(err) {
  const status =
    err?.status ??
    err?.code ??
    err?.error?.code ??
    // The SDK stringifies the API error body into err.message.
    Number(String(err?.message ?? "").match(/"code"\s*:\s*(\d+)/)?.[1]);

  if (RETRYABLE_STATUS.has(Number(status))) return true;

  // Socket-level hiccups are worth another attempt too.
  return ["ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN"].includes(err?.code);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Pull the model's text out of a response.
 *
 * `response.text` is a getter (not a method), and it is `undefined` whenever the
 * model produced no text part — a safety block, or finishReason MAX_TOKENS. The
 * previous version passed that `undefined` straight into the MCP content block,
 * producing an invalid response that clients render as empty output.
 */
function extractText(response) {
  const direct = response?.text;
  if (typeof direct === "string" && direct.trim()) return direct;

  const candidate = response?.candidates?.[0];
  const joined = (candidate?.content?.parts ?? [])
    .map((part) => part?.text)
    .filter((text) => typeof text === "string" && text.trim())
    .join("\n");
  if (joined.trim()) return joined;

  const blockReason = response?.promptFeedback?.blockReason;
  if (blockReason) {
    throw new Error(`the request was blocked by Gemini safety filters (${blockReason}).`);
  }

  if (candidate?.finishReason === "MAX_TOKENS") {
    throw new Error(
      `the model hit the output limit (${MAX_OUTPUT_TOKENS} tokens) before returning any code. ` +
        "Ask for a smaller piece of code, or raise GEMINI_MAX_OUTPUT_TOKENS in .env."
    );
  }

  if (candidate?.finishReason && candidate.finishReason !== "STOP") {
    throw new Error(`the model stopped early (finishReason: ${candidate.finishReason}).`);
  }

  throw new Error("the model returned an empty response.");
}

async function callGemini(contents) {
  let lastError;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    // A hung request would otherwise block the MCP client indefinitely.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents,
        config: {
          temperature: 0.2,
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          thinkingConfig: { thinkingBudget: THINKING_BUDGET },
          abortSignal: controller.signal
        }
      });

      return extractText(response);
    } catch (err) {
      lastError = err;

      if (controller.signal.aborted) {
        lastError = new Error(`Gemini request timed out after ${REQUEST_TIMEOUT_MS}ms.`);
      } else if (!isRetryable(err) || attempt === MAX_ATTEMPTS) {
        throw err;
      }

      if (attempt === MAX_ATTEMPTS) break;

      // Exponential backoff with jitter: ~1s, 2s, 4s.
      const delay = 1000 * 2 ** (attempt - 1) + Math.floor(Math.random() * 250);
      console.error(
        `Gemini call failed (attempt ${attempt}/${MAX_ATTEMPTS}): ${err?.message ?? err}. ` +
          `Retrying in ${delay}ms.`
      );
      await sleep(delay);
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError;
}

function toolError(message) {
  return {
    isError: true,
    content: [{ type: "text", text: message }]
  };
}

function toolResult(text) {
  return {
    content: [{ type: "text", text }]
  };
}

/* -----------------------------
   MCP Server Setup
------------------------------*/
const server = new Server(
  {
    name: "ai-code-assistant",
    version: "1.0.0"
  },
  {
    capabilities: {
      tools: {}
    }
  }
);

/* -----------------------------
   Tool List
------------------------------*/
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "generate_code",
        description: "Generate code from a prompt",
        inputSchema: {
          type: "object",
          properties: {
            prompt: {
              type: "string",
              description: "Programming task to generate code for"
            }
          },
          required: ["prompt"]
        }
      },
      {
        name: "debug_code",
        description: "Debug code and provide a fixed version",
        inputSchema: {
          type: "object",
          properties: {
            code: {
              type: "string",
              description: "Code that needs debugging"
            },
            errorMessage: {
              type: "string",
              description: "Error message if available"
            }
          },
          required: ["code"]
        }
      }
    ]
  };
});

/* -----------------------------
   Tool Execution
------------------------------*/
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  /* -------- Code Generation -------- */
  if (name === "generate_code") {
    const parsed = GenerateCodeArgs.safeParse(args);
    if (!parsed.success) {
      return toolError(`Invalid arguments: ${parsed.error.issues[0].message}`);
    }

    try {
      const text = await callGemini(
        `Generate clean, well-commented code for the following task.
Respond with the code in a fenced code block, followed by a short explanation.

Task:
${parsed.data.prompt}`
      );
      return toolResult(text);
    } catch (err) {
      return toolError(`Code generation failed: ${err?.message ?? err}`);
    }
  }

  /* -------- Code Debugging -------- */
  if (name === "debug_code") {
    const parsed = DebugCodeArgs.safeParse(args);
    if (!parsed.success) {
      return toolError(`Invalid arguments: ${parsed.error.issues[0].message}`);
    }

    const { code, errorMessage } = parsed.data;

    try {
      const text = await callGemini(
        `Debug the following code.

Code:
${code}

Error:
${errorMessage ?? "Not provided"}

Explain the bug, then provide the corrected version in a fenced code block.`
      );
      return toolResult(text);
    } catch (err) {
      return toolError(`Debugging failed: ${err?.message ?? err}`);
    }
  }

  return toolError(`Unknown tool: ${name}`);
});

/* -----------------------------
   Start MCP Server
------------------------------*/
process.on("unhandledRejection", (err) => {
  console.error("Unhandled rejection:", err);
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(
  `MCP Code Assistant Server Started (model: ${GEMINI_MODEL}, ` +
    `maxOutputTokens: ${MAX_OUTPUT_TOKENS}, thinkingBudget: ${THINKING_BUDGET})`
);
