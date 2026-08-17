import type { ChatResponse } from '@pantrymind/shared';
import { recall } from './recall';
import { write } from './write';
import { ConverseResponder, type Responder } from './responder';

export * from './recall';
export * from './classify';
export * from './write';
export * from './responder';

const responder: Responder = new ConverseResponder();

/** The full turn: recall -> respond -> write (fire-and-forget) -> return.
 * write() is intentionally not awaited before returning — it must never add
 * latency to the response the user is waiting on. Its own errors are caught
 * and logged rather than surfaced, since a failed write must not surface as
 * a failed chat turn. */
export async function handleTurn(
  userId: string,
  sessionId: string,
  message: string,
): Promise<ChatResponse> {
  const memories = await recall(userId, message);
  const answer = await responder.respond(message, memories);

  write(userId, sessionId, message, answer).catch((err) => {
    console.error('write() failed for this turn:', err);
  });

  return { answer, memories, sessionId };
}
