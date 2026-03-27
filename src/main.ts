import Phaser from "phaser";

import attackClickUrl from "./assets/attack-click.wav";
import moveClickUrl from "./assets/move-click.wav";
import { createBoardScene } from "./boardScene";
import { canvasHeight, canvasWidth } from "./constants";
import type { PieceType, PlayerId, RoomSnapshot } from "./types";
import { mountAppShell, type AppShellController, type AppShellState } from "./ui";

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("App root not found");
}

const appRoot = app;

type SnapshotSource = "bootstrap" | "poll" | "action" | "socket";

let boardScene: { renderState: (animate?: boolean) => void } | null = null;
let roomSnapshot: RoomSnapshot | null = null;
let connectionState: "idle" | "connecting" | "connected" | "error" = "idle";
let currentRoomId = getRoomIdFromUrl();
let shareUrl = currentRoomId ? buildShareUrl(currentRoomId) : "";
let socket: WebSocket | null = null;
let pollingTimer: number | null = null;
let isCreatingRoom = false;
let isFetchingSnapshot = false;
let queuedSnapshotSource: SnapshotSource | null = null;
let localSelectedPieceId: string | null = null;
let localBattleChoice: PieceType | null = null;
let localBattleRound: number | null = null;
let copyLinkLabel = "Копировать ссылку";
let isConfigModalOpen = false;
let presetValue = "standard";
let victoryTarget = 12;
let timeLimitMinutes = 5;
let ui: AppShellController | null = null;

const soundKey = "hidden-rps:sound-enabled";
type SoundAsset = {
  src: string;
  volume: number;
  objectUrl: string | null;
  preloadPromise: Promise<void> | null;
};
const soundAssets = {
  move: createSoundAsset(moveClickUrl, 0.42),
  attack: createSoundAsset(attackClickUrl, 0.5),
};
let soundEnabled = loadSoundEnabled();

function createSoundAsset(src: string, volume: number): SoundAsset {
  return {
    src,
    volume,
    objectUrl: null,
    preloadPromise: null,
  };
}

async function ensureSoundAssetLoaded(asset: SoundAsset): Promise<void> {
  if (asset.objectUrl) {
    return;
  }
  if (asset.preloadPromise) {
    await asset.preloadPromise;
    return;
  }

  asset.preloadPromise = (async () => {
    const response = await fetch(asset.src);
    if (!response.ok) {
      throw new Error(`sound preload failed: ${response.status}`);
    }
    const blob = await response.blob();
    asset.objectUrl = URL.createObjectURL(blob);
  })();

  try {
    await asset.preloadPromise;
  } finally {
    asset.preloadPromise = null;
  }
}

async function preloadSoundAssets(): Promise<void> {
  await Promise.all(Object.values(soundAssets).map((asset) => ensureSoundAssetLoaded(asset)));
}

function loadSoundEnabled(): boolean {
  const saved = window.localStorage.getItem(soundKey);
  return saved === null ? true : saved === "true";
}

function saveSoundEnabled(value: boolean): void {
  window.localStorage.setItem(soundKey, String(value));
}

function toggleSound(): void {
  soundEnabled = !soundEnabled;
  saveSoundEnabled(soundEnabled);
  syncUi();
}

function playSound(kind: keyof typeof soundAssets): void {
  if (!soundEnabled) {
    return;
  }

  const asset = soundAssets[kind];
  const audio = new Audio(asset.objectUrl ?? asset.src);
  audio.preload = "auto";
  audio.volume = asset.volume;
  void audio.play().catch(() => undefined);
}

