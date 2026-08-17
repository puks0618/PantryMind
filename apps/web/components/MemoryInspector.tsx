import type { RecalledMemory } from '@pantrymind/shared';
import styles from './MemoryInspector.module.css';

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

/**
 * The demo centerpiece: shows which memories the agent actually recalled for
 * this turn, and how strongly. Renders nothing on chatter turns where nothing
 * was recalled — the panel appearing at all is itself a signal.
 */
export function MemoryInspector({ memories }: { memories: RecalledMemory[] }) {
  if (!memories || memories.length === 0) return null;

  return (
    <div className={styles.wrap}>
      <span className={styles.label}>Recalled from memory</span>
      <ul className={styles.list}>
        {memories.map((m, i) => (
          <li key={i} className={styles.chip}>
            <span className={styles.content}>&ldquo;{m.content}&rdquo;</span>
            <span className={styles.meta}>
              {Math.round(m.similarity * 100)}% match &middot; {relativeTime(m.created_at)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
