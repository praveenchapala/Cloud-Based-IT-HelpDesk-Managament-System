
import express from "express";

const SYSTEM_PROMPT = `
You are ResolveBot, the professional IT helpdesk assistant for ResolveIT.

YOUR PURPOSE:
Help employees and IT users solve technical problems involving:
- Windows, Linux and macOS
- Networking, Wi-Fi, DNS and internet connectivity
- Hardware and software troubleshooting
- Email and browser issues
- Account access and authentication
- Application errors
- IT support procedures

RESPONSE FORMATTING RULES:

1. Make every response clear, structured, professional and easy to understand.
2. Use Markdown formatting.
3. Use meaningful headings, numbered steps and bullet points.
4. Highlight important terms using bold text.
5. Use code blocks for terminal commands and code.
6. Explain technical terminology in simple language.
7. Avoid unnecessarily long paragraphs.
8. Do not repeat the same information.
9. Adapt the level of detail to the complexity of the question.
10. Never invent diagnostic results or claim that an action has been performed.

FOR TROUBLESHOOTING QUESTIONS, FOLLOW THIS STRUCTURE:

## Problem Summary
Briefly explain what the problem means and identify likely causes without pretending to know the exact cause.

## Step-by-Step Solution
Provide numbered steps.

For each step:
- **Action:** Explain what the user should do.
- **Instructions:** Give precise navigation or commands.
- **Expected result:** Explain what should happen.

Present commands in separate code blocks.

Start with simple, non-destructive checks before advanced troubleshooting.

## Verify the Solution
Explain how the user can confirm whether the problem is resolved.

## If the Problem Persists
Give the next useful diagnostic action.

## One Follow-up Question
Ask one focused question that helps narrow down the problem.

FOR SIMPLE QUESTIONS:
Answer directly. Do not force the full troubleshooting structure onto simple definitions or general questions.

FOR COMMANDS:
- Explain what each command does.
- Identify whether administrator privileges are required.
- Warn users before commands that can interrupt connectivity, delete data, change configurations or affect security.
- Never recommend destructive commands without explaining their consequences.

SECURITY AND PRIVACY:
- Never request passwords, OTPs, API keys or recovery codes.
- Never suggest disabling security controls or bypassing access restrictions.
- For suspected security incidents, recommend contacting the organization's authorized IT/security team.
- Never claim access to the user's device, network, account, tickets or internal company systems.
- Only use information explicitly supplied in the conversation.

TONE:
Professional, clear, practical and respectful.
Avoid unnecessary greetings, excessive enthusiasm and generic closing statements.
Prioritize actionable instructions over lengthy explanations.
`;

const MAX_MESSAGE_LENGTH = 2000;
const MAX_HISTORY_MESSAGES = 10;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 15;
const REQUEST_TIMEOUT_MS = 45_000;

const userRequestWindows = new Map();

function allowUserRequest(userId) {
  const now = Date.now();

  const recentRequests = (
    userRequestWindows.get(userId) || []
  ).filter(
    (timestamp) =>
      now - timestamp < RATE_LIMIT_WINDOW_MS
  );

  if (recentRequests.length >= RATE_LIMIT_MAX_REQUESTS) {
    userRequestWindows.set(userId, recentRequests);
    return false;
  }

  recentRequests.push(now);
  userRequestWindows.set(userId, recentRequests);

  return true;
}

function sanitizeHistory(history) {
  if (!Array.isArray(history)) return [];

  return history
    .slice(-MAX_HISTORY_MESSAGES)
    .filter(
      (item) =>
        item &&
        (item.role === "user" ||
          item.role === "assistant") &&
        typeof item.content === "string" &&
        item.content.trim().length > 0 &&
        item.content.length <= MAX_MESSAGE_LENGTH
    )
    .map(({ role, content }) => ({
      role: role === "assistant" ? "model" : "user",
      parts: [{ text: content.trim() }]
    }));
}

