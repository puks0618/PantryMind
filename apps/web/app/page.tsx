import { ChatPane } from '@/components/ChatPane';
import { PantryList } from '@/components/PantryList';
import styles from './page.module.css';

export default function Home() {
  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <h1 className={styles.wordmark}>PantryMind</h1>
        <p className={styles.tagline}>Remembers what you actually cook.</p>
      </header>
      <div className={styles.layout}>
        <ChatPane />
        <PantryList />
      </div>
    </main>
  );
}
