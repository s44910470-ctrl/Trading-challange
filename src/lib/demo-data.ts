import type { Participant, TradeFeedItem, ArenaAlert } from "./types";

export const demoParticipants: Participant[] = [
  { id: "demo-you", display_name: "You", last_balance: 50, last_equity: 50, starting_balance: 50, last_seen: null, is_connected: false },
  { id: "demo-friend", display_name: "Friend", last_balance: 50, last_equity: 50, starting_balance: 50, last_seen: null, is_connected: false }
];
export const demoTrades: TradeFeedItem[] = [];
export const demoAlerts: ArenaAlert[] = [
  { id: 1, display_name: "System", severity: "info", title: "Waiting for MT5 connectors", message: "Connect both Windows MT5 terminals to begin receiving verified account data.", created_at: new Date().toISOString(), acknowledged: false }
];
