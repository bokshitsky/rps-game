import Phaser from "phaser";

import { createBoardScene } from "./boardScene";
import { canvasHeight, canvasWidth, pieceTypes, typeLabels } from "./constants";
import type { PieceType, PlayerId, RoomSnapshot, ViewMode } from "./types";
import { createAppShell } from "./ui";

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("App root not found");
}

const ui = createAppShell(app);

let boardScene: { renderState: () => void } | null = null;
let roomSnapshot: RoomSnapshot | null = null;
let connectionState: "idle" | "connecting" | "connected" | "error" = "idle";
let connectionError = "";
let currentRoomId = getRoomIdFromUrl();
let shareUrl = currentRoomId ? buildShareUrl(currentRoomId) : "";
let socket: WebSocket | null = null;
let isCreatingRoom = false;
let isFetchingSnapshot = false;
let localSelectedPieceId: string | null = null;
let localStatusMessage = "";

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
      : roomSnapshot.phase === "setup"
        ? `Подключено ${roomSnapshot.connectedPlayers}/${roomSnapshot.requiredPlayers}. Идет подготовка.`
        : `Подключено ${roomSnapshot.connectedPlayers}/${roomSnapshot.requiredPlayers}. Игра активна.`;

  return `${role} ${lobbyState}`;
}

function canUseLocalTurnInteractions(): boolean {
  return Boolean(roomSnapshot && roomSnapshot.canAct && roomSnapshot.phase === "turn");
}

function clearLocalSelection(): void {
  localSelectedPieceId = null;
}

function setLocalStatusMessage(message: string): void {
  localStatusMessage = message;
}

function clearLocalStatusMessage(): void {
  localStatusMessage = "";
}

function visiblePieceAt(col: number, row: number) {
  return roomSnapshot?.visiblePieces.find((piece) => piece.col === col && piece.row === row) ?? null;
}

function visiblePieceById(pieceId: string | null) {
  if (!pieceId) {
    return null;
  }
  return roomSnapshot?.visiblePieces.find((piece) => piece.id === pieceId) ?? null;
}

function isAdjacent(fromCol: number, fromRow: number, toCol: number, toRow: number): boolean {
  return Math.abs(fromCol - toCol) + Math.abs(fromRow - toRow) === 1;
}

function syncLocalSelectionWithSnapshot(): void {
  if (!canUseLocalTurnInteractions()) {
    clearLocalSelection();
    clearLocalStatusMessage();
    return;
  }

  const selectedPiece = visiblePieceById(localSelectedPieceId);
  if (!selectedPiece || selectedPiece.owner !== roomSnapshot?.yourPlayerId) {
    clearLocalSelection();
  }
}

function statusMessage(): string {
  if (localStatusMessage && roomSnapshot?.phase === "turn") {
    return localStatusMessage;
  }
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
  ui.modalRoot.classList.toggle("hidden", !show);
}

