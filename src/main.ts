import Phaser from "phaser";

const boardCols = 8;
const boardRows = 6;
const cellSize = 112;
const boardWidth = boardCols * cellSize;
const boardHeight = boardRows * cellSize;
const sidePanelWidth = 380;
const canvasWidth = boardWidth + sidePanelWidth;
const canvasHeight = boardHeight;
const boardLight = 0xd8e98b;
const boardDark = 0xabca1a;

type PieceType = "rock" | "paper" | "scissors";
type PlayerId = 1 | 2;
type Phase = "waiting" | "turn" | "battle_pick" | "game_over";
type KnownType = PieceType | "hidden";
type ViewMode = "home" | "connecting" | "room" | "error";

interface VisiblePiece {
  id: string;
  owner: PlayerId;
  col: number;
  row: number;
  knownType: KnownType;
}

interface BattleState {
  chooser: PlayerId;
  round: number;
}

interface RoomSnapshot {
  roomId: string;
  phase: Phase;
  yourPlayerId: PlayerId;
  playerToken: string;
  currentPlayer: PlayerId | null;
  selectedPieceId: string | null;
  winner: PlayerId | null;
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

const pieceTypes: PieceType[] = ["rock", "paper", "scissors"];
const typeLabels: Record<PieceType, string> = {
  rock: "Камень",
  paper: "Бумага",
  scissors: "Ножницы",
};
const playerColors: Record<PlayerId, number> = {
  1: 0xe25a2c,
  2: 0x2f6bff,
};

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("App root not found");
}

const root = app;
const style = document.createElement("style");
style.textContent = `
  :root {
    color-scheme: light;
    --bg-a: #f7efe0;
    --bg-b: #d8e7ea;
    --ink: #13212f;
    --muted: #516171;
    --line: rgba(19,33,47,0.12);
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100vh;
    font-family: "Trebuchet MS", "Segoe UI", sans-serif;
    background:
      radial-gradient(circle at top left, rgba(255,255,255,0.7), transparent 35%),
      linear-gradient(135deg, var(--bg-a), var(--bg-b));
    color: var(--ink);
    display: grid;
    place-items: center;
  }
  #app {
    width: min(100vw, 1320px);
    padding: 24px;
  }
  .shell {
    position: relative;
    background: rgba(255,255,255,0.78);
    border: 1px solid var(--line);
    border-radius: 28px;
    padding: 18px;
    box-shadow: 0 20px 60px rgba(19,33,47,0.16);
    backdrop-filter: blur(12px);
  }
  .topbar {
    display: flex;
    justify-content: space-between;
    gap: 16px;
    align-items: center;
    margin-bottom: 16px;
  }
  .title {
    margin: 0;
    font-size: clamp(28px, 4vw, 42px);
    line-height: 0.95;
    letter-spacing: 0.03em;
    text-transform: uppercase;
  }
  .subtitle {
    margin: 6px 0 0;
    color: var(--muted);
    max-width: 660px;
    font-size: 14px;
  }
  .actions {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
    justify-content: flex-end;
  }
  button {
    border: 0;
    border-radius: 999px;
    padding: 12px 18px;
    font: inherit;
    cursor: pointer;
    background: #13212f;
    color: white;
    box-shadow: 0 10px 24px rgba(19,33,47,0.18);
  }
  button.secondary {
    background: white;
    color: #13212f;
    border: 1px solid rgba(19,33,47,0.15);
    box-shadow: none;
  }
  button:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
  .board-wrap {
    display: grid;
    justify-items: center;
  }
  #game-host {
    width: min(100%, ${canvasWidth}px);
    border-radius: 22px;
    overflow: hidden;
    line-height: 0;
  }
  #game-host canvas {
    width: 100%;
    height: auto;
    display: block;
  }
  .choice-row {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
    margin-top: 10px;
  }
  .footer {
    margin-top: 12px;
    color: var(--muted);
    font-size: 13px;
    display: flex;
    justify-content: space-between;
    gap: 10px;
    flex-wrap: wrap;
  }
  .hidden {
    display: none !important;
  }
  .modal-backdrop {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    background: rgba(19,33,47,0.38);
    border-radius: 28px;
  }
  .modal {
    width: min(92vw, 420px);
    background: white;
    border-radius: 24px;
    padding: 24px;
    box-shadow: 0 30px 80px rgba(19,33,47,0.22);
  }
  .modal h2 {
    margin: 0 0 8px;
  }
  .modal p {
    margin: 0 0 16px;
    color: var(--muted);
  }
  .modal label {
    display: block;
    font-size: 14px;
    margin-bottom: 8px;
    color: var(--muted);
  }
  .modal select {
    width: 100%;
    padding: 12px 14px;
    border-radius: 14px;
    border: 1px solid rgba(19,33,47,0.18);
    font: inherit;
  }
  .modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    margin-top: 18px;
  }
`;
document.head.appendChild(style);

