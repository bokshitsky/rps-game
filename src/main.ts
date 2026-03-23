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
    connectToRoom(payload.roomId);
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
    ui.footerConnectionLine.textContent = "Ссылка скопирована. Отправьте ее второму игроку.";
  } catch {
    ui.footerConnectionLine.textContent = shareUrl;
  }
}

async function toggleFullscreen(): Promise<void> {
  if (!document.fullscreenElement) {
    await ui.root.requestFullscreen();
  } else {
    await document.exitFullscreen();
  }
}

const BoardScene = createBoardScene({
  getSnapshot: () => roomSnapshot,
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
ui.fullscreenBtn.addEventListener("click", () => {
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

document.addEventListener("fullscreenchange", requestRender);
window.addEventListener("resize", requestRender);

window.render_game_to_text = renderGameToText;
window.advanceTime = (_ms: number) => {
  advanceTime();
};

syncUi();
requestRender();

if (currentRoomId) {
  connectToRoom(currentRoomId);
}
