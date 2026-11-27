export type Participant = {
  id: string;
  display_name: string;
  last_balance: number | null;
  last_equity: number | null;
  starting_balance: number;
  last_seen: string | null;
  is_connected: boolean;
};

export type TradeFeedItem = {
  id: number;
  display_name: string;
  symbol: string | null;
  deal_type: string | null;
  entry_type: string | null;
  volume: number | null;
  price: number | null;
  profit: number | null;
  deal_time: string | null;
};

export type ArenaAlert = {
  id: number;
  display_name: string;
  severity: "info" | "warning" | "violation";
  title: string;
  message: string;
  created_at: string;
  acknowledged: boolean;
};
