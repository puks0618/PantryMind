import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { pool, type RecalledMemory } from '@pantrymind/shared';
import { SYSTEM_PROMPT } from './system-prompt';

const client = new BedrockRuntimeClient({ region: process.env.AWS_REGION ?? 'us-east-1' });
const MODEL_ID = process.env.BEDROCK_CHAT_MODEL_ID ?? 'us.anthropic.claude-sonnet-4-5-20250929-v1:0';

// ConverseResponder has no live tool-calling wired up (that's what the Bedrock Agent, #22, is
// for) - without this note, the model tries to invoke the tools the shared system prompt
// describes and leaks raw function-call-looking text into the reply instead of a real call.
const NO_TOOLS_NOTE =
  'Note: in this mode you have no live tool-calling access. Never emit function-call, ' +
  'tool-invocation, or code-like syntax - answer directly from the pantry contents and recalled ' +
  'memories below. If the user asks you to add, remove, or mark a pantry item, acknowledge it in ' +
  'plain language the same way you already do for preferences; the actual update is not wired up ' +
  'in this mode yet.';

/** Direct Bedrock Converse call — the fallback path used until the Bedrock
 * Agent (#22) exists. Swap in an AgentResponder later without touching
 * handleTurn()'s shape: both implement respond(). */
export interface Responder {
  respond(userId: string, input: string, memories: RecalledMemory[]): Promise<string>;
}

interface PantryItemSummary {
  name: string;
  quantity: string | null;
  unit: string | null;
  expires_at: string | null;
}

async function fetchPantryContents(userId: string): Promise<PantryItemSummary[]> {
  const { rows } = await pool.query(
    `SELECT name, quantity, unit, expires_at
     FROM pantry_items
     WHERE user_id = $1 AND status = 'active'
     ORDER BY expires_at ASC NULLS LAST`,
    [userId],
  );
  return rows;
}

function formatPantryBlock(items: PantryItemSummary[]): string {
  if (items.length === 0) return 'The pantry is currently empty.';
  return `Current pantry (soonest-expiring first):\n${items
    .map((i) => {
      const qty = [i.quantity, i.unit].filter(Boolean).join(' ');
      const expiry = i.expires_at ? ` — expires ${new Date(i.expires_at).toISOString().slice(0, 10)}` : '';
      return `- ${i.name}${qty ? ` (${qty})` : ''}${expiry}`;
    })
    .join('\n')}`;
}

export class ConverseResponder implements Responder {
  async respond(userId: string, input: string, memories: RecalledMemory[]): Promise<string> {
    const memoryBlock =
      memories.length > 0
        ? `Recalled memories (most similar first):\n${memories
            .map((m) => `- "${m.content}" (similarity ${m.similarity.toFixed(2)}, ${m.created_at})`)
            .join('\n')}`
        : 'No relevant memories were recalled for this message.';

    const pantryBlock = formatPantryBlock(await fetchPantryContents(userId));

    const res = await client.send(
      new ConverseCommand({
        modelId: MODEL_ID,
        system: [{ text: SYSTEM_PROMPT }, { text: NO_TOOLS_NOTE }],
        messages: [
          { role: 'user', content: [{ text: `${pantryBlock}\n\n${memoryBlock}\n\nUser: ${input}` }] },
        ],
        inferenceConfig: { maxTokens: 500, temperature: 0.4 },
      }),
    );

    return res.output?.message?.content?.[0]?.text ?? '';
  }
}
