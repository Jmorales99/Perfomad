import Anthropic from "@anthropic-ai/sdk"
import { env } from "@/config/env"
import {
  SYSTEM_PROMPT_V2,
  SYSTEM_PROMPT_VERSION,
} from "@/application/usecases/optimization/schemas/systemPrompt"
import type { OptimizationInput } from "@/application/usecases/optimization/schemas/OptimizationInput"

export interface ClaudeAnalyzeResult {
  /** Raw text returned by the model (should be strict JSON). */
  rawText: string
  /** Parsed JSON (best effort). Caller MUST validate with Zod before using. */
  parsedJson: unknown
  model: string
  inputTokens: number | null
  outputTokens: number | null
  latencyMs: number
  promptVersion: string
}

export class ClaudeNotConfiguredError extends Error {
  constructor() {
    super("Anthropic API key is not configured. Set ANTHROPIC_API_KEY in .env.")
    this.name = "ClaudeNotConfiguredError"
  }
}

/**
 * ClaudeClient wraps the Anthropic SDK with a strict JSON-only contract.
 *
 * Security:
 * - API key is read ONLY from the backend env (never exposed to clients).
 * - The campaign input is passed as a user message (no credentials, no raw tokens).
 * - The system prompt is short and versioned; it is NOT concatenated with user data.
 */
export class ClaudeClient {
  private client: Anthropic | null = null

  private getClient(): Anthropic {
    if (!env.ANTHROPIC_API_KEY) {
      throw new ClaudeNotConfiguredError()
    }
    if (!this.client) {
      this.client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })
    }
    return this.client
  }

  isConfigured(): boolean {
    return !!env.ANTHROPIC_API_KEY
  }

  async analyzeCampaign(
    input: OptimizationInput,
    options: { model: string; maxTokens: number }
  ): Promise<ClaudeAnalyzeResult> {
    const client = this.getClient()
    const startedAt = Date.now()

    const userPayload = JSON.stringify({
      optimization_input: input,
      respond_with: "OptimizationOutput v2 as strict JSON only",
    })

    const response = await client.messages.create(
      {
        model: options.model,
        max_tokens: options.maxTokens,
        system: [
          {
            type: "text",
            text: SYSTEM_PROMPT_V2,
            cache_control: { type: "ephemeral" },
          },
        ],
        messages: [
          {
            role: "user",
            content: userPayload,
          },
        ],
      },
      { timeout: 50_000 }
    )

    const latencyMs = Date.now() - startedAt

    const textBlocks = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
    const rawText = textBlocks.join("\n").trim()

    let parsedJson: unknown = null
    try {
      parsedJson = JSON.parse(rawText)
    } catch {
      parsedJson = tryExtractJson(rawText)
    }

    return {
      rawText,
      parsedJson,
      model: response.model,
      inputTokens: response.usage?.input_tokens ?? null,
      outputTokens: response.usage?.output_tokens ?? null,
      latencyMs,
      promptVersion: SYSTEM_PROMPT_VERSION,
    }
  }
}

function tryExtractJson(text: string): unknown {
  const firstBrace = text.indexOf("{")
  const lastBrace = text.lastIndexOf("}")
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    return null
  }
  try {
    return JSON.parse(text.slice(firstBrace, lastBrace + 1))
  } catch {
    return null
  }
}