root.innerHTML = `
  <div class="shell">
    <div class="topbar">
      <div>
        <h1 class="title">Hidden RPS</h1>
        <p class="subtitle">
          Мультиплеерная Phaser-версия: первый игрок создает комнату, получает уникальную ссылку
          и отправляет ее сопернику. После подключения обоих игра начинается автоматически.
        </p>
      </div>
      <div class="actions">
        <button id="start-btn">Новая игра</button>
        <button id="copy-link-btn" class="secondary" disabled>Копировать ссылку</button>
        <button id="fullscreen-btn" class="secondary">Полный экран</button>
      </div>
    </div>
    <div class="board-wrap">
      <div id="game-host"></div>
    </div>
    <div id="choice-panel" class="choice-row hidden"></div>
    <div class="footer">
      <span id="status-line"></span>
      <span id="connection-line"></span>
    </div>
    <div id="config-modal" class="modal-backdrop hidden">
      <div class="modal">
        <h2>Параметры Игры</h2>
        <p>Пока добавил стартовый пресет. Позже сюда можно вынести реальные настройки партии.</p>
        <label for="preset-select">Пресет</label>
        <select id="preset-select">
          <option value="standard">Стандартная партия</option>
        </select>
        <div class="modal-actions">
          <button id="cancel-config-btn" class="secondary">Отмена</button>
          <button id="confirm-config-btn">Создать ссылку</button>
        </div>
      </div>
    </div>
  </div>
`;

const startButton = document.querySelector<HTMLButtonElement>("#start-btn");
const copyLinkButton = document.querySelector<HTMLButtonElement>("#copy-link-btn");
const fullscreenButton = document.querySelector<HTMLButtonElement>("#fullscreen-btn");
const choicePanel = document.querySelector<HTMLDivElement>("#choice-panel");
const statusLine = document.querySelector<HTMLSpanElement>("#status-line");
const connectionLine = document.querySelector<HTMLSpanElement>("#connection-line");
const gameHost = document.querySelector<HTMLDivElement>("#game-host");
const configModal = document.querySelector<HTMLDivElement>("#config-modal");
const presetSelect = document.querySelector<HTMLSelectElement>("#preset-select");
const cancelConfigButton = document.querySelector<HTMLButtonElement>("#cancel-config-btn");
const confirmConfigButton = document.querySelector<HTMLButtonElement>("#confirm-config-btn");

if (
  !startButton ||
  !copyLinkButton ||
  !fullscreenButton ||
  !choicePanel ||
  !statusLine ||
  !connectionLine ||
  !gameHost ||
  !configModal ||
  !presetSelect ||
  !cancelConfigButton ||
  !confirmConfigButton
) {
  throw new Error("Required UI elements not found");
}

const startBtn = startButton;
const copyLinkBtn = copyLinkButton;
const fullscreenBtn = fullscreenButton;
const battleChoicePanel = choicePanel;
const footerStatusLine = statusLine;
const footerConnectionLine = connectionLine;
const modalRoot = configModal;
const presetInput = presetSelect;
const cancelConfigBtn = cancelConfigButton;
const confirmConfigBtn = confirmConfigButton;

let boardScene: BoardScene | null = null;
let roomSnapshot: RoomSnapshot | null = null;
let connectionState: "idle" | "connecting" | "connected" | "error" = "idle";
let connectionError = "";
let currentRoomId = getRoomIdFromUrl();
let shareUrl = currentRoomId ? buildShareUrl(currentRoomId) : "";
let socket: WebSocket | null = null;
let isCreatingRoom = false;

