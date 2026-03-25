import Phaser from "phaser";

import {
  boardCols,
  boardDark,
  boardHeight,
  boardLight,
  boardRows,
  boardWidth,
  cellSize,
} from "./constants";
import { paintPieceSprite as paintSharedPieceSprite, pieceTextureSize } from "./pieceArt";
import type { KnownType, PlayerId, RoomSnapshot, VisiblePiece } from "./types";

const previewTypesTop: KnownType[] = [
  "rock",
  "paper",
  "scissors",
  "rock",
  "paper",
  "scissors",
  "rock",
  "paper",
  "scissors",
  "rock",
  "paper",
  "scissors",
  "rock",
  "paper",
  "scissors",
  "rock",
];

const previewTypesBottom: KnownType[] = [
  "scissors",
  "paper",
  "rock",
  "scissors",
  "paper",
  "rock",
  "scissors",
  "paper",
  "rock",
  "scissors",
  "paper",
  "rock",
  "scissors",
  "paper",
  "rock",
  "paper",
];

const previewPieces: VisiblePiece[] = [
  ...buildPreviewPieces(2, previewTypesTop, [0, 1]),
  ...buildPreviewPieces(1, previewTypesBottom, [5, 4]),
];

function buildPreviewPieces(
  owner: PlayerId,
  types: KnownType[],
  rows: [number, number],
): VisiblePiece[] {
  return types.map((knownType, index) => ({
    id: `preview-${owner}-${index}`,
    owner,
    knownType,
    col: index % boardCols,
    row: rows[Math.floor(index / boardCols)],
  }));
}

export interface BoardSceneDeps {
  getSnapshot: () => RoomSnapshot | null;
  getSelectedPieceId: () => string | null;
  onBoardClick: (col: number, row: number) => void;
  onSceneReady: (scene: { renderState: () => void }) => void;
}

