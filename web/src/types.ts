export type TileData = {
  id: number;
  isJoker: boolean;
  label: string;
  color: string;
  rank: number | null;
};

export type JokerBindingData = {
  jokerId: number;
  color: string;
  rank: number;
};

export type MeldData = {
  kind: "group" | "run";
  tiles: TileData[];
  bindings: JokerBindingData[];
  label: string;
};

export type GameView = {
  playerId: number;
  rack: TileData[];
  table: { melds: MeldData[]; hash: string; label: string };
  rackSizes: number[];
  poolSize: number;
  current: number;
  hasInitialMeld: boolean[];
  scores: number[];
  names: string[];
  isBot: boolean[];
  difficulties: (string | null)[];
  over: boolean;
  winner: number | null;
  seed: number | null;
  round: number;
  roundPoints: number[];
  rackValues: number[];
  matchOver: boolean;
  history: {
    playerId: number;
    playerName: string;
    isBot: boolean;
    type: string;
    tilesFromRack: TileData[];
    tableHash: string;
    rackSize: number;
    drawn: boolean;
    openSlots?: { color: number; rank: number }[];
  }[];
};

export type BotDecision = {
  action: string;
  score: number;
  reasons: Record<string, number>;
  initialHand: string;
  initialTable: string;
  finalTable: string;
  played: string;
  searchDepth: number;
  statesEvaluated: number;
  cacheHits: number;
  simulations: number;
  timeMs: number;
  difficulty: string;
  topCandidates: {
    action: string;
    score: number;
    rackUsed: string;
    tilesPlayed: number;
  }[];
  log: string;
};

export type GameEvent = {
  playerId: number;
  playerName: string;
  isBot: boolean;
  type: string;
  tilesFromRack: TileData[];
  tableHash: string;
  rackSize: number;
  drawn: boolean;
  openSlots?: { color: number; rank: number }[];
};

export type GameStep = {
  event: GameEvent | null;
  view: GameView;
  yourTurn: boolean;
  lastDecision: BotDecision | null;
};

export type GamePayload = {
  id: string;
  view: GameView;
  lastDecision: BotDecision | null;
  yourTurn: boolean;
  spectator?: boolean;
  steps?: GameStep[];
  /** Online only: one flag per seat. Absent in local games. */
  connected?: boolean[];
};