function getRoomIdFromUrl(): string | null {
  return new URL(window.location.href).searchParams.get("room");
}

function buildShareUrl(roomId: string): string {
  const url = new URL(window.location.href);
  url.searchParams.set("room", roomId);
  url.searchParams.delete("token");
  return url.toString();
}

function playerTokenKey(roomId: string): string {
  return `hidden-rps:room-token:${roomId}`;
}

function savePlayerToken(roomId: string, token: string): void {
  window.localStorage.setItem(playerTokenKey(roomId), token);
}

function loadPlayerToken(roomId: string): string | null {
  return window.localStorage.getItem(playerTokenKey(roomId));
}

function setRoomInUrl(roomId: string): void {
  const url = new URL(window.location.href);
  url.searchParams.set("room", roomId);
  window.history.replaceState({}, "", url);
  currentRoomId = roomId;
  shareUrl = buildShareUrl(roomId);
}

function currentViewMode(): ViewMode {
  if (connectionState === "error") {
    return "error";
  }
  if (!currentRoomId) {
    return "home";
  }
  if (!roomSnapshot) {
    return "connecting";
  }
  return "room";
}

function visiblePieces(): VisiblePiece[] {
  return roomSnapshot?.visiblePieces ?? [];
}

function countKnownTypes(owner: PlayerId): Record<PieceType, number> {
  return visiblePieces()
    .filter((piece) => piece.owner === owner && piece.knownType !== "hidden")
    .reduce<Record<PieceType, number>>(
      (acc, piece) => {
        acc[piece.knownType as PieceType] += 1;
        return acc;
      },
      { rock: 0, paper: 0, scissors: 0 },
    );
}

function wrapLines(text: string, maxChars: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }

  if (current) {
    lines.push(current);
  }

  return lines;
}

function mixColor(base: number, target: number, amount: number): string {
  const r = (base >> 16) & 0xff;
  const g = (base >> 8) & 0xff;
  const b = base & 0xff;
  const tr = (target >> 16) & 0xff;
  const tg = (target >> 8) & 0xff;
  const tb = target & 0xff;
  const nextR = Math.round(r + (tr - r) * amount);
  const nextG = Math.round(g + (tg - g) * amount);
  const nextB = Math.round(b + (tb - b) * amount);
  return `rgb(${nextR}, ${nextG}, ${nextB})`;
}

function roomStatusText(): string {
  if (!currentRoomId) {
    return "Комната не создана.";
  }

  if (connectionState === "connecting") {
    return `Подключаемся к комнате ${currentRoomId}...`;
  }

  if (connectionState === "error") {
    return connectionError || "Ошибка подключения к комнате.";
  }

  if (!roomSnapshot) {
    return `Комната ${currentRoomId} подготовлена.`;
  }

  const role = roomSnapshot.yourPlayerId === 1 ? "Вы игрок 1." : "Вы игрок 2.";
  const lobbyState =
    roomSnapshot.phase === "waiting"
      ? `Подключено ${roomSnapshot.connectedPlayers}/${roomSnapshot.requiredPlayers}.`
      : `Подключено ${roomSnapshot.connectedPlayers}/${roomSnapshot.requiredPlayers}. Игра активна.`;

  return `${role} ${lobbyState}`;
}

function statusMessage(): string {
  if (roomSnapshot) {
    return roomSnapshot.message;
  }
  if (connectionState === "error") {
    return connectionError || "Не удалось подключиться к комнате.";
  }
  if (connectionState === "connecting") {
    return "Ищем комнату и подключаемся к серверу.";
  }
  return "Нажмите «Новая игра», выберите пресет и отправьте ссылку сопернику.";
}

function showConfigModal(show: boolean): void {
  modalRoot.classList.toggle("hidden", !show);
}

