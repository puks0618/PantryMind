import { NextResponse } from 'next/server';
import { resolveDemoUserId, demoUserHandle } from '@pantrymind/shared';
import { handleTurn } from '@pantrymind/memory';

/** POST /api/chat — the memory loop. Ten lines, no logic; handleTurn() owns the work. */
export async function POST(req: Request) {
  try {
    const { message, sessionId } = await req.json();
    const userId = await resolveDemoUserId();
    if (!userId) {
      return NextResponse.json({ error: `No user with handle '${demoUserHandle()}'` }, { status: 404 });
    }

    const result = await handleTurn(userId, sessionId ?? crypto.randomUUID(), message);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
