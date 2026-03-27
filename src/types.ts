export type PieceType = "rock" | "paper" | "scissors";
export type PieceKind = PieceType | "king";
export type PlayerId = 1 | 2;
export type Phase = "waiting" | "setup" | "turn" | "battle_pick" | "game_over";
export type KnownType = PieceKind | "hidden";
export type ViewMode = "home" | "connecting" | "room" | "error";

export interface VisiblePiece {
  id: string;
  owner: PlayerId;
  col: number;
  row: number;
  knownType: KnownType;
  forbiddenReturnCol?: number | null;
  forbiddenReturnRow?: number | null;
}

export interface BattleState {
  attackerId: string | null;
  defenderId: string | null;
  attackerType: PieceKind | null;
  defenderType: PieceKind | null;
  round: number;
  yourLocked: boolean;
  opponentLocked: boolean;
}

export interface AnimationHint {
  id: number;
  kind: "move" | "attack";
  pieceId?: string;
  fromCol?: number;
  fromRow?: number;
  toCol?: number;
  toRow?: number;
  attackerId?: string;
  defenderId?: string;
  attackerType?: PieceKind;
  defenderType?: PieceKind;
  attackerFromCol?: number;
  attackerFromRow?: number;
  defenderFromCol?: number;
  defenderFromRow?: number;
  winnerId?: string | null;
}

export interface SetupState {
  yourReady: boolean;
  opponentReady: boolean;
}

export interface RestartState {
  requestedByYou: boolean;
  awaitingYourDecision: boolean;
}

export interface PlayerTimer {
  remainingMs: number;
  running: boolean;
  started: boolean;
}

export interface RoomSnapshot {
  roomId: string;
  snapshotTimeMs: number;
  phase: Phase;
  yourPlayerId: PlayerId;
  playerToken: string;
  currentPlayer: PlayerId | null;
  selectedPieceId: string | null;
  winner: PlayerId | null;
  setup: SetupState;
  battle: BattleState | null;
  restart: RestartState | null;
  animationHint: AnimationHint | null;
  message: string;
  lastBattleSummary: string;
  connectedPlayers: number;
  requiredPlayers: number;
  parameters: {
    preset: "standard" | "king";
    victoryTarget: number;
    timeLimitMinutes: number;
  };
  timers: {
    player1: PlayerTimer;
    player2: PlayerTimer;
  };
  canAct: boolean;
  counts: {
    player1: number;
    player2: number;
  };
  visiblePieces: VisiblePiece[];
}

declare global {
  interface Window {
    render_game_to_text: () => string;
    advanceTime: (ms: number) => void;
  }
}