async function createRoom(): Promise<void> {
  if (isCreatingRoom) {
    return;
  }

  isCreatingRoom = true;
  confirmConfigBtn.disabled = true;

  try {
    const response = await fetch("/api/games", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ preset: presetInput.value }),
    });

    if (!response.ok) {
      throw new Error(`create room failed: ${response.status}`);
    }

    const payload = (await response.json()) as {
      roomId: string;
      playerToken: string;
      playerId: PlayerId;
    };

    savePlayerToken(payload.roomId, payload.playerToken);
    setRoomInUrl(payload.roomId);
    roomSnapshot = null;
    connectionState = "connecting";
    connectionError = "";
    showConfigModal(false);
    syncUi();
    requestRender();
    connectToRoom(payload.roomId);
  } catch (error) {
    connectionState = "error";
    connectionError = "Не удалось создать комнату.";
    syncUi();
    requestRender();
    console.error(error);
  } finally {
    isCreatingRoom = false;
    confirmConfigBtn.disabled = false;
  }
}

function wsUrlForRoom(roomId: string): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const token = loadPlayerToken(roomId);
  const url = new URL(`${protocol}//${window.location.host}/ws/games/${roomId}`);
  if (token) {
    url.searchParams.set("token", token);
  }
  return url.toString();
}

function connectToRoom(roomId: string): void {
  if (socket) {
    socket.close();
  }

  connectionState = "connecting";
  connectionError = "";
  syncUi();
  requestRender();

  const nextSocket = new WebSocket(wsUrlForRoom(roomId));
  socket = nextSocket;

  nextSocket.addEventListener("open", () => {
    if (socket !== nextSocket) {
      return;
    }
    connectionState = "connected";
    syncUi();
    requestRender();
  });

  nextSocket.addEventListener("message", (event) => {
    if (socket !== nextSocket) {
      return;
    }

    const data = JSON.parse(event.data) as
      | { type: "snapshot"; payload: RoomSnapshot }
      | { type: "error"; message: string };

    if (data.type === "error") {
      connectionState = "error";
      connectionError = data.message;
      syncUi();
      requestRender();
      return;
    }

    roomSnapshot = data.payload;
    savePlayerToken(data.payload.roomId, data.payload.playerToken);
    shareUrl = buildShareUrl(data.payload.roomId);
    syncUi();
    requestRender();
  });

  nextSocket.addEventListener("close", () => {
    if (socket !== nextSocket) {
      return;
    }

    socket = null;
    if (currentRoomId) {
      connectionState = "error";
      connectionError = "Соединение с комнатой потеряно. Обновите страницу или откройте ссылку снова.";
    } else {
      connectionState = "idle";
    }
    syncUi();
    requestRender();
  });
}

function sendAction(payload: Record<string, unknown>): void {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return;
  }
  socket.send(JSON.stringify(payload));
}

function handleBoardClick(col: number, row: number): void {
  if (!roomSnapshot || !roomSnapshot.canAct || roomSnapshot.phase !== "turn") {
    return;
  }
  sendAction({ type: "cell_click", col, row });
}

function resolveBattleChoice(choice: PieceType): void {
  if (!roomSnapshot || !roomSnapshot.canAct || roomSnapshot.phase !== "battle_pick") {
    return;
  }
  sendAction({ type: "battle_choice", choice });
}

function syncUi(): void {
  footerStatusLine.textContent = statusMessage();
  footerConnectionLine.textContent = roomStatusText();
  copyLinkBtn.disabled = !shareUrl;

  battleChoicePanel.innerHTML = "";
  const showChoices = roomSnapshot?.phase === "battle_pick" && roomSnapshot.canAct;
  battleChoicePanel.classList.toggle("hidden", !showChoices);

  if (showChoices) {
    for (const type of pieceTypes) {
      const button = document.createElement("button");
      button.textContent = typeLabels[type];
      button.addEventListener("click", () => resolveBattleChoice(type));
      battleChoicePanel.appendChild(button);
    }
  }
}

class BoardScene extends Phaser.Scene {
  private dynamicObjects: Phaser.GameObjects.GameObject[] = [];

  constructor() {
    super("board");
  }

