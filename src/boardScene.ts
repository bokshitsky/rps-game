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
  sidePanelWidth,
  canvasHeight,
} from "./constants";
import { mixColor, wrapLines } from "./utils";
import type { KnownType, PieceType, PlayerId, RoomSnapshot, ViewMode } from "./types";

export interface BoardSceneDeps {
  getSnapshot: () => RoomSnapshot | null;
  getSelectedPieceId: () => string | null;
  getViewMode: () => ViewMode;
  getStatusMessage: () => string;
  getShareUrl: () => string;
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
      this.drawSidePanel();
      this.drawOverlay();
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

    private drawSidePanel(): void {
      const snapshot = deps.getSnapshot();
      this.keep(this.add.rectangle(boardWidth + sidePanelWidth / 2, canvasHeight / 2, sidePanelWidth, canvasHeight, 0x13212f));

      this.keep(
        this.add.text(boardWidth + 22, 20, this.sidePanelTitle(snapshot), {
          fontFamily: "Trebuchet MS, sans-serif",
          fontSize: "30px",
          color: "#f8fafc",
          fontStyle: "bold",
        }),
      );

      this.keep(
        this.add.text(boardWidth + 22, 68, wrapLines(deps.getStatusMessage(), 30).join("\n"), {
          fontFamily: "Trebuchet MS, sans-serif",
          fontSize: "18px",
          color: "rgba(248,250,252,0.82)",
          lineSpacing: 6,
        }),
      );

      this.drawPlayerSummary(1, snapshot, 230);
      this.drawPlayerSummary(2, snapshot, 410);
    }

    private sidePanelTitle(snapshot: RoomSnapshot | null): string {
      const mode = deps.getViewMode();
      if (mode === "home") {
        return "Создать Матч";
      }
      if (mode === "connecting") {
        return "Подключение";
      }
      if (mode === "error") {
        return "Ошибка";
      }
      if (!snapshot) {
        return "Комната";
      }
      if (snapshot.phase === "waiting") {
        return "Ожидание";
      }
      if (snapshot.phase === "setup") {
        return "Подготовка";
      }
      if (snapshot.phase === "game_over") {
        return `Победа: игрок ${snapshot.winner}`;
      }
      if (snapshot.phase === "battle_pick" && snapshot.battle) {
        return `Выбор: игрок ${snapshot.battle.chooser}`;
      }
      return snapshot.canAct ? "Ваш ход" : "Ход соперника";
    }

    private drawPlayerSummary(player: PlayerId, snapshot: RoomSnapshot | null, y: number): void {
      const ownInfoVisible = snapshot?.yourPlayerId === player || deps.getViewMode() === "home";
      const summaryText = ownInfoVisible
        ? (() => {
            const known = this.countKnownTypes(snapshot, player);
            return `Камень: ${known.rock}\nБумага: ${known.paper}\nНожницы: ${known.scissors}`;
          })()
        : "Типы скрыты от соперника.";

      this.keep(
        this.add.text(boardWidth + 22, y, `Игрок ${player}`, {
          fontFamily: "Trebuchet MS, sans-serif",
          fontSize: "22px",
          color: player === 1 ? "#fb923c" : "#70a2ff",
          fontStyle: "bold",
        }),
      );
      this.keep(
        this.add.text(boardWidth + 22, y + 40, summaryText, {
          fontFamily: "Trebuchet MS, sans-serif",
          fontSize: "18px",
          color: "#f8fafc",
          lineSpacing: 6,
        }),
      );
    }

    private countKnownTypes(snapshot: RoomSnapshot | null, owner: PlayerId): Record<PieceType, number> {
      return (snapshot?.visiblePieces ?? [])
        .filter((piece) => piece.owner === owner && piece.knownType !== "hidden")
        .reduce<Record<PieceType, number>>(
          (acc, piece) => {
            acc[piece.knownType as PieceType] += 1;
            return acc;
          },
          { rock: 0, paper: 0, scissors: 0 },
        );
    }

    private drawOverlay(): void {
      const mode = deps.getViewMode();
      const snapshot = deps.getSnapshot();
      const overlayText =
        mode === "home"
          ? {
              title: "Новая Мультиплеерная Партия",
              body: "Нажмите «Новая игра», выберите стартовый пресет и получите ссылку для соперника.",
            }
          : mode === "connecting"
            ? {
                title: "Подключаемся",
                body: "Открываем комнату и ждем снимок состояния от сервера.",
              }
            : mode === "error"
              ? {
                  title: "Проблема С Подключением",
                  body: deps.getStatusMessage(),
                }
              : snapshot?.phase === "waiting"
                ? {
                    title: "Комната Создана",
                    body: "Отправьте ссылку сопернику. Когда второй игрок зайдет, оба соберут стартовую расстановку и нажмут «Готов».",
                  }
                : snapshot?.phase === "game_over"
                  ? {
                      title: `Победа Игрока ${snapshot.winner}`,
                      body: "Можно создать новую комнату той же кнопкой сверху.",
                    }
                  : null;

      if (!overlayText) {
        return;
      }

      this.keep(this.add.rectangle(boardWidth / 2, boardHeight / 2, boardWidth, boardHeight, 0x13212f, 0.72));
      this.keep(
        this.add
          .text(boardWidth / 2, 180, overlayText.title, {
            fontFamily: "Trebuchet MS, sans-serif",
            fontSize: "36px",
            color: "#ffffff",
            fontStyle: "bold",
            align: "center",
          })
          .setOrigin(0.5, 0.5),
      );
      this.keep(
        this.add
          .text(boardWidth / 2, 260, wrapLines(overlayText.body, 46).join("\n"), {
            fontFamily: "Trebuchet MS, sans-serif",
            fontSize: "22px",
            color: "#f8fafc",
            align: "center",
            lineSpacing: 8,
          })
          .setOrigin(0.5, 0.5),
      );

      const shareUrl = deps.getShareUrl();
      if (shareUrl && (mode === "room" || mode === "connecting")) {
        this.keep(
          this.add
            .text(boardWidth / 2, 360, wrapLines(shareUrl, 48).join("\n"), {
              fontFamily: "Trebuchet MS, sans-serif",
              fontSize: "16px",
              color: "#cbd5e1",
              align: "center",
              lineSpacing: 6,
            })
            .setOrigin(0.5, 0.5),
        );
      }
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
          px(19, 14, 2, 10, "#c2c8d0");
          px(23, 14, 2, 10, "#c2c8d0");
          px(20, 14, 1, 10, outline);
          px(23, 14, 1, 10, outline);
          px(18, 12, 4, 3, "#ffc234");
          px(22, 12, 4, 3, "#ffc234");
          px(19, 12, 2, 2, outline);
          px(23, 12, 2, 2, outline);
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
