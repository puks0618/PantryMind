'use client';

import { useCallback, useEffect, useState } from 'react';
import styles from './SessionList.module.css';

interface SessionSummary {
  sessionId: string;
  title: string;
  lastAt: string;
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const diffMin = Math.round((Date.now() - then) / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  return `${Math.round(diffDay / 30)}mo ago`;
}

interface SessionListProps {
  activeId?: string;
  /** Bumped by the parent after every completed chat turn, so a brand new
   * session (or a bumped last-activity time) shows up without waiting for
   * the poll interval. */
  version: number;
  onSelect: (sessionId: string) => void;
  onNewChat: () => void;
}

/** Cross-session recall only means something if you can actually see the
 * sessions — this is what lets you demo "new session, same memory" without
 * relying on an incognito window and a leap of faith. */
export function SessionList({ activeId, version, onSelect, onNewChat }: SessionListProps) {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/sessions');
      if (res.ok) setSessions((await res.json()) as SessionSummary[]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh, version]);

  useEffect(() => {
    const interval = setInterval(() => void refresh(), 8000);
    return () => clearInterval(interval);
  }, [refresh]);

  return (
    <aside className={styles.pane} aria-label="Chat sessions">
      <div className={styles.headingRow}>
        <h2 className={styles.heading}>Sessions</h2>
      </div>

      <button type="button" className={styles.newChat} onClick={onNewChat}>
        + New chat
      </button>

      {loading && <p className={styles.muted}>Loading&hellip;</p>}
      {!loading && sessions.length === 0 && <p className={styles.muted}>No conversations yet.</p>}

      <ul className={styles.list}>
        {sessions.map((s) => (
          <li key={s.sessionId}>
            <button
              type="button"
              className={s.sessionId === activeId ? styles.itemActive : styles.item}
              onClick={() => onSelect(s.sessionId)}
              aria-current={s.sessionId === activeId}
            >
              <span className={styles.itemTitle}>{s.title || 'New conversation'}</span>
              <span className={styles.itemTime}>{relativeTime(s.lastAt)}</span>
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