  create(): void {
    boardScene = this;
    this.createPieceTextures();
    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (pointer.x >= boardWidth || pointer.y >= boardHeight) {
        return;
      }
      const col = Phaser.Math.Clamp(Math.floor(pointer.x / cellSize), 0, boardCols - 1);
      const row = Phaser.Math.Clamp(Math.floor(pointer.y / cellSize), 0, boardRows - 1);
      handleBoardClick(col, row);
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

    const selectedPieceId = roomSnapshot?.selectedPieceId;
    if (selectedPieceId) {
      const selected = roomSnapshot?.visiblePieces.find((piece) => piece.id === selectedPieceId);
      if (selected) {
        board.lineStyle(4, 0xf8fafc, 1);
        board.strokeRect(selected.col * cellSize + 4, selected.row * cellSize + 4, cellSize - 8, cellSize - 8);
      }
    }
  }

  private drawPieces(): void {
    for (const piece of visiblePieces()) {
      const centerX = piece.col * cellSize + cellSize / 2;
      const centerY = piece.row * cellSize + cellSize / 2;
      const textureKey = this.getPieceTextureKey(piece.owner, piece.knownType);

      this.keep(
        this.add
          .image(centerX, centerY + 4, textureKey)
          .setOrigin(0.5, 0.5)
          .setScale(3.25),
      );
    }
  }

  private drawSidePanel(): void {
    this.keep(this.add.rectangle(boardWidth + sidePanelWidth / 2, canvasHeight / 2, sidePanelWidth, canvasHeight, 0x13212f));

    this.keep(
      this.add.text(boardWidth + 22, 20, this.sidePanelTitle(), {
        fontFamily: "Trebuchet MS, sans-serif",
        fontSize: "30px",
        color: "#f8fafc",
        fontStyle: "bold",
      }),
    );

    this.keep(
      this.add.text(boardWidth + 22, 68, wrapLines(statusMessage(), 30).join("\n"), {
        fontFamily: "Trebuchet MS, sans-serif",
        fontSize: "18px",
        color: "rgba(248,250,252,0.82)",
        lineSpacing: 6,
      }),
    );

    if (roomSnapshot) {
      this.keep(
        this.add.text(boardWidth + 22, 150, `Комната: ${roomSnapshot.roomId}`, {
          fontFamily: "Trebuchet MS, sans-serif",
          fontSize: "16px",
          color: "#cbd5e1",
        }),
      );
      this.keep(
        this.add.text(boardWidth + 22, 178, `Пресет: ${roomSnapshot.parameters.preset}`, {
          fontFamily: "Trebuchet MS, sans-serif",
          fontSize: "16px",
          color: "#cbd5e1",
        }),
      );
    }

    this.drawPlayerSummary(1, 230);
    this.drawPlayerSummary(2, 430);

    if (roomSnapshot?.lastBattleSummary) {
      this.keep(
        this.add.text(boardWidth + 22, 650, "Последний бой", {
          fontFamily: "Trebuchet MS, sans-serif",
          fontSize: "18px",
          color: "#fde68a",
          fontStyle: "bold",
        }),
      );
      this.keep(
        this.add.text(boardWidth + 22, 682, wrapLines(roomSnapshot.lastBattleSummary, 30).join("\n"), {
          fontFamily: "Trebuchet MS, sans-serif",
          fontSize: "18px",
          color: "#f8fafc",
          lineSpacing: 4,
        }),
      );
    }
  }

  private sidePanelTitle(): string {
    const mode = currentViewMode();
    if (mode === "home") {
      return "Создать Матч";
    }
    if (mode === "connecting") {
      return "Подключение";
    }
    if (mode === "error") {
      return "Ошибка";
    }

    if (!roomSnapshot) {
      return "Комната";
    }

    if (roomSnapshot.phase === "waiting") {
      return "Ожидание";
    }
    if (roomSnapshot.phase === "game_over") {
      return `Победа: игрок ${roomSnapshot.winner}`;
    }
    if (roomSnapshot.phase === "battle_pick" && roomSnapshot.battle) {
      return `Выбор: игрок ${roomSnapshot.battle.chooser}`;
    }
    return `Ход: игрок ${roomSnapshot.currentPlayer}`;
  }

