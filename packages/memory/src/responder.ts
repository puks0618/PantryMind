import { BedrockRuntimeClient, ConverseCommand, type ContentBlock, type Message } from '@aws-sdk/client-bedrock-runtime';
import { pool, type RecalledMemory } from '@pantrymind/shared';
import { SYSTEM_PROMPT } from './system-prompt';
import { TOOL_CONFIG, executeTool } from './tools';

const client = new BedrockRuntimeClient({ region: process.env.AWS_REGION ?? 'us-east-1' });
const MODEL_ID = process.env.BEDROCK_CHAT_MODEL_ID ?? 'us.anthropic.claude-sonnet-4-5-20250929-v1:0';

// Bounds the recall -> respond turn if the model keeps chaining tool calls.
const MAX_TOOL_ROUNDS = 4;

// The shared system prompt's "Acknowledge new preferences and feedback" section tells the model
// it doesn't need to take an action for preferences (true — that's write()'s job). Left alone,
// the model over-generalizes that to pantry actions too and just says "done" without calling
// addItem/markConsumed/markWasted — confirmed live: zero tool-use stop reasons, zero Lambda
// invocations, for a request that should have called addItem. This forces the distinction.
const TOOLS_REQUIRED_NOTE =
  'Clarification on the note above: that applies ONLY to preferences/feedback/waste patterns, ' +
  'which really do persist automatically after this turn. It does NOT apply to pantry actions. ' +
  'If the user asks you to add an item, adjust a quantity, mark something consumed or wasted, find ' +
  'recipes, or build a shopping list, you MUST call the matching tool in this turn and use its ' +
  'actual result. Never say an item was added, updated, marked, or found unless the corresponding ' +
  'tool call actually returned success — a verbal-only confirmation with no tool call is a bug, not ' +
  'a shortcut. This applies especially to numbers: never state a new quantity, weight, or count ' +
  'unless it came back from a real updateItem/addItem call. If you do not have an exact figure, ask ' +
  'the user for one instead of estimating and presenting the estimate as if it were saved.';

/** Direct Bedrock Converse call with real tool-calling against the deployed
 * pantry/recipes/shopping-list Lambdas (see tools.ts) — the fallback path used
 * until the Bedrock Agent (#22, permanently descoped — account-level AWS
 * Maintenance Mode) exists. Swap in an AgentResponder later without touching
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

    const messages: Message[] = [
      { role: 'user', content: [{ text: `${pantryBlock}\n\n${memoryBlock}\n\nUser: ${input}` }] },
    ];

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const res = await client.send(
        new ConverseCommand({
          modelId: MODEL_ID,
          system: [{ text: SYSTEM_PROMPT }, { text: TOOLS_REQUIRED_NOTE }],
          messages,
          toolConfig: TOOL_CONFIG,
          inferenceConfig: { maxTokens: 500, temperature: 0.4 },
        }),
      );

      const message = res.output?.message;
      if (!message) return '';

      if (res.stopReason !== 'tool_use') {
        return message.content?.find((c) => c.text)?.text ?? '';
      }

      messages.push(message);

      const toolUseBlocks = (message.content ?? []).filter((c) => c.toolUse);
      const toolResults: ContentBlock[] = await Promise.all(
        toolUseBlocks.map(async (c) => {
          const toolUse = c.toolUse!;
          try {
            const result = await executeTool(userId, toolUse.name ?? '', (toolUse.input as Record<string, unknown>) ?? {});
            // Bedrock requires toolResult.json to be a JSON *object* — several tools (listItems,
            // getExpiringItems, findRecipes, buildShoppingList) return arrays, which Bedrock
            // rejects outright ("Provide a json object for the field"). Wrap uniformly.
            return {
              toolResult: { toolUseId: toolUse.toolUseId, content: [{ json: { result } }] },
            } as unknown as ContentBlock;
          } catch (err) {
            return {
              toolResult: {
                toolUseId: toolUse.toolUseId,
                content: [{ text: err instanceof Error ? err.message : 'Tool call failed.' }],
                status: 'error' as const,
              },
            } as unknown as ContentBlock;
          }
        }),
      );

      messages.push({ role: 'user', content: toolResults });
    }

    return "That took more steps than expected — could you try rephrasing?";
  }
}
