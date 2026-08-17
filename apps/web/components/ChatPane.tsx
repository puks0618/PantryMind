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

/**
 * POSTs to /api/chat as { message, sessionId }. That route is owned by
 * Pukhraj (the memory loop lives there) and doesn't exist yet as of this
 * writing — this is the contract this component assumes.
 */
export function ChatPane() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | undefined>(undefined);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, loading]);

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
      setSessionId(data.sessionId);
      setMessages((prev) => [...prev, { role: 'assistant', content: data.answer, memories: data.memories }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className={styles.pane} aria-label="Chat with PantryMind">
      <div className={styles.scroll} ref={scrollRef}>
        {messages.length === 0 && (
          <div className={styles.empty}>
            <p>Tell me what&rsquo;s in your pantry, or ask what to cook tonight.</p>
          </div>
        )}
        {messages.map((m, i) => (
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