  private drawPlayerSummary(player: PlayerId, y: number): void {
    const counts = roomSnapshot?.counts ?? { player1: 0, player2: 0 };
    const ownInfoVisible = roomSnapshot?.yourPlayerId === player || currentViewMode() === "home";
    const summaryText = ownInfoVisible
      ? (() => {
          const known = countKnownTypes(player);
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
      this.add.text(
        boardWidth + 22,
        y + 34,
        `Фигур осталось: ${player === 1 ? counts.player1 : counts.player2}`,
        {
          fontFamily: "Trebuchet MS, sans-serif",
          fontSize: "18px",
          color: "#f8fafc",
        },
      ),
    );
    this.keep(
      this.add.text(boardWidth + 22, y + 70, summaryText, {
        fontFamily: "Trebuchet MS, sans-serif",
        fontSize: "18px",
        color: "#f8fafc",
        lineSpacing: 6,
      }),
    );
  }

  private drawOverlay(): void {
    const mode = currentViewMode();
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
                body: connectionError || "Сервер комнаты недоступен.",
              }
            : roomSnapshot?.phase === "waiting"
              ? {
                  title: "Комната Создана",
                  body: "Отправьте ссылку сопернику. Как только второй игрок зайдет, матч начнется автоматически.",
                }
              : roomSnapshot?.phase === "game_over"
                ? {
                    title: `Победа Игрока ${roomSnapshot.winner}`,
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

  private paintPieceSprite(
    ctx: CanvasRenderingContext2D,
    player: PlayerId,
    type: KnownType,
  ): void {
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
}

function requestRender(): void {
  boardScene?.renderState();
}

function renderGameToText(): string {
  if (!roomSnapshot) {
    return JSON.stringify({
      mode: currentViewMode(),
      roomId: currentRoomId,
      message: statusMessage(),
    });
  }

  return JSON.stringify({
    mode: roomSnapshot.phase,
    roomId: roomSnapshot.roomId,
    board: {
      cols: boardCols,
      rows: boardRows,
      origin: "top-left",
      xDirection: "right",
      yDirection: "down",
    },
    yourPlayerId: roomSnapshot.yourPlayerId,
    currentPlayer: roomSnapshot.currentPlayer,
    selectedPieceId: roomSnapshot.selectedPieceId,
    visiblePieces: roomSnapshot.visiblePieces,
    counts: roomSnapshot.counts,
    connectedPlayers: roomSnapshot.connectedPlayers,
    message: roomSnapshot.message,
  });
}

function advanceTime(): void {
  requestRender();
}

async function copyInviteLink(): Promise<void> {
  if (!shareUrl) {
    return;
  }

  try {
    await navigator.clipboard.writeText(shareUrl);
    footerConnectionLine.textContent = "Ссылка скопирована. Отправьте ее второму игроку.";
  } catch {
    footerConnectionLine.textContent = shareUrl;
  }
}

async function toggleFullscreen(): Promise<void> {
  if (!document.fullscreenElement) {
    await root.requestFullscreen();
  } else {
    await document.exitFullscreen();
  }
}

new Phaser.Game({
  type: Phaser.CANVAS,
  width: canvasWidth,
  height: canvasHeight,
  parent: gameHost,
  backgroundColor: "#000000",
  scene: [BoardScene],
  render: {
    antialias: true,
    pixelArt: false,
  },
  scale: {
    mode: Phaser.Scale.NONE,
    width: canvasWidth,
    height: canvasHeight,
  },
});

startBtn.addEventListener("click", () => showConfigModal(true));
cancelConfigBtn.addEventListener("click", () => showConfigModal(false));
confirmConfigBtn.addEventListener("click", () => {
  void createRoom();
});
copyLinkBtn.addEventListener("click", () => {
  void copyInviteLink();
});
fullscreenBtn.addEventListener("click", () => {
  void toggleFullscreen();
});
window.addEventListener("keydown", (event) => {
  if (event.key.toLowerCase() === "f") {
    event.preventDefault();
    void toggleFullscreen();
  }
  if (event.key === "Escape") {
    showConfigModal(false);
  }
});
document.addEventListener("fullscreenchange", () => requestRender());
window.addEventListener("resize", () => requestRender());

window.render_game_to_text = renderGameToText;
window.advanceTime = (_ms: number) => {
  advanceTime();
};

syncUi();
requestRender();

if (currentRoomId) {
  connectToRoom(currentRoomId);
}