async function createRoom(): Promise<void> {
  if (isCreatingRoom) {
    return;
  }

  isCreatingRoom = true;
  ui.confirmConfigBtn.disabled = true;

  try {
    const response = await fetch("/api/games", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ preset: ui.presetInput.value }),
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
    await bootstrapRoom(payload.roomId);
  } catch (error) {
    connectionState = "error";
    connectionError = "Не удалось создать комнату.";
    syncUi();
    requestRender();
    console.error(error);
  } finally {
    isCreatingRoom = false;
    ui.confirmConfigBtn.disabled = false;
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

function httpUrlForRoom(roomId: string): string {
  return `/api/games/${roomId}`;
}

function actionUrlForRoom(roomId: string): string {
  return `/api/games/${roomId}/actions`;
}

function tokenQuery(roomId: string): string {
  const token = loadPlayerToken(roomId);
  return token ? `?token=${encodeURIComponent(token)}` : "";
}

async function fetchSnapshot(roomId: string): Promise<void> {
  if (isFetchingSnapshot) {
    return;
  }

  isFetchingSnapshot = true;
  try {
    const response = await fetch(`${httpUrlForRoom(roomId)}${tokenQuery(roomId)}`);
    if (!response.ok) {
      throw new Error(`snapshot failed: ${response.status}`);
    }

    const snapshot = (await response.json()) as RoomSnapshot;
    roomSnapshot = snapshot;
    syncLocalSelectionWithSnapshot();
    savePlayerToken(snapshot.roomId, snapshot.playerToken);
    shareUrl = buildShareUrl(snapshot.roomId);
    if (connectionState !== "error") {
      connectionState = socket ? "connected" : "idle";
    }
    syncUi();
    requestRender();
  } catch (error) {
    connectionState = "error";
    connectionError = "Не удалось получить состояние комнаты.";
    syncUi();
    requestRender();
    console.error(error);
  } finally {
    isFetchingSnapshot = false;
  }
}

async function bootstrapRoom(roomId: string): Promise<void> {
  connectionState = "connecting";
  connectionError = "";
  syncUi();
  requestRender();

  if (!loadPlayerToken(roomId)) {
    await fetchSnapshot(roomId);
    if (!loadPlayerToken(roomId)) {
      return;
    }
  }

  connectToRoom(roomId);
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
    void fetchSnapshot(roomId);
    syncUi();
    requestRender();
  });

  nextSocket.addEventListener("message", (event) => {
    if (socket !== nextSocket) {
      return;
    }

    const data = JSON.parse(event.data) as { type: "refresh" } | { type: "error"; message: string };

    if (data.type === "error") {
      connectionState = "error";
      connectionError = data.message;
      syncUi();
      requestRender();
      return;
    }

    void fetchSnapshot(roomId);
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

async function postAction(payload: Record<string, unknown>): Promise<void> {
  if (!currentRoomId) {
    return;
  }

  const response = await fetch(`${actionUrlForRoom(currentRoomId)}${tokenQuery(currentRoomId)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`action failed: ${response.status}`);
  }

  await fetchSnapshot(currentRoomId);
}

function rerollSetup(): void {
  if (!roomSnapshot || roomSnapshot.phase !== "setup" || !roomSnapshot.canAct) {
    return;
  }
  void postAction({ type: "reroll_setup" });
}

function readySetup(): void {
  if (!roomSnapshot || roomSnapshot.phase !== "setup" || !roomSnapshot.canAct || roomSnapshot.setup.yourReady) {
    return;
  }
  void postAction({ type: "ready_setup" });
}

function handleBoardClick(col: number, row: number): void {
  if (!roomSnapshot || !canUseLocalTurnInteractions()) {
    return;
  }

  const clickedPiece = visiblePieceAt(col, row);
  const yourPlayerId = roomSnapshot.yourPlayerId;

  if (clickedPiece?.owner === yourPlayerId) {
    localSelectedPieceId = clickedPiece.id;
    setLocalStatusMessage("Фигура выбрана. Выберите соседнюю клетку для хода или атаки.");
    syncUi();
    requestRender();
    return;
  }

  const selectedPiece = visiblePieceById(localSelectedPieceId);
  if (!selectedPiece || selectedPiece.owner !== yourPlayerId) {
    setLocalStatusMessage("Сначала выберите свою фигуру.");
    syncUi();
    requestRender();
    return;
  }

  if (!isAdjacent(selectedPiece.col, selectedPiece.row, col, row)) {
    setLocalStatusMessage("Ходить можно только на 1 клетку по вертикали или горизонтали.");
    syncUi();
    requestRender();
    return;
  }

  if (!clickedPiece) {
    clearLocalSelection();
    clearLocalStatusMessage();
    syncUi();
    requestRender();
    void postAction({
      type: "move_piece",
      pieceId: selectedPiece.id,
      targetCol: col,
      targetRow: row,
    });
    return;
  }

  if (clickedPiece.owner === yourPlayerId) {
    setLocalStatusMessage("Нельзя ходить на клетку со своей фигурой.");
    syncUi();
    requestRender();
    return;
  }

  clearLocalSelection();
  clearLocalStatusMessage();
  syncUi();
  requestRender();
  void postAction({
    type: "attempt_capture",
    pieceId: selectedPiece.id,
    targetCol: col,
    targetRow: row,
  });
}

function resolveBattleChoice(choice: PieceType): void {
  if (!roomSnapshot || !roomSnapshot.canAct || roomSnapshot.phase !== "battle_pick") {
    return;
  }
  clearLocalSelection();
  clearLocalStatusMessage();
  void postAction({ type: "battle_choice", choice });
}

function syncUi(): void {
  ui.footerStatusLine.textContent = statusMessage();
  ui.footerConnectionLine.textContent = roomStatusText();
  ui.copyLinkBtn.disabled = !shareUrl;

  ui.battleChoicePanel.innerHTML = "";
  const showChoices = roomSnapshot?.phase === "battle_pick" && roomSnapshot.canAct;
  ui.battleChoicePanel.classList.toggle("hidden", !showChoices);

  if (showChoices) {
    for (const type of pieceTypes) {
      const button = document.createElement("button");
      button.textContent = typeLabels[type];
      button.addEventListener("click", () => resolveBattleChoice(type));
      ui.battleChoicePanel.appendChild(button);
    }
  }

  const showSetup = roomSnapshot?.phase === "setup" && roomSnapshot.connectedPlayers === roomSnapshot.requiredPlayers;
  ui.setupPanel.classList.toggle("hidden", !showSetup);

  if (showSetup && roomSnapshot) {
    ui.readySetupBtn.disabled = roomSnapshot.setup.yourReady;
    ui.readySetupBtn.textContent = roomSnapshot.setup.yourReady ? "Готово" : "Готов";
    ui.rerollSetupBtn.disabled = false;
    ui.setupStatusLine.textContent = roomSnapshot.setup.opponentReady
      ? "Соперник уже готов. Можно подтвердить старт или пересобрать свою линию."
      : "Пересоберите свои 16 фигур при желании. У вас 5/5/5 и одна случайная фигура.";
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
      cols: 8,
      rows: 6,
      origin: "top-left",
      xDirection: "right",
      yDirection: "down",
    },
    yourPlayerId: roomSnapshot.yourPlayerId,
    currentPlayer: roomSnapshot.currentPlayer,
    selectedPieceId: localSelectedPieceId,
    setup: roomSnapshot.setup,
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
    ui.footerConnectionLine.textContent = "Ссылка скопирована. Отправьте ее второму игроку.";
  } catch {
    ui.footerConnectionLine.textContent = shareUrl;
  }
}

const BoardScene = createBoardScene({
  getSnapshot: () => roomSnapshot,
  getSelectedPieceId: () => localSelectedPieceId,
  getViewMode: currentViewMode,
  getStatusMessage: statusMessage,
  getShareUrl: () => shareUrl,
  onBoardClick: handleBoardClick,
  onSceneReady: (scene) => {
    boardScene = scene;
  },
});

new Phaser.Game({
  type: Phaser.CANVAS,
  width: canvasWidth,
  height: canvasHeight,
  parent: ui.gameHost,
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

ui.startBtn.addEventListener("click", () => showConfigModal(true));
ui.cancelConfigBtn.addEventListener("click", () => showConfigModal(false));
ui.confirmConfigBtn.addEventListener("click", () => {
  void createRoom();
});
ui.copyLinkBtn.addEventListener("click", () => {
  void copyInviteLink();
});
ui.rerollSetupBtn.addEventListener("click", () => {
  rerollSetup();
});
ui.readySetupBtn.addEventListener("click", () => {
  readySetup();
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    showConfigModal(false);
  }
});
window.addEventListener("resize", requestRender);

window.render_game_to_text = renderGameToText;
window.advanceTime = (_ms: number) => {
  advanceTime();
};

syncUi();
requestRender();

if (currentRoomId) {
  void bootstrapRoom(currentRoomId);
}