export function createBoardScene(deps: BoardSceneDeps): typeof Phaser.Scene {
  return class BoardScene extends Phaser.Scene {
    private dynamicObjects: Phaser.GameObjects.GameObject[] = [];

    constructor() {
      super("board");
    }

    create(): void {
      deps.onSceneReady(this);
      this.createPieceTextures();
      this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
        if (pointer.x >= boardWidth || pointer.y >= boardHeight) {
          return;
        }
        const displayCol = Phaser.Math.Clamp(Math.floor(pointer.x / cellSize), 0, boardCols - 1);
        const displayRow = Phaser.Math.Clamp(Math.floor(pointer.y / cellSize), 0, boardRows - 1);
        const { col, row } = this.toLogicalCoords(displayCol, displayRow);
        deps.onBoardClick(col, row);
      });
      this.renderState();
    }

    renderState(): void {
      this.dynamicObjects.forEach((item) => item.destroy());
      this.dynamicObjects = [];

      this.drawBoard();
      this.drawPieces();
    }

    private keep<T extends Phaser.GameObjects.GameObject>(item: T): T {
      this.dynamicObjects.push(item);
      return item;
    }

    private drawBoard(): void {
      const board = this.keep(this.add.graphics());
      board.fillGradientStyle(0xc8dd6b, 0xa6c321, 0xa6c321, 0xc8dd6b, 1);
      board.fillRect(0, 0, boardWidth, boardHeight);

      for (let row = 0; row < boardRows; row += 1) {
        for (let col = 0; col < boardCols; col += 1) {
          const color = (row + col) % 2 === 0 ? boardLight : boardDark;
          const alpha = (row + col) % 2 === 0 ? 0.92 : 0.82;
          board.fillStyle(color, alpha);
          board.fillRect(col * cellSize, row * cellSize, cellSize, cellSize);
          board.lineStyle(1, 0xf7f8da, 0.35);
          board.strokeRect(col * cellSize, row * cellSize, cellSize, cellSize);
        }
      }

      const snapshot = deps.getSnapshot();
      const selectablePieces =
        snapshot?.phase === "turn" && snapshot.canAct
          ? snapshot.visiblePieces.filter((piece) => piece.owner === snapshot.yourPlayerId)
          : [];

      for (const piece of selectablePieces) {
        const display = this.toDisplayCoords(piece.col, piece.row);
        board.lineStyle(3, 0xfff7d6, 0.95);
        board.strokeRect(display.col * cellSize + 8, display.row * cellSize + 8, cellSize - 16, cellSize - 16);
      }

      const selectedPieceId = deps.getSelectedPieceId();
      if (selectedPieceId) {
        const selected = snapshot?.visiblePieces.find((piece) => piece.id === selectedPieceId);
        if (selected) {
          for (const { col, row } of this.adjacentCells(selected.col, selected.row)) {
            const occupant = snapshot?.visiblePieces.find((piece) => piece.col === col && piece.row === row);
            if (occupant?.owner === selected.owner) {
              continue;
            }
            const displayTarget = this.toDisplayCoords(col, row);
            const isAttack = occupant && occupant.owner !== selected.owner;

            board.fillStyle(isAttack ? 0xdc2626 : 0xf8fafc, isAttack ? 0.26 : 0.18);
            board.fillRect(displayTarget.col * cellSize + 12, displayTarget.row * cellSize + 12, cellSize - 24, cellSize - 24);
            board.lineStyle(4, isAttack ? 0xf87171 : 0xffffff, 0.95);
            board.strokeRect(displayTarget.col * cellSize + 10, displayTarget.row * cellSize + 10, cellSize - 20, cellSize - 20);
          }

          const display = this.toDisplayCoords(selected.col, selected.row);
          board.lineStyle(4, 0xf8fafc, 1);
          board.strokeRect(display.col * cellSize + 4, display.row * cellSize + 4, cellSize - 8, cellSize - 8);
        }
      }
    }

    private drawPieces(): void {
      for (const piece of this.getRenderablePieces()) {
        const display = this.toDisplayCoords(piece.col, piece.row);
        const centerX = display.col * cellSize + cellSize / 2;
        const centerY = display.row * cellSize + cellSize / 2;
        const textureKey = this.getPieceTextureKey(piece.owner, piece.knownType);

        this.keep(
          this.add
            .image(centerX, centerY + 4, textureKey)
            .setOrigin(0.5, 0.5)
            .setScale(2.2),
        );
      }
    }

    private getRenderablePieces(): VisiblePiece[] {
      const snapshot = deps.getSnapshot();
      if (!snapshot || snapshot.visiblePieces.length === 0) {
        return previewPieces;
      }
      return snapshot.visiblePieces;
    }

    private shouldMirrorBoard(): boolean {
      return deps.getSnapshot()?.yourPlayerId === 2;
    }

    private toDisplayCoords(col: number, row: number): { col: number; row: number } {
      if (!this.shouldMirrorBoard()) {
        return { col, row };
      }
      return {
        col: boardCols - 1 - col,
        row: boardRows - 1 - row,
      };
    }

    private toLogicalCoords(col: number, row: number): { col: number; row: number } {
      return this.toDisplayCoords(col, row);
    }

    private adjacentCells(col: number, row: number): Array<{ col: number; row: number }> {
      return [
        { col: col - 1, row },
        { col: col + 1, row },
        { col, row: row - 1 },
        { col, row: row + 1 },
      ].filter((cell) => cell.col >= 0 && cell.col < boardCols && cell.row >= 0 && cell.row < boardRows);
    }

    private getPieceTextureKey(player: PlayerId, type: KnownType): string {
      return `piece-${player}-${type}`;
    }

    private createPieceTextures(): void {
      const knownTypes: KnownType[] = ["rock", "paper", "scissors", "king", "hidden"];
      for (const player of [1, 2] as const) {
        for (const type of knownTypes) {
          const key = this.getPieceTextureKey(player, type);
          if (this.textures.exists(key)) {
            continue;
          }

          const canvas = document.createElement("canvas");
          canvas.width = pieceTextureSize;
          canvas.height = pieceTextureSize;
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            continue;
          }

          ctx.imageSmoothingEnabled = false;
          this.paintPieceSprite(ctx, player, type);
          this.textures.addCanvas(key, canvas);
        }
      }
    }

    private paintPieceSprite(ctx: CanvasRenderingContext2D, player: PlayerId, type: KnownType): void {
      paintSharedPieceSprite(ctx, player, type);
    }
  };
}
