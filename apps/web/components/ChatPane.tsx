'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { RecalledMemory } from '@pantrymind/shared';
import { MemoryInspector } from './MemoryInspector';
import styles from './ChatPane.module.css';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  memories?: RecalledMemory[];
}

interface ChatApiResponse {
  answer: string;
  memories: RecalledMemory[];
  sessionId: string;
}

interface ChatPaneProps {
  /** Controlled by the parent — set from localStorage on mount, or from
   * picking a conversation in SessionList. */
  sessionId?: string;
  /** Fired once a turn completes, with whatever sessionId the server used
   * (a fresh one on the first message of a new conversation, the same one
   * afterward). */
  onTurnComplete: (sessionId: string) => void;
}

/** POSTs to /api/chat as { message, sessionId }. */
export function ChatPane({ sessionId, onTurnComplete }: ChatPaneProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Tracks the session this pane's `messages` state actually reflects. When
  // `sessionId` changes because *we* just produced it (first message of a
  // new conversation, or a normal follow-up), this ref already matches and
  // the history-fetch effect below is a no-op — otherwise it'd immediately
  // re-fetch and could race the not-yet-committed write() from the turn we
  // just rendered locally. It only actually fetches when the change came
  // from outside (the user picked a different session in the sidebar, or
  // it was just restored from localStorage on mount).
  const loadedSessionRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, loading]);

  useEffect(() => {
    if (sessionId === loadedSessionRef.current) return;
    loadedSessionRef.current = sessionId;

    if (!sessionId) {
      setMessages([]);
      return;
    }

    let cancelled = false;
    setLoadingHistory(true);
    setError(null);
    fetch(`/api/sessions/${sessionId}`)
      .then((res) => (res.ok ? (res.json() as Promise<ChatMessage[]>) : Promise.reject(new Error('Could not load conversation'))))
      .then((history) => {
        if (!cancelled) setMessages(history);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load conversation');
      })
      .finally(() => {
        if (!cancelled) setLoadingHistory(false);
      });

    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || loading) return;

    setMessages((prev) => [...prev, { role: 'user', content: text }]);
    setInput('');
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, sessionId }),
      });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const data: ChatApiResponse = await res.json();
      loadedSessionRef.current = data.sessionId;
      setMessages((prev) => [...prev, { role: 'assistant', content: data.answer, memories: data.memories }]);
      onTurnComplete(data.sessionId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className={styles.pane} aria-label="Chat with PantryMind">
      <div className={styles.scroll} ref={scrollRef}>
        {loadingHistory && (
          <div className={styles.empty}>
            <p>Loading conversation&hellip;</p>
          </div>
        )}
        {!loadingHistory && messages.length === 0 && (
          <div className={styles.empty}>
            <p>Tell me what&rsquo;s in your pantry, or ask what to cook tonight.</p>
          </div>
        )}
        {!loadingHistory &&
          messages.map((m, i) => (
            <div key={i} className={m.role === 'user' ? styles.rowUser : styles.rowAssistant}>
              <div className={m.role === 'user' ? styles.bubbleUser : styles.bubbleAssistant}>{m.content}</div>
              {m.role === 'assistant' && m.memories && <MemoryInspector memories={m.memories} />}
            </div>
          ))}
        {loading && (
          <div className={styles.rowAssistant}>
            <div className={styles.bubbleAssistant}>
              <span className={styles.typing} aria-label="PantryMind is thinking" role="status">
                <span />
                <span />
                <span />
              </span>
            </div>
          </div>
        )}
        {error && <p className={styles.error}>{error}</p>}
      </div>
      <form className={styles.form} onSubmit={handleSubmit}>
        <input
          className={styles.input}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask what to cook, or add an item…"
          aria-label="Message"
          disabled={loading}
        />
        <button className={styles.send} type="submit" disabled={loading || !input.trim()}>
          Send
        </button>
      </form>
    </section>
  );
}
