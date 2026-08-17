import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

const client = new BedrockRuntimeClient({ region: process.env.AWS_REGION ?? 'us-east-1' });
const MODEL_ID = process.env.BEDROCK_EMBED_MODEL_ID ?? 'amazon.titan-embed-text-v2:0';

/** Embeds a string via Titan V2. Returns null on any failure — a failed
 * embedding must not break the chat turn it's part of. */
export async function embed(text: string): Promise<number[] | null> {
  try {
    const res = await client.send(
      new InvokeModelCommand({
        modelId: MODEL_ID,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({ inputText: text }),
      }),
    );
    const body = JSON.parse(new TextDecoder().decode(res.body));
    return body.embedding as number[];
  } catch (err) {
    console.error('embed() failed:', err instanceof Error ? err.message : err);
    return null;
  }
}
