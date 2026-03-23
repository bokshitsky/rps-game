export type PieceType = "rock" | "paper" | "scissors";
export type PlayerId = 1 | 2;
export type Phase = "waiting" | "setup" | "turn" | "battle_pick" | "game_over";
export type KnownType = PieceType | "hidden";
export type ViewMode = "home" | "connecting" | "room" | "error";

export interface VisiblePiece {
  id: string;
  owner: PlayerId;
  col: number;
  row: number;
  knownType: KnownType;
}

export interface BattleState {
  chooser: PlayerId;
  round: number;
}

export interface SetupState {
  yourReady: boolean;
  opponentReady: boolean;
}

export interface RoomSnapshot {
  roomId: string;
  phase: Phase;
  yourPlayerId: PlayerId;
  playerToken: string;
  currentPlayer: PlayerId | null;
  selectedPieceId: string | null;
  winner: PlayerId | null;
  setup: SetupState;
  battle: BattleState | null;
  message: string;
  lastBattleSummary: string;
  connectedPlayers: number;
  requiredPlayers: number;
  parameters: {
    preset: string;
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