function formatTimerLabel(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function getDisplayedTimerMs(playerId: PlayerId): number {
  if (!roomSnapshot) {
    return timeLimitMinutes * 60 * 1000;
  }
  const timer = playerId === 1 ? roomSnapshot.timers.player1 : roomSnapshot.timers.player2;
  if (!timer.running) {
    return timer.remainingMs;
  }
  return Math.max(0, timer.remainingMs - (Date.now() - roomSnapshot.snapshotTimeMs));
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

function isForbiddenKingReturn(piece: ReturnType<typeof visiblePieceById>, col: number, row: number): boolean {
  return Boolean(
    piece &&
      piece.knownType === "king" &&
      piece.forbiddenReturnCol === col &&
      piece.forbiddenReturnRow === row,
  );
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

function syncLocalBattleChoiceWithSnapshot(): void {
  const battle = roomSnapshot?.battle;
  if (roomSnapshot?.phase !== "battle_pick" || !battle) {
    localBattleChoice = null;
    localBattleRound = null;
    return;
  }

  if (localBattleRound !== battle.round) {
    localBattleRound = battle.round;
    localBattleChoice = null;
  }

  if (!battle.yourLocked) {
    localBattleChoice = null;
  }
}

function showConfigModal(show: boolean): void {
  isConfigModalOpen = show;
  syncUi();
}

async function createRoom(): Promise<void> {
  if (isCreatingRoom) {
    return;
  }

  isCreatingRoom = true;
  syncUi();

  try {
    const response = await fetch("/api/games", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        preset: presetValue,
        victory_target: victoryTarget,
        time_limit_minutes: timeLimitMinutes,
      }),
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
    syncUi();
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

function mergeSnapshotSource(
  current: SnapshotSource | null,
  next: SnapshotSource,
): SnapshotSource {
  if (current === "socket" || next === "socket") {
    return "socket";
  }
  if (current === "action" || next === "action") {
    return "action";
  }
  if (current === "bootstrap" || next === "bootstrap") {
    return "bootstrap";
  }
  return "poll";
}

async function fetchSnapshot(roomId: string, source: SnapshotSource = "poll"): Promise<void> {
  if (isFetchingSnapshot) {
    queuedSnapshotSource = mergeSnapshotSource(queuedSnapshotSource, source);
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
    syncLocalBattleChoiceWithSnapshot();
    savePlayerToken(snapshot.roomId, snapshot.playerToken);
    shareUrl = buildShareUrl(snapshot.roomId);
    if (connectionState !== "error") {
      connectionState = socket ? "connected" : "idle";
    }
    syncUi();
    requestRender(source === "socket");
  } catch (error) {
    connectionState = "error";
    syncUi();
    requestRender(false);
    console.error(error);
  } finally {
    isFetchingSnapshot = false;
    if (queuedSnapshotSource) {
      const nextSource = queuedSnapshotSource;
      queuedSnapshotSource = null;
      void fetchSnapshot(roomId, nextSource);
    }
  }
}

async function bootstrapRoom(roomId: string): Promise<void> {
  connectionState = "connecting";
  syncUi();
  requestRender();

  if (!loadPlayerToken(roomId)) {
    await fetchSnapshot(roomId, "bootstrap");
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
    void fetchSnapshot(roomId, "poll");
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
    void fetchSnapshot(roomId, "bootstrap");
    syncUi();
    requestRender(false);
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

    void fetchSnapshot(roomId, "socket");
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
    requestRender(false);
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

  await fetchSnapshot(currentRoomId, "action");

  if (payload.type === "move_piece") {
    playSound("move");
  } else if (payload.type === "attempt_capture") {
    playSound("attack");
  }
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

function requestRestart(): void {
  if (!roomSnapshot || roomSnapshot.connectedPlayers < roomSnapshot.requiredPlayers || roomSnapshot.restart) {
    return;
  }
  void postAction({ type: "request_restart" });
}

function respondRestart(accepted: boolean): void {
  if (!roomSnapshot?.restart?.awaitingYourDecision) {
    return;
  }
  void postAction({ type: "respond_restart", accepted });
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

  if (isForbiddenKingReturn(selectedPiece, col, row)) {
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
  localBattleChoice = choice;
  localBattleRound = roomSnapshot.battle?.round ?? null;
  syncUi();
  void postAction({ type: "battle_choice", choice });
}

function syncUi(): void {
  if (!ui) {
    return;
  }

  const snapshot = roomSnapshot;
  const showChoices = snapshot?.phase === "battle_pick";
  const showSetup = snapshot?.phase === "setup" && snapshot.connectedPlayers === snapshot.requiredPlayers;
  const showPassiveOpponentTurnOverlay =
    snapshot?.phase === "turn" &&
    snapshot.connectedPlayers === snapshot.requiredPlayers &&
    !snapshot.canAct;
  const isWaitingForOpponent = snapshot?.phase === "waiting";
  const isGameOver = snapshot?.phase === "game_over";
  const isRestartRequestedByYou = Boolean(snapshot?.restart?.requestedByYou);
  const isRestartAwaitingYourDecision = Boolean(snapshot?.restart?.awaitingYourDecision);
  const isOpponentDisconnected = snapshot
    ? snapshot.phase !== "waiting" &&
      snapshot.phase !== "game_over" &&
      snapshot.connectedPlayers < snapshot.requiredPlayers
    : false;
  const didYouWin = isGameOver && snapshot?.winner === snapshot?.yourPlayerId;
  const setupStatusLabel = showSetup
    ? snapshot?.setup.yourReady
      ? "Ждем соперника"
      : snapshot?.setup.opponentReady
        ? "Соперник готов"
        : "Соперник подключился"
    : null;
  const setupDetails =
    showSetup && snapshot
      ? [
          snapshot.parameters.preset === "king" ? "Режим: с королем" : "Режим: стандартный",
          snapshot.parameters.preset === "king"
            ? "Победа: съесть короля соперника"
            : `Победа: съесть ${snapshot.parameters.victoryTarget} фигур`,
          `Время: ${snapshot.parameters.timeLimitMinutes} мин. на игрока`,
          ...(snapshot.parameters.preset === "king"
            ? ["Король не может следующим ходом вернуться на предыдущую клетку"]
            : []),
        ]
      : [];
  const battlePrompt =
    snapshot?.phase === "battle_pick" && snapshot.battle
      ? snapshot.battle.yourLocked
        ? "Ждем соперника"
        : snapshot.battle.round > 1
          ? "Еще раз выберите новую фигуру"
          : "Выберите новую фигуру"
      : null;
  const yourTimerPlayerId = snapshot?.yourPlayerId ?? 2;
  const opponentTimerPlayerId = yourTimerPlayerId === 1 ? 2 : 1;
  const yourTimerMs = getDisplayedTimerMs(yourTimerPlayerId);
  const opponentTimerMs = getDisplayedTimerMs(opponentTimerPlayerId);

  let overlayTitle: string | null = null;
  let overlayDescription: string | null = null;
  let overlayPrimaryLabel: string | null = null;
  let overlaySecondaryLabel: string | null = null;
  let overlayQrValue: string | null = null;
  let overlayCompact = false;
  let overlayOutsideBoard = false;
  let onOverlayPrimary: () => void = () => undefined;
  let onOverlaySecondary: () => void = () => undefined;

  if (!currentRoomId) {
    overlayTitle = "Бокшахматы";
    overlayPrimaryLabel = "Начать";
    onOverlayPrimary = () => showConfigModal(true);
  } else if (!roomSnapshot && connectionState === "connecting") {
    overlayTitle = "Подключаемся";
    overlayDescription = "Проверяем комнату и загружаем состояние партии.";
  } else if (!roomSnapshot && connectionState === "error") {
    overlayTitle = "Комната недоступна";
    overlayPrimaryLabel = "Новая игра";
    onOverlayPrimary = () => showConfigModal(true);
  } else if (isWaitingForOpponent) {
    overlayTitle = "Ждем подключения соперника";
    overlayDescription = "Отправьте ссылку второму игроку, и партия стартует сразу после подключения.";
    overlayQrValue = shareUrl || null;
    overlayCompact = true;
    overlayOutsideBoard = true;
    overlayPrimaryLabel = copyLinkLabel;
    overlaySecondaryLabel = "Новая игра";
    onOverlayPrimary = () => {
      void copyInviteLink();
    };
    onOverlaySecondary = () => showConfigModal(true);
  } else if (isOpponentDisconnected) {
    overlayTitle = "Соперник отключился";
    overlayDescription = "Если его клиент не присылает обновления больше 5 секунд, игра ставится на паузу до переподключения.";
    overlayPrimaryLabel = copyLinkLabel;
    overlaySecondaryLabel = "Новая игра";
    onOverlayPrimary = () => {
      void copyInviteLink();
    };
    onOverlaySecondary = () => showConfigModal(true);
  } else if (isRestartAwaitingYourDecision) {
    overlayTitle = "Начать сначала";
    overlayDescription = "Соперник предлагает вернуться к экрану случайной стартовой расстановки.";
    overlayPrimaryLabel = "Согласиться";
    overlaySecondaryLabel = "Отклонить";
    onOverlayPrimary = () => respondRestart(true);
    onOverlaySecondary = () => respondRestart(false);
  } else if (isRestartRequestedByYou) {
    overlayTitle = "Ждем решения соперника";
    overlayDescription = "Если соперник согласится, вы оба вернетесь к экрану стартовой расстановки.";
  } else if (isGameOver) {
    overlayTitle = didYouWin ? "Вы победили" : "Вы проиграли";
    overlayDescription = null;
    overlayPrimaryLabel = "Начать сначала";
    overlaySecondaryLabel = "Новая игра";
    onOverlayPrimary = () => requestRestart();
    onOverlaySecondary = () => showConfigModal(true);
  }

  const nextState: AppShellState = {
    canCopyLink: Boolean(shareUrl),
    copyLinkLabel,
    soundEnabled,
    showControls: snapshot?.phase === "turn" || snapshot?.phase === "battle_pick" || isOpponentDisconnected,
    showRestartButton: snapshot ? snapshot.phase !== "waiting" : false,
    restartButtonLabel: isRestartRequestedByYou ? "Ждем ответа..." : "Начать сначала",
    restartButtonDisabled:
      !snapshot ||
      snapshot.connectedPlayers < snapshot.requiredPlayers ||
      isRestartRequestedByYou ||
      isRestartAwaitingYourDecision,
    showTimers: Boolean(snapshot),
    yourTimerLabel: formatTimerLabel(yourTimerMs),
    opponentTimerLabel: formatTimerLabel(opponentTimerMs),
    yourTimerRunning: Boolean(snapshot && (yourTimerPlayerId === 1 ? snapshot.timers.player1.running : snapshot.timers.player2.running)),
    opponentTimerRunning: Boolean(snapshot && (opponentTimerPlayerId === 1 ? snapshot.timers.player1.running : snapshot.timers.player2.running)),
    yourTimerTone: yourTimerPlayerId === 1 ? "player1" : "player2",
    opponentTimerTone: opponentTimerPlayerId === 1 ? "player1" : "player2",
    showBattleChoices: showChoices,
    battlePrompt,
    battleChoiceLocked: Boolean(snapshot?.phase === "battle_pick" && snapshot.battle?.yourLocked),
    selectedBattleChoice: localBattleChoice,
    showSetup,
    setupStatusLabel,
    setupDetails,
    readyDisabled: Boolean(showSetup && snapshot?.setup.yourReady),
    readyLabel: "Начать игру",
    rerollDisabled: false,
    showModal: isConfigModalOpen,
    presetValue,
    victoryTarget,
    timeLimitMinutes,
    choicePlayerId: snapshot?.yourPlayerId ?? 1,
    overlayTitle,
    overlayDescription,
    overlayPrimaryLabel,
    overlaySecondaryLabel,
    overlayQrValue,
    overlayCompact,
    overlayOutsideBoard,
    passiveOverlayLabel: showPassiveOpponentTurnOverlay ? "Ход соперника" : null,
    onStart: () => showConfigModal(true),
    onRestart: () => requestRestart(),
    onToggleSound: () => toggleSound(),
    onCopyLink: () => {
      void copyInviteLink();
    },
    onBattleChoice: (type) => resolveBattleChoice(type),
    onReroll: () => rerollSetup(),
    onReady: () => readySetup(),
    onPresetChange: (value) => {
      presetValue = value;
      victoryTarget = value === "king" ? 16 : 12;
      syncUi();
    },
    onVictoryTargetChange: (value) => {
      victoryTarget = value;
      syncUi();
    },
    onTimeLimitChange: (value) => {
      timeLimitMinutes = value;
      syncUi();
    },
    onCancelModal: () => showConfigModal(false),
    onConfirmModal: () => {
      void createRoom();
    },
    onOverlayPrimary,
    onOverlaySecondary,
  };

  ui.update(nextState);
}

function requestRender(animate = false): void {
  boardScene?.renderState(animate);
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
    restart: roomSnapshot.restart,
    timers: roomSnapshot.timers,
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
    copyLinkLabel = "Скопировано";
  } catch {
    if (legacyCopyText(shareUrl)) {
      copyLinkLabel = "Скопировано";
      syncUi();
      return;
    }
    copyLinkLabel = "Ссылка не скопирована";
  } finally {
    syncUi();
    window.setTimeout(() => {
      copyLinkLabel = defaultLabel;
      syncUi();
    }, 1600);
  }
}

async function initialize(): Promise<void> {
  try {
    await preloadSoundAssets();
  } catch (error) {
    console.error(error);
  }
  ui = await mountAppShell(appRoot);

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

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      showConfigModal(false);
    }
  });
  window.addEventListener("resize", () => requestRender(false));
  window.setInterval(() => {
    if (roomSnapshot && (roomSnapshot.timers.player1.running || roomSnapshot.timers.player2.running)) {
      syncUi();
    }
  }, 250);

  window.render_game_to_text = renderGameToText;
  window.advanceTime = (_ms: number) => {
    advanceTime();
  };

  syncUi();
  requestRender();

  if (currentRoomId) {
    await bootstrapRoom(currentRoomId);
  }
}

void initialize();
