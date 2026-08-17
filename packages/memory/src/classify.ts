import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import type { MemoryKind } from '@pantrymind/shared';

const client = new BedrockRuntimeClient({ region: process.env.AWS_REGION ?? 'us-east-1' });
const MODEL_ID = process.env.BEDROCK_CLASSIFY_MODEL_ID ?? 'us.anthropic.claude-haiku-4-5-20251001-v1:0';

const SYSTEM_PROMPT = `Classify the user's message into exactly one kind:
- "preference": a durable like/dislike/dietary rule that should be remembered indefinitely
- "feedback": a reaction to something specific that already happened (a meal, a suggestion, a waste event)
- "action": the user stated they did something (added/used/threw out an item) with no durable preference attached
- "chatter": anything else — questions, small talk, requests that carry no durable fact

If the kind is not "chatter", also write a one-sentence third-person summary of the durable fact,
suitable for embedding and recalling in a future session (e.g. "User dislikes cilantro.").

Respond with ONLY a JSON object, no other text: {"kind": "...", "summary": "..." | null}`;

/** Classifies one exchange. On any failure, defaults to chatter so a bad
 * classification degrades quietly instead of breaking the turn. */
export async function classify(
  userMessage: string,
  assistantAnswer: string,
): Promise<{ kind: MemoryKind; summary: string | null }> {
  try {
    const res = await client.send(
      new ConverseCommand({
        modelId: MODEL_ID,
        system: [{ text: SYSTEM_PROMPT }],
        messages: [
          {
            role: 'user',
            content: [{ text: `User: ${userMessage}\nAssistant: ${assistantAnswer}` }],
          },
        ],
        inferenceConfig: { maxTokens: 200, temperature: 0 },
      }),
    );

    const raw = res.output?.message?.content?.[0]?.text ?? '';
    const text = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    const parsed = JSON.parse(text);
    const kind: MemoryKind = ['preference', 'feedback', 'action', 'chatter'].includes(parsed.kind)
      ? parsed.kind
      : 'chatter';
    return { kind, summary: kind === 'chatter' ? null : (parsed.summary ?? null) };
  } catch (err) {
    console.error('classify() failed, defaulting to chatter:', err instanceof Error ? err.message : err);
    return { kind: 'chatter', summary: null };
  }
}
