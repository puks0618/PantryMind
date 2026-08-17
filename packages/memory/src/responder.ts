import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import type { RecalledMemory } from '@pantrymind/shared';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const client = new BedrockRuntimeClient({ region: process.env.AWS_REGION ?? 'us-east-1' });
const MODEL_ID = process.env.BEDROCK_CHAT_MODEL_ID ?? 'us.anthropic.claude-sonnet-4-5-20250929-v1:0';

const SYSTEM_PROMPT = readFileSync(
  join(__dirname, '..', '..', '..', 'agent', 'config', 'system-prompt.md'),
  'utf8',
);

/** Direct Bedrock Converse call — the fallback path used until the Bedrock
 * Agent (#22) exists. Swap in an AgentResponder later without touching
 * handleTurn()'s shape: both implement respond(). */
export interface Responder {
  respond(input: string, memories: RecalledMemory[]): Promise<string>;
}

export class ConverseResponder implements Responder {
  async respond(input: string, memories: RecalledMemory[]): Promise<string> {
    const memoryBlock =
      memories.length > 0
        ? `Recalled memories (most similar first):\n${memories
            .map((m) => `- "${m.content}" (similarity ${m.similarity.toFixed(2)}, ${m.created_at})`)
            .join('\n')}`
        : 'No relevant memories were recalled for this message.';

    const res = await client.send(
      new ConverseCommand({
        modelId: MODEL_ID,
        system: [{ text: SYSTEM_PROMPT }],
        messages: [{ role: 'user', content: [{ text: `${memoryBlock}\n\nUser: ${input}` }] }],
        inferenceConfig: { maxTokens: 500, temperature: 0.4 },
      }),
    );

    return res.output?.message?.content?.[0]?.text ?? '';
  }
}