function extractGeminiText(result) {
  const parts = result?.candidates?.[0]?.content?.parts;

  if (!Array.isArray(parts)) return "";

  return parts
    .filter((part) => typeof part.text === "string")
    .map((part) => part.text)
    .join("\n")
    .trim();
}

export function createChatRouter({ authenticateToken }) {
  if (typeof authenticateToken !== "function") {
    throw new TypeError(
      "createChatRouter requires authenticateToken middleware"
    );
  }

  const router = express.Router();

  router.post("/", authenticateToken, async (req, res) => {
    const message =
      typeof req.body?.message === "string"
        ? req.body.message.trim()
        : "";

    if (!message) {
      return res.status(400).json({
        success: false,
        message: "Please enter a message."
      });
    }

    if (message.length > MAX_MESSAGE_LENGTH) {
      return res.status(400).json({
        success: false,
        message: `Message must be ${MAX_MESSAGE_LENGTH} characters or fewer.`
      });
    }

    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message:
          "Your authenticated user session could not be verified."
      });
    }

    if (!allowUserRequest(String(userId))) {
      return res.status(429).json({
        success: false,
        message:
          "You have sent too many messages. Please wait a minute and try again."
      });
    }

    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      console.error(
        "ResolveBot configuration error: GEMINI_API_KEY is missing."
      );

      return res.status(503).json({
        success: false,
        message:
          "ResolveBot is not configured yet. Please contact the administrator."
      });
    }

    const model =
      process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";

    const history = sanitizeHistory(req.body?.history);

    const contents = [
      ...history,
      {
        role: "user",
        parts: [{ text: message }]
      }
    ];

    const endpoint =
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

    try {
      const response = await fetch(endpoint, {
        method: "POST",

        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey
        },

        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: SYSTEM_PROMPT }]
          },

          contents,

          generationConfig: {
            temperature: 0.4,
            maxOutputTokens: 1200
          }
        }),

        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      });

      const result = await response.json().catch(() => null);

      if (!response.ok) {
        const providerMessage =
          result?.error?.message ||
          "Gemini API request failed";

        console.error("Gemini API request failed:", {
          status: response.status,
          statusText: result?.error?.status,
          message: providerMessage
        });

        if (
          response.status === 401 ||
          response.status === 403
        ) {
          return res.status(503).json({
            success: false,
            message:
              "ResolveBot could not authenticate with Gemini. Check the backend API key and its access."
          });
        }

        if (response.status === 429) {
          return res.status(429).json({
            success: false,
            message:
              "ResolveBot has reached the Gemini free-tier rate limit. Please wait and try again later."
          });
        }

        if (
          response.status === 400 ||
          response.status === 404
        ) {
          return res.status(502).json({
            success: false,
            message:
              "Gemini rejected the request or model. Check the configured Gemini model name."
          });
        }

        return res.status(502).json({
          success: false,
          message:
            "ResolveBot could not get a response from Gemini. Please try again."
        });
      }

      const answer = extractGeminiText(result);

      if (!answer) {
        const blockReason =
          result?.promptFeedback?.blockReason;

        console.error("Gemini returned no text:", {
          blockReason: blockReason || "No text candidate"
        });

        return res.status(502).json({
          success: false,
          message: blockReason
            ? "Gemini could not answer that message. Please rephrase it."
            : "Gemini returned an empty response. Please try again."
        });
      }

      return res.json({
        success: true,
        data: { answer }
      });

    } catch (error) {
      if (
        error.name === "TimeoutError" ||
        error.name === "AbortError"
      ) {
        return res.status(504).json({
          success: false,
          message:
            "ResolveBot took too long to respond. Please try again."
        });
      }

      console.error(
        "ResolveBot Gemini connection error:",
        error.message
      );

      return res.status(502).json({
        success: false,
        message:
          "Unable to connect to Gemini. Please try again later."
      });
    }
  });

  return router;
}
