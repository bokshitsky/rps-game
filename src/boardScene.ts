import Phaser from "phaser";

import {
  boardCols,
  boardDark,
  boardHeight,
  boardLight,
  boardRows,
  boardWidth,
  cellSize,
  playerColors,
} from "./constants";
import { mixColor } from "./utils";
import type { KnownType, PlayerId, RoomSnapshot } from "./types";

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
      const snapshot = deps.getSnapshot();
      for (const piece of snapshot?.visiblePieces ?? []) {
        const display = this.toDisplayCoords(piece.col, piece.row);
        const centerX = display.col * cellSize + cellSize / 2;
        const centerY = display.row * cellSize + cellSize / 2;
        const textureKey = this.getPieceTextureKey(piece.owner, piece.knownType);

        this.keep(
          this.add
            .image(centerX, centerY + 4, textureKey)
            .setOrigin(0.5, 0.5)
            .setScale(3.25),
        );
      }
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
      const knownTypes: KnownType[] = ["rock", "paper", "scissors", "hidden"];
      for (const player of [1, 2] as const) {
        for (const type of knownTypes) {
          const key = this.getPieceTextureKey(player, type);
          if (this.textures.exists(key)) {
            continue;
          }

          const canvas = document.createElement("canvas");
          canvas.width = 32;
          canvas.height = 32;
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
      const base = playerColors[player];
      const darkCloth = mixColor(base, 0x000000, 0.34);
      const lightCloth = mixColor(base, 0xffffff, 0.18);
      const skin = player === 1 ? "#f7d4a4" : "#f3d9a8";
      const outline = "#2c2f38";
      const hair = player === 1 ? "#b93e19" : "#1046b5";
      const shadow = "rgba(0,0,0,0.18)";

      const px = (x: number, y: number, w = 1, h = 1, color = outline): void => {
        ctx.fillStyle = color;
        ctx.fillRect(x, y, w, h);
      };

      px(7, 25, 18, 4, shadow);
      px(9, 23, 14, 2, shadow);

      if (type !== "hidden") {
        if (type === "rock") {
          px(20, 13, 7, 8, "#8e949d");
          px(19, 14, 9, 6, "#aab1bb");
          px(21, 15, 5, 2, "#d4dae2");
          px(20, 13, 7, 8, outline);
        } else if (type === "paper") {
          px(19, 12, 7, 10, "#ffffff");
          px(20, 13, 7, 10, "#f9fafb");
          px(19, 12, 1, 10, outline);
          px(20, 12, 6, 1, outline);
          px(26, 13, 1, 9, outline);
          px(20, 22, 7, 1, outline);
          px(22, 14, 3, 6, "#d7dbe2");
        } else if (type === "scissors") {
          px(17, 12, 4, 4, "#ffc234");
          px(23, 12, 4, 4, "#ffc234");
          px(18, 13, 2, 2, outline);
          px(24, 13, 2, 2, outline);
          px(20, 16, 2, 2, "#c2c8d0");
          px(22, 16, 2, 2, "#c2c8d0");
          px(21, 18, 2, 2, "#c2c8d0");
          px(19, 20, 2, 2, "#c2c8d0");
          px(23, 20, 2, 2, "#c2c8d0");
          px(18, 22, 2, 2, "#c2c8d0");
          px(24, 22, 2, 2, "#c2c8d0");
          px(20, 17, 1, 7, outline);
          px(24, 17, 1, 7, outline);
          px(20, 18, 3, 1, outline);
          px(21, 20, 3, 1, outline);
          px(19, 22, 3, 1, outline);
          px(23, 22, 3, 1, outline);
        }
      }

      px(10, 18, 10, 7, darkCloth);
      px(9, 19, 12, 5, darkCloth);
      px(11, 17, 8, 1, lightCloth);
      px(8, 18, 2, 4, darkCloth);
      px(20, 18, 2, 4, darkCloth);
      px(9, 17, 1, 6, outline);
      px(20, 17, 1, 6, outline);
      px(10, 25, 4, 4, darkCloth);
      px(16, 25, 4, 4, darkCloth);

      px(10, 5, 10, 10, skin);
      px(9, 6, 12, 9, skin);
      px(10, 4, 10, 2, hair);
      px(12, 1, 6, 4, hair);
      px(11, 5, 8, 1, mixColor(base, 0xffffff, 0.12));
      px(9, 6, 1, 9, outline);
      px(20, 6, 1, 9, outline);
      px(10, 15, 10, 1, outline);
      px(10, 4, 10, 1, outline);

      px(12, 9, 2, 1, outline);
      px(16, 9, 2, 1, outline);
      px(13, 12, 4, 1, "#d87055");
      px(14, 10, 2, 1, "#f1ad6d");
    }
  };
}
