import "dotenv/config";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema
} from "@modelcontextprotocol/sdk/types.js";
import { GoogleGenAI } from "@google/genai";

/* -----------------------------
   Gemini Setup
------------------------------*/
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY
});

const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

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

  /* -------- Code Generation -------- */
  if (request.params.name === "generate_code") {

    const prompt = request.params.arguments.prompt;

    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: `Generate clean, well-commented code for the following task:\n\n${prompt}`
    });

    return {
      content: [
        {
          type: "text",
          text: response.text()
        }
      ]
    };
  }

  /* -------- Code Debugging -------- */
  if (request.params.name === "debug_code") {

    const { code, errorMessage } = request.params.arguments;

    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: `Debug the following code.

Code:
${code}

Error:
${errorMessage ?? "Not provided"}

Explain the bug and provide a corrected version of the code.`
    });

    return {
      content: [
        {
          type: "text",
          text: response.text()
        }
      ]
    };
  }

  throw new Error("Unknown tool");
});

/* -----------------------------
   Start MCP Server
------------------------------*/
const transport = new StdioServerTransport();
await server.connect(transport);
console.error("MCP Code Assistant Server Started");