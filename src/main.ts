import Phaser from "phaser";

import { createBoardScene } from "./boardScene";
import { canvasHeight, canvasWidth, pieceTypes } from "./constants";
import type { PieceType, PlayerId, RoomSnapshot } from "./types";
import { createAppShell } from "./ui";

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("App root not found");
}

const ui = createAppShell(app);

let boardScene: { renderState: () => void } | null = null;
let roomSnapshot: RoomSnapshot | null = null;
let connectionState: "idle" | "connecting" | "connected" | "error" = "idle";
let currentRoomId = getRoomIdFromUrl();
let shareUrl = currentRoomId ? buildShareUrl(currentRoomId) : "";
let socket: WebSocket | null = null;
let pollingTimer: number | null = null;
let isCreatingRoom = false;
let isFetchingSnapshot = false;
let localSelectedPieceId: string | null = null;

function battleChoiceIcon(type: PieceType): string {
  const svg =
    type === "rock"
      ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path fill="#9aa3af" d="M18 48 9 36l8-15 19-7 14 8 4 18-11 11z"/><path fill="#cbd5e1" d="m19 34 8-10 13-4 6 4-10 9z"/><path fill="none" stroke="#243140" stroke-width="4" stroke-linejoin="round" d="M18 48 9 36l8-15 19-7 14 8 4 18-11 11z"/></svg>`
      : type === "paper"
        ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect x="16" y="10" width="32" height="44" rx="3" fill="#fffdf7"/><path fill="#dbe4ef" d="M22 18h20v3H22zm0 9h20v3H22zm0 9h16v3H22z"/><rect x="16" y="10" width="32" height="44" rx="3" fill="none" stroke="#243140" stroke-width="4"/></svg>`
        : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="20" cy="16" r="8" fill="#f7c948"/><circle cx="42" cy="16" r="8" fill="#f7c948"/><circle cx="20" cy="16" r="8" fill="none" stroke="#243140" stroke-width="4"/><circle cx="42" cy="16" r="8" fill="none" stroke="#243140" stroke-width="4"/><path d="M23 22 31 30" stroke="#243140" stroke-width="4" stroke-linecap="round"/><path d="M39 22 31 30" stroke="#243140" stroke-width="4" stroke-linecap="round"/><path d="M31 30 16 50" stroke="#bfc7d2" stroke-width="7" stroke-linecap="round"/><path d="M31 30 48 50" stroke="#bfc7d2" stroke-width="7" stroke-linecap="round"/><path d="M31 30 16 50" stroke="#243140" stroke-width="3" stroke-linecap="round"/><path d="M31 30 48 50" stroke="#243140" stroke-width="3" stroke-linecap="round"/></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

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

function canUseLocalTurnInteractions(): boolean {
  return Boolean(roomSnapshot && roomSnapshot.canAct && roomSnapshot.phase === "turn");
}

function clearLocalSelection(): void {
  localSelectedPieceId = null;
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
    return;
  }

  const selectedPiece = visiblePieceById(localSelectedPieceId);
  if (!selectedPiece || selectedPiece.owner !== roomSnapshot?.yourPlayerId) {
    clearLocalSelection();
  }
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
    showConfigModal(false);
    syncUi();
    requestRender();
    await bootstrapRoom(payload.roomId);
  } catch (error) {
    connectionState = "error";
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
    syncUi();
    requestRender();
    console.error(error);
  } finally {
    isFetchingSnapshot = false;
  }
}

async function bootstrapRoom(roomId: string): Promise<void> {
  connectionState = "connecting";
  syncUi();
  requestRender();

  if (!loadPlayerToken(roomId)) {
    await fetchSnapshot(roomId);
    if (!loadPlayerToken(roomId)) {
      return;
    }
  }

  startPolling(roomId);
  connectToRoom(roomId);
}

function stopPolling(): void {
  if (pollingTimer !== null) {
    window.clearInterval(pollingTimer);
    pollingTimer = null;
  }
}

function startPolling(roomId: string): void {
  stopPolling();
  pollingTimer = window.setInterval(() => {
    if (currentRoomId !== roomId) {
      stopPolling();
      return;
    }
    void fetchSnapshot(roomId);
  }, 2500);
}

function connectToRoom(roomId: string): void {
  if (socket) {
    socket.close();
  }

  connectionState = "connecting";
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
    syncUi();
    requestRender();
    return;
  }

  const selectedPiece = visiblePieceById(localSelectedPieceId);
  if (!selectedPiece || selectedPiece.owner !== yourPlayerId) {
    syncUi();
    requestRender();
    return;
  }

  if (!isAdjacent(selectedPiece.col, selectedPiece.row, col, row)) {
    syncUi();
    requestRender();
    return;
  }

  if (!clickedPiece) {
    clearLocalSelection();
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
    syncUi();
    requestRender();
    return;
  }

  clearLocalSelection();
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
  void postAction({ type: "battle_choice", choice });
}

function syncUi(): void {
  ui.copyLinkBtn.disabled = !shareUrl;

  ui.battleChoicePanel.innerHTML = "";
  const showChoices = roomSnapshot?.phase === "battle_pick" && roomSnapshot.canAct;
  ui.battleChoicePanel.classList.toggle("hidden", !showChoices);

  if (showChoices) {
    for (const type of pieceTypes) {
      const button = document.createElement("button");
      const icon = document.createElement("img");
      icon.src = battleChoiceIcon(type);
      icon.alt = type;
      button.appendChild(icon);
      button.title = type;
      button.setAttribute("aria-label", type);
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
    ui.setupStatusLine.textContent = "";
  }
}

function requestRender(): void {
  boardScene?.renderState();
}

function renderGameToText(): string {
  if (!roomSnapshot) {
    return JSON.stringify({
      mode: currentRoomId ? connectionState : "home",
      connectionState,
      roomId: currentRoomId,
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

function legacyCopyText(text: string): boolean {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();

  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    document.body.removeChild(textarea);
  }
}

async function copyInviteLink(): Promise<void> {
  if (!shareUrl) {
    return;
  }

  const defaultLabel = "Копировать ссылку";
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(shareUrl);
    } else if (!legacyCopyText(shareUrl)) {
      throw new Error("clipboard unavailable");
    }
    ui.copyLinkBtn.textContent = "Скопировано";
  } catch {
    if (legacyCopyText(shareUrl)) {
      ui.copyLinkBtn.textContent = "Скопировано";
      return;
    }
    ui.copyLinkBtn.textContent = "Ссылка не скопирована";
  } finally {
    window.setTimeout(() => {
      ui.copyLinkBtn.textContent = defaultLabel;
    }, 1600);
  }
}

const BoardScene = createBoardScene({
  getSnapshot: () => roomSnapshot,
  getSelectedPieceId: () => localSelectedPieceId,
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
