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
  onSceneReady: (scene: { renderState: (animate?: boolean) => void }) => void;
}

export function createBoardScene(deps: BoardSceneDeps): typeof Phaser.Scene {
  return class BoardScene extends Phaser.Scene {
    private boardGraphics: Phaser.GameObjects.Graphics | null = null;
    private overlayGraphics: Phaser.GameObjects.Graphics | null = null;
    private pieceSprites = new Map<string, Phaser.GameObjects.Image>();
    private lastAnimationId: number | null = null;

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

    renderState(animate = false): void {
      this.drawBoard();

      if (!this.tryAnimateSnapshot(animate)) {
        this.syncPieceSprites();
      }
    }

    private drawBoard(): void {
      if (!this.boardGraphics) {
        this.boardGraphics = this.add.graphics();
        this.boardGraphics.fillGradientStyle(0xc8dd6b, 0xa6c321, 0xa6c321, 0xc8dd6b, 1);
        this.boardGraphics.fillRect(0, 0, boardWidth, boardHeight);

        for (let row = 0; row < boardRows; row += 1) {
          for (let col = 0; col < boardCols; col += 1) {
            const color = (row + col) % 2 === 0 ? boardLight : boardDark;
            const alpha = (row + col) % 2 === 0 ? 0.92 : 0.82;
            this.boardGraphics.fillStyle(color, alpha);
            this.boardGraphics.fillRect(col * cellSize, row * cellSize, cellSize, cellSize);
            this.boardGraphics.lineStyle(1, 0xf7f8da, 0.35);
            this.boardGraphics.strokeRect(col * cellSize, row * cellSize, cellSize, cellSize);
          }
        }
      }

      if (!this.overlayGraphics) {
        this.overlayGraphics = this.add.graphics();
      }

      const board = this.overlayGraphics;
      board.clear();

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

    private syncPieceSprites(): void {
      const pieces = this.getRenderablePieces();
      const snapshot = deps.getSnapshot();
      const remainingIds = new Set(pieces.map((piece) => piece.id));

      for (const [pieceId, sprite] of this.pieceSprites) {
        if (!remainingIds.has(pieceId)) {
          sprite.destroy();
          this.pieceSprites.delete(pieceId);
        }
      }

      for (const piece of pieces) {
        const display = this.toDisplayCoords(piece.col, piece.row);
        const centerX = display.col * cellSize + cellSize / 2;
        const centerY = display.row * cellSize + cellSize / 2;
        const textureKey = this.getPieceTextureKey(piece.owner, this.getDisplayedType(piece.id, piece.knownType));
        let sprite = this.pieceSprites.get(piece.id);
        if (!sprite) {
          sprite = this.add.image(centerX, centerY + 4, textureKey).setOrigin(0.5, 0.5).setScale(2.2);
          this.pieceSprites.set(piece.id, sprite);
        }
        sprite.setTexture(textureKey);
        sprite.setPosition(centerX, centerY + 4);
        sprite.setAlpha(1);
      }

      if (snapshot?.phase === "battle_pick" && snapshot.battle) {
        const attacker = this.pieceSprites.get(snapshot.battle.attackerId ?? "");
        const defender = this.pieceSprites.get(snapshot.battle.defenderId ?? "");
        if (attacker && snapshot.battle.attackerType) {
          const piece = pieces.find((item) => item.id === snapshot.battle?.attackerId);
          if (piece) {
            attacker.setTexture(this.getPieceTextureKey(piece.owner, snapshot.battle.attackerType));
          }
        }
        if (defender && snapshot.battle.defenderType) {
          const piece = pieces.find((item) => item.id === snapshot.battle?.defenderId);
          if (piece) {
            defender.setTexture(this.getPieceTextureKey(piece.owner, snapshot.battle.defenderType));
          }
        }
      }
    }

    private tryAnimateSnapshot(animate: boolean): boolean {
      const snapshot = deps.getSnapshot();
      const hint = snapshot?.animationHint;
      if (!animate || !snapshot || !hint || hint.id === this.lastAnimationId) {
        return false;
      }

      this.lastAnimationId = hint.id;

      if (hint.kind === "move" && hint.pieceId !== undefined && hint.fromCol !== undefined && hint.fromRow !== undefined && hint.toCol !== undefined && hint.toRow !== undefined) {
        this.animateMove(hint.pieceId, hint.fromCol, hint.fromRow, hint.toCol, hint.toRow);
        return true;
      }

      if (
        hint.kind === "attack" &&
        hint.attackerId &&
        hint.defenderId &&
        hint.attackerFromCol !== undefined &&
        hint.attackerFromRow !== undefined &&
        hint.defenderFromCol !== undefined &&
        hint.defenderFromRow !== undefined &&
        hint.attackerType &&
        hint.defenderType
      ) {
        this.animateAttack(
          hint.attackerId,
          hint.defenderId,
          hint.attackerFromCol,
          hint.attackerFromRow,
          hint.defenderFromCol,
          hint.defenderFromRow,
          hint.attackerType,
          hint.defenderType,
          hint.winnerId ?? null,
        );
        return true;
      }

      return false;
    }

    private animateMove(pieceId: string, fromCol: number, fromRow: number, toCol: number, toRow: number): void {
      this.syncPieceSprites();
      const sprite = this.pieceSprites.get(pieceId);
      if (!sprite) {
        this.syncPieceSprites();
        return;
      }

      const from = this.toDisplayCoords(fromCol, fromRow);
      const to = this.toDisplayCoords(toCol, toRow);
      sprite.setPosition(from.col * cellSize + cellSize / 2, from.row * cellSize + cellSize / 2 + 4);

      this.tweens.killTweensOf(sprite);
      this.tweens.add({
        targets: sprite,
        x: to.col * cellSize + cellSize / 2,
        y: to.row * cellSize + cellSize / 2 + 4,
        duration: 180,
        ease: "Quad.Out",
        onComplete: () => this.syncPieceSprites(),
      });
    }

    private animateAttack(
      attackerId: string,
      defenderId: string,
      attackerFromCol: number,
      attackerFromRow: number,
      defenderFromCol: number,
      defenderFromRow: number,
      attackerType: KnownType,
      defenderType: KnownType,
      winnerId: string | null,
    ): void {
      this.syncPieceSprites();
      const snapshot = deps.getSnapshot();
      const pieces = this.getRenderablePieces();

      let attacker = this.pieceSprites.get(attackerId);
      let defender = this.pieceSprites.get(defenderId);
      const attackerOwner = pieces.find((piece) => piece.id === attackerId)?.owner ?? snapshot?.yourPlayerId ?? 1;
      const defenderOwner = pieces.find((piece) => piece.id === defenderId)?.owner ?? (attackerOwner === 1 ? 2 : 1);

      const attackerFrom = this.toDisplayCoords(attackerFromCol, attackerFromRow);
      const defenderFrom = this.toDisplayCoords(defenderFromCol, defenderFromRow);
      const attackerPos = { x: attackerFrom.col * cellSize + cellSize / 2, y: attackerFrom.row * cellSize + cellSize / 2 + 4 };
      const defenderPos = { x: defenderFrom.col * cellSize + cellSize / 2, y: defenderFrom.row * cellSize + cellSize / 2 + 4 };

      if (!attacker) {
        attacker = this.add.image(attackerPos.x, attackerPos.y, this.getPieceTextureKey(attackerOwner, attackerType)).setOrigin(0.5, 0.5).setScale(2.2);
        this.pieceSprites.set(attackerId, attacker);
      }
      if (!defender) {
        defender = this.add.image(defenderPos.x, defenderPos.y, this.getPieceTextureKey(defenderOwner, defenderType)).setOrigin(0.5, 0.5).setScale(2.2);
        this.pieceSprites.set(defenderId, defender);
      }

      attacker.setTexture(this.getPieceTextureKey(attackerOwner, attackerType));
      defender.setTexture(this.getPieceTextureKey(defenderOwner, defenderType));
      attacker.setPosition(attackerPos.x, attackerPos.y).setAlpha(1);
      defender.setPosition(defenderPos.x, defenderPos.y).setAlpha(1);

      if (winnerId === null || attackerType === defenderType) {
        return;
      }

      const midX = (attackerPos.x + defenderPos.x) / 2;
      const midY = (attackerPos.y + defenderPos.y) / 2;

      let completed = 0;
      const onMeet = () => {
        completed += 1;
        if (completed < 2) {
          return;
        }

        if (winnerId === attackerId) {
          this.tweens.add({
            targets: defender,
            alpha: 0,
            duration: 100,
            onComplete: () => {
              defender?.destroy();
              this.pieceSprites.delete(defenderId);
            },
          });
          const finalPiece = snapshot?.visiblePieces.find((piece) => piece.id === attackerId);
          if (finalPiece) {
            const final = this.toDisplayCoords(finalPiece.col, finalPiece.row);
            this.tweens.add({
              targets: attacker,
              x: final.col * cellSize + cellSize / 2,
              y: final.row * cellSize + cellSize / 2 + 4,
              duration: 120,
              ease: "Quad.Out",
              onComplete: () => this.syncPieceSprites(),
            });
          }
        } else {
          this.tweens.add({
            targets: attacker,
            alpha: 0,
            scale: 1.2,
            duration: 100,
            onComplete: () => {
              attacker?.destroy();
              this.pieceSprites.delete(attackerId);
            },
          });
          this.tweens.add({
            targets: defender,
            x: defenderPos.x,
            y: defenderPos.y,
            duration: 120,
            ease: "Quad.Out",
            onComplete: () => this.syncPieceSprites(),
          });
        }
      };

      this.tweens.add({
        targets: attacker,
        x: midX,
        y: midY,
        duration: 160,
        ease: "Quad.Out",
        onComplete: onMeet,
      });
      this.tweens.add({
        targets: defender,
        x: midX,
        y: midY,
        duration: 160,
        ease: "Quad.Out",
        onComplete: onMeet,
      });
    }

    private getDisplayedType(pieceId: string, fallback: KnownType): KnownType {
      const snapshot = deps.getSnapshot();
      if (
        snapshot?.phase === "battle_pick" &&
        snapshot.battle &&
        snapshot.battle.attackerId === pieceId &&
        snapshot.battle.attackerType
      ) {
        return snapshot.battle.attackerType;
      }
      if (
        snapshot?.phase === "battle_pick" &&
        snapshot.battle &&
        snapshot.battle.defenderId === pieceId &&
        snapshot.battle.defenderType
      ) {
        return snapshot.battle.defenderType;
      }
      return fallback;
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
