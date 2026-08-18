export type ItemStatus = 'active' | 'consumed' | 'wasted';
export type MemoryKind = 'preference' | 'feedback' | 'action' | 'chatter';

export interface PantryItem {
  id: string;
  user_id: string;
  name: string;
  category: string | null;
  quantity: number | null;
  unit: string | null;
  added_at: string;
  expires_at: string | null;   // YYYY-MM-DD
  status: ItemStatus;
}

export interface Recipe {
  id: string;
  external_id: string | null;
  title: string;
  /**
   * `quantity` + `unit` were added so cooking a recipe can deduct the right
   * amount from the pantry — `amount` is free text and can't be subtracted.
   * Both are optional and additive: existing readers (shopping-list only uses
   * `name`) are unaffected.
   */
  ingredients: { name: string; amount?: string; quantity?: number | null; unit?: string | null }[];
  instructions: string | null;
  source_url: string | null;
}

export interface Interaction {
  id: string;
  user_id: string;
  session_id: string;
  role: 'user' | 'assistant';
  content: string;
  summary: string | null;
  kind: MemoryKind | null;
  created_at: string;
}

/** A memory retrieved by similarity search, as returned to the UI. */
export interface RecalledMemory {
  content: string;
  created_at: string;
  distance: number;    // cosine distance from `<=>`: 0 = identical
  similarity: number;  // 1 - distance, for display
}

/** The response shape of POST /api/chat — Track B's ChatPane consumes this. */
export interface ChatResponse {
  answer: string;
  memories: RecalledMemory[];
  sessionId: string;
}
