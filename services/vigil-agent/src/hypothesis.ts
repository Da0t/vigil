import type { ParsedLogs } from "../../../src/lib/contract";

/**
 * Optional LLM root-cause hypothesis. No-op unless OPENAI_API_KEY is set, so
 * the demo runs identically with or without it. Called with fetch (no SDK
 * dependency) against the OpenAI Chat Completions API.
 *
 * Model defaults to gpt-4o-mini (fast + cheap, plenty for one sentence);
 * override with OPENAI_MODEL. Any failure is swallowed and returns null so a
 * bad key or a rate limit never breaks the incident loop.
 */
const OPENAI_MODEL = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

export async function hypothesize(parsed: ParsedLogs, deployNote: string): Promise<string | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        max_tokens: 150,
        temperature: 0.2,
        messages: [
          {
            role: "system",
            content: "You are an SRE assistant. Answer in exactly one concise sentence.",
          },
          {
            role: "user",
            content: `Incident evidence: error signature ${parsed.errorSignature} in ${parsed.suspectComponent}, started after deploy ${parsed.suspectDeploy} ("${deployNote}"). Sample: ${parsed.sampleLines[0] ?? ""}. In ONE sentence, state the most likely root cause and whether rollback is the right fix.`,
          },
        ],
      }),
    });
    if (!r.ok) {
      console.warn(`[hypothesis] skipped: OpenAI HTTP ${r.status} ${await r.text().catch(() => "")}`);
      return null;
    }
    const data = (await r.json()) as { choices?: { message?: { content?: string } }[] };
    const text = data.choices?.[0]?.message?.content?.trim();
    return text || null;
  } catch (e) {
    console.warn("[hypothesis] skipped:", (e as Error).message);
    return null;
  }
}
