import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import type { ToolConfiguration } from '@aws-sdk/client-bedrock-runtime';

const lambda = new LambdaClient({ region: process.env.AWS_REGION ?? 'us-east-1' });

/** Bedrock Converse tool specs — mirrors agent/config/action-groups.json, minus
 * user_id (injected server-side in executeTool, never trusted from the model).
 * Cast via `unknown` below: the SDK's `Tool` union type requires a `$unknown`
 * discriminant that plain object literals never carry, even though this exact
 * shape is what Bedrock's wire format expects. */
export const TOOL_CONFIG = {
  tools: [
    {
      toolSpec: {
        name: 'addItem',
        description: "Add a new item to the user's pantry.",
        inputSchema: {
          json: {
            type: 'object',
            required: ['name'],
            properties: {
              name: { type: 'string', description: "Item name, e.g. 'spinach'." },
              quantity: { type: 'number', description: 'Amount of the item.' },
              unit: { type: 'string', description: "Unit for quantity, e.g. 'oz', 'count'." },
              expires_at: { type: 'string', description: 'ISO date the item expires, if known.' },
              category: { type: 'string', description: "Category, e.g. 'produce', 'dairy'." },
            },
          },
        },
      },
    },
    {
      toolSpec: {
        name: 'listItems',
        description: "List all pantry items currently on hand for the user.",
        inputSchema: { json: { type: 'object', properties: {} } },
      },
    },
    {
      toolSpec: {
        name: 'markConsumed',
        description: 'Mark a pantry item as consumed/used up.',
        inputSchema: {
          json: {
            type: 'object',
            required: ['item_id'],
            properties: { item_id: { type: 'string', description: "The pantry item's id." } },
          },
        },
      },
    },
    {
      toolSpec: {
        name: 'markWasted',
        description:
          'Mark a pantry item as wasted/thrown away. Use this when the user says they let something go bad.',
        inputSchema: {
          json: {
            type: 'object',
            required: ['item_id'],
            properties: { item_id: { type: 'string', description: "The pantry item's id." } },
          },
        },
      },
    },
    {
      toolSpec: {
        name: 'getExpiringItems',
        description:
          'Get pantry items expiring soon, sorted most-urgent first. Use this before suggesting recipes so near-expiry items are prioritized.',
        inputSchema: {
          json: {
            type: 'object',
            properties: {
              within_days: { type: 'integer', description: 'Look-ahead window in days. Defaults to 3.' },
            },
          },
        },
      },
    },
    {
      toolSpec: {
        name: 'findRecipes',
        description:
          "Find recipes that can be made from the given ingredients, ranked to prioritize using up near-expiry items. Always pass 'exclude' when a recalled memory names an ingredient the user dislikes or avoids.",
        inputSchema: {
          json: {
            type: 'object',
            required: ['ingredients', 'near_expiry'],
            properties: {
              ingredients: {
                type: 'array',
                items: { type: 'string' },
                description: 'Pantry item names available to cook with.',
              },
              near_expiry: {
                type: 'array',
                items: { type: 'string' },
                description: 'Subset of ingredients that are near-expiry, used for ranking.',
              },
              exclude: {
                type: 'array',
                items: { type: 'string' },
                description: 'Disliked or avoided ingredients from recalled memory, to filter out.',
              },
            },
          },
        },
      },
    },
    {
      toolSpec: {
        name: 'buildShoppingList',
        description:
          "Given a set of chosen recipes, return the ingredients still needed that aren't already in the pantry.",
        inputSchema: {
          json: {
            type: 'object',
            required: ['recipe_ids'],
            properties: {
              recipe_ids: {
                type: 'array',
                items: { type: 'string' },
                description: 'IDs of the recipes the user wants to cook.',
              },
            },
          },
        },
      },
    },
  ],
} as unknown as ToolConfiguration;

const PANTRY_ACTIONS = new Set(['addItem', 'listItems', 'markConsumed', 'markWasted', 'getExpiringItems']);

async function invoke(functionName: string, payload: unknown): Promise<unknown> {
  const res = await lambda.send(
    new InvokeCommand({
      FunctionName: functionName,
      Payload: Buffer.from(JSON.stringify(payload)),
    }),
  );
  const raw = res.Payload ? JSON.parse(Buffer.from(res.Payload).toString('utf-8')) : null;
  if (res.FunctionError || !raw || raw.statusCode >= 400) {
    throw new Error(`${functionName} tool call failed: ${raw?.body ?? res.FunctionError ?? 'unknown error'}`);
  }
  return JSON.parse(raw.body);
}

/** Executes one tool call by name, injecting the real user_id server-side —
 * the model is never trusted to supply it, so it can't act on another user's data. */
export async function executeTool(userId: string, name: string, input: Record<string, unknown>): Promise<unknown> {
  if (PANTRY_ACTIONS.has(name)) {
    const params =
      name === 'addItem'
        ? { ...input, user_id: userId }
        : name === 'markConsumed' || name === 'markWasted'
          ? { item_id: input.item_id, user_id: userId }
          : { ...input, user_id: userId };
    return invoke('pantrymind-pantry', { action: name, params });
  }

  if (name === 'findRecipes') {
    return invoke('pantrymind-recipes', input);
  }

  if (name === 'buildShoppingList') {
    return invoke('pantrymind-shopping-list', { ...input, user_id: userId });
  }

  throw new Error(`Unknown tool: ${name}`);
}
