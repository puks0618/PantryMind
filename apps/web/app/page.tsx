'use client';

import { useEffect, useState } from 'react';
import { ChatPane } from '@/components/ChatPane';
import { PantryList } from '@/components/PantryList';
import { SessionList } from '@/components/SessionList';
import styles from './page.module.css';

const SESSION_STORAGE_KEY = 'pantrymind_session_id';

export default function Home() {
  const [sessionId, setSessionId] = useState<string | undefined>(undefined);
  const [sessionsVersion, setSessionsVersion] = useState(0);

  // Restored after mount, not read synchronously — localStorage isn't
  // available during SSR, and this keeps the id (and therefore the loaded
  // transcript) alive across a page refresh.
  useEffect(() => {
    const saved = window.localStorage.getItem(SESSION_STORAGE_KEY);
    if (saved) setSessionId(saved);
  }, []);

  function selectSession(id: string | undefined) {
    setSessionId(id);
    if (id) {
      window.localStorage.setItem(SESSION_STORAGE_KEY, id);
    } else {
      window.localStorage.removeItem(SESSION_STORAGE_KEY);
    }
  }

  /** Called by ChatPane once a turn completes — bumps the sidebar so a brand
   * new session (or refreshed last-activity time) appears immediately. */
  function handleTurnComplete(newSessionId: string) {
    if (newSessionId !== sessionId) selectSession(newSessionId);
    setSessionsVersion((v) => v + 1);
  }

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <h1 className={styles.wordmark}>PantryMind</h1>
        <p className={styles.tagline}>Remembers what you actually cook.</p>
      </header>
      <div className={styles.layout}>
        <SessionList
          activeId={sessionId}
          version={sessionsVersion}
          onSelect={selectSession}
          onNewChat={() => selectSession(undefined)}
        />
        <ChatPane sessionId={sessionId} onTurnComplete={handleTurnComplete} />
        <PantryList />
      </div>
    </main>
  );
}
