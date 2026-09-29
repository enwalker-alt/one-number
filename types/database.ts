export type Profile = { id: string; full_name: string | null; phone_number: string | null; pin_hash: string | null; created_at: string };
export type Contact = { id: string; user_id: string; name: string; email: string; created_at: string };
export type Integration = { id: string; user_id: string; provider: "gmail"; status: "connected" | "disconnected"; created_at: string; updated_at: string };
