import Anthropic from "@anthropic-ai/sdk";
import type { ParsedLogs } from "../../../src/lib/contract";

/**
 * Optional LLM root-cause hypothesis. No-op unless ANTHROPIC_API_KEY is set,
 * so the demo runs identically with or without it.
 *
 * Model choice (claude-sonnet-5) comes from the master plan. Thinking is
 * disabled explicitly: on Sonnet 5 adaptive thinking is ON by default, which
 * would consume the small max_tokens budget and push a `thinking` block to
 * content[0] — leaving no visible text for a one-sentence answer.
 */
export async function hypothesize(parsed: ParsedLogs, deployNote: string): Promise<string | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  try {
    const client = new Anthropic();
    const msg = await client.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 150,
      thinking: { type: "disabled" },
      messages: [
        {
          role: "user",
          content: `Incident evidence: error signature ${parsed.errorSignature} in ${parsed.suspectComponent}, started after deploy ${parsed.suspectDeploy} ("${deployNote}"). Sample: ${parsed.sampleLines[0] ?? ""}. In ONE sentence, state the most likely root cause and whether rollback is the right fix.`,
        },
      ],
    });
    for (const block of msg.content) {
      if (block.type === "text") return block.text.trim();
    }
    return null;
  } catch (e) {
    console.warn("[hypothesis] skipped:", (e as Error).message);
    return null;
  }
}
