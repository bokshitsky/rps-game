import { createRoot, type Root } from "react-dom/client";
import type { ChangeEvent, RefCallback } from "react";

import { canvasHeight, canvasWidth, pieceTypes } from "./constants";
import { createPieceIconDataUrl } from "./pieceArt";
import { createQrSvgDataUrl } from "./qrCode";
import type { PieceType, PlayerId } from "./types";
import "./ui.css";

export interface AppShellState {
  canCopyLink: boolean;
  copyLinkLabel: string;
  soundEnabled: boolean;
  showControls: boolean;
  showRestartButton: boolean;
  restartButtonLabel: string;
  restartButtonDisabled: boolean;
  showTimers: boolean;
  yourTimerLabel: string;
  opponentTimerLabel: string;
  yourTimerRunning: boolean;
  opponentTimerRunning: boolean;
  yourTimerTone: "player1" | "player2";
  opponentTimerTone: "player1" | "player2";
  showBattleChoices: boolean;
  battlePrompt: string | null;
  battleChoiceLocked: boolean;
  selectedBattleChoice: PieceType | null;
  showSetup: boolean;
  setupStatusLabel: string | null;
  readyDisabled: boolean;
  readyLabel: string;
  rerollDisabled: boolean;
  showModal: boolean;
  presetValue: string;
  victoryTarget: number;
  timeLimitMinutes: number;
  choicePlayerId: PlayerId;
  overlayTitle: string | null;
  overlayDescription: string | null;
  overlayPrimaryLabel: string | null;
  overlaySecondaryLabel: string | null;
  overlayQrValue: string | null;
  overlayCompact: boolean;
  overlayOutsideBoard: boolean;
  passiveOverlayLabel: string | null;
  onStart: () => void;
  onRestart: () => void;
  onToggleSound: () => void;
  onCopyLink: () => void;
  onBattleChoice: (type: PieceType) => void;
  onReroll: () => void;
  onReady: () => void;
  onPresetChange: (value: string) => void;
  onVictoryTargetChange: (value: number) => void;
  onTimeLimitChange: (value: number) => void;
  onCancelModal: () => void;
  onConfirmModal: () => void;
  onOverlayPrimary: () => void;
  onOverlaySecondary: () => void;
}

export interface AppShellController {
  gameHost: HTMLDivElement;
  update: (state: AppShellState) => void;
}

const defaultState: AppShellState = {
  canCopyLink: false,
  copyLinkLabel: "Копировать ссылку",
  soundEnabled: true,
  showControls: true,
  showRestartButton: false,
  restartButtonLabel: "Начать сначала",
  restartButtonDisabled: false,
  showTimers: false,
  yourTimerLabel: "05:00",
  opponentTimerLabel: "05:00",
  yourTimerRunning: false,
  opponentTimerRunning: false,
  yourTimerTone: "player2",
  opponentTimerTone: "player1",
  showBattleChoices: false,
  battlePrompt: null,
  battleChoiceLocked: false,
  selectedBattleChoice: null,
  showSetup: false,
  setupStatusLabel: null,
  readyDisabled: false,
  readyLabel: "Начать игру",
  rerollDisabled: false,
  showModal: false,
  presetValue: "standard",
  victoryTarget: 12,
  timeLimitMinutes: 5,
  choicePlayerId: 1,
  overlayTitle: "Бокшахматы",
  overlayDescription: null,
  overlayPrimaryLabel: "Начать",
  overlaySecondaryLabel: null,
  overlayQrValue: null,
  overlayCompact: false,
  overlayOutsideBoard: false,
  passiveOverlayLabel: null,
  onStart: () => undefined,
  onRestart: () => undefined,
  onToggleSound: () => undefined,
  onCopyLink: () => undefined,
  onBattleChoice: () => undefined,
  onReroll: () => undefined,
  onReady: () => undefined,
  onPresetChange: () => undefined,
  onVictoryTargetChange: () => undefined,
  onTimeLimitChange: () => undefined,
  onCancelModal: () => undefined,
  onConfirmModal: () => undefined,
  onOverlayPrimary: () => undefined,
  onOverlaySecondary: () => undefined,
};

function renderApp(
  root: Root,
  state: AppShellState,
  onGameHostRef: RefCallback<HTMLDivElement>,
): void {
  root.render(
    <AppShell
      state={state}
      onGameHostRef={onGameHostRef}
    />,
  );
}

interface AppShellProps {
  state: AppShellState;
  onGameHostRef: RefCallback<HTMLDivElement>;
}

function AppShell({ state, onGameHostRef }: AppShellProps) {
  const aspectRatio = `${canvasWidth} / ${canvasHeight}`;
  const modeDescription =
    state.presetValue === "king"
      ? "Цель игры: съесть фигуру короля соперника."
      : "Цель игры: съесть нужное число фигур соперника.";
  const overlayQrUrl = state.overlayQrValue ? createQrSvgDataUrl(state.overlayQrValue) : null;
  const overlayContent = state.overlayTitle ? (
    <div className="overlay-panel">
      <div className={`overlay-card${state.overlayCompact ? " overlay-card-compact" : ""}`}>
        <h2>{state.overlayTitle}</h2>
        {state.overlayDescription ? <p>{state.overlayDescription}</p> : null}
        <div className="overlay-actions">
          {state.overlayPrimaryLabel ? (
            <button onClick={state.onOverlayPrimary}>{state.overlayPrimaryLabel}</button>
          ) : null}
          {state.overlaySecondaryLabel ? (
            <button
              className="secondary"
              onClick={state.onOverlaySecondary}
            >
              {state.overlaySecondaryLabel}
            </button>
          ) : null}
        </div>
        {overlayQrUrl ? (
          <div className="overlay-qr">
            <img
              src={overlayQrUrl}
              alt="QR-код для ссылки на игру"
            />
          </div>
        ) : null}
      </div>
    </div>
  ) : null;

  return (
    <div className="shell">
      <div className="shell-layout">
        {state.showControls ? (
          <div className="controls-dock">
            <div className="controls-column">
              <div className="actions">
                <button onClick={state.onStart}>Новая игра</button>
                <button
                  className="secondary"
                  onClick={state.onToggleSound}
                >
                  {state.soundEnabled ? "Звук: вкл" : "Звук: выкл"}
                </button>
                {state.showRestartButton ? (
                  <button
                    className="secondary"
                    onClick={state.onRestart}
                    disabled={state.restartButtonDisabled}
                  >
                    {state.restartButtonLabel}
                  </button>
                ) : null}
                <button
                  className="secondary"
                  onClick={state.onCopyLink}
                  disabled={!state.canCopyLink}
                >
                  {state.copyLinkLabel}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        <div className="board-wrap">
          <div className="board-shell">
            {state.showTimers ? (
              <div className="board-timer-row board-timer-row-top">
                <div className={`board-timer board-timer-${state.opponentTimerTone}${state.opponentTimerRunning ? " running" : ""}`}>
                  {state.opponentTimerLabel}
                </div>
              </div>
            ) : null}

            <div
              className="board-stage"
              style={{ aspectRatio }}
            >
              <div
                id="game-host"
                ref={onGameHostRef}
              />

              {!state.overlayOutsideBoard ? overlayContent : null}

              {state.passiveOverlayLabel ? (
                <div className="passive-turn-overlay">
                  <div className="passive-turn-label">{state.passiveOverlayLabel}</div>
                </div>
              ) : null}

              {state.showBattleChoices ? (
                <div className="choice-row">
                  {state.battlePrompt ? <div className="choice-row-title">{state.battlePrompt}</div> : null}
                  {pieceTypes.map((type) => (
                    <button
                      key={type}
                      className={state.selectedBattleChoice === type ? "selected" : ""}
                      onClick={() => state.onBattleChoice(type)}
                      title={type}
                      aria-label={type}
                      disabled={state.battleChoiceLocked}
                    >
                      <img
                        src={createPieceIconDataUrl(state.choicePlayerId, type)}
                        alt={type}
                      />
                    </button>
                  ))}
                </div>
              ) : null}

              {state.showSetup ? (
                <div className="setup-panel">
                  {state.setupStatusLabel ? (
                    <div className="setup-status">{state.setupStatusLabel}</div>
                  ) : null}
                  <div className="setup-actions">
                    <button
                      onClick={state.onReady}
                      disabled={state.readyDisabled}
                    >
                      {state.readyLabel}
                    </button>
                    <button
                      className="secondary"
                      onClick={state.onReroll}
                      disabled={state.rerollDisabled}
                    >
                      Поменять расстановку
                    </button>
                  </div>
                </div>
              ) : null}
            </div>

            {state.showTimers ? (
              <div className="board-timer-row board-timer-row-bottom">
                <div className={`board-timer board-timer-${state.yourTimerTone}${state.yourTimerRunning ? " running" : ""}`}>
                  {state.yourTimerLabel}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {state.overlayOutsideBoard ? <div className="overlay-floating">{overlayContent}</div> : null}

      {state.showModal ? (
        <div className="modal-backdrop">
          <div className="modal">
            <h2>Параметры Игры</h2>
            <div className="modal-body">
              <div className="modal-field">
                <label htmlFor="preset-select">Режим</label>
                <select
                  id="preset-select"
                  value={state.presetValue}
                  onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                    state.onPresetChange(event.target.value)
                  }
                >
                  <option value="standard">Стандартная партия</option>
                  <option value="king">Режим с королем</option>
                </select>
                <p className="modal-hint">{modeDescription}</p>
              </div>
              <div className="modal-field">
                <label htmlFor="victory-target-range">
                  Сколько фигур нужно съесть для победы: {state.victoryTarget}
                </label>
                <input
                  id="victory-target-range"
                  type="range"
                  min="1"
                  max="16"
                  step="1"
                  value={state.victoryTarget}
                  onChange={(event: ChangeEvent<HTMLInputElement>) =>
                    state.onVictoryTargetChange(Number(event.target.value))
                  }
                />
              </div>
              <div className="modal-field">
                <label htmlFor="time-limit-range">
                  Лимит времени: {state.timeLimitMinutes} мин.
                </label>
                <input
                  id="time-limit-range"
                  type="range"
                  min="1"
                  max="15"
                  step="1"
                  value={state.timeLimitMinutes}
                  onChange={(event: ChangeEvent<HTMLInputElement>) =>
                    state.onTimeLimitChange(Number(event.target.value))
                  }
                />
              </div>
            </div>
            <div className="modal-actions">
              <button
                className="secondary"
                onClick={state.onCancelModal}
              >
                Отмена
              </button>
              <button onClick={state.onConfirmModal}>Создать игру</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function mountAppShell(app: HTMLDivElement): Promise<AppShellController> {
  const root = createRoot(app);
  let currentState = defaultState;
  let gameHost: HTMLDivElement | null = null;

  return new Promise((resolve) => {
    const controller: AppShellController = {
      gameHost: app,
      update(nextState: AppShellState) {
        currentState = nextState;
        renderApp(root, currentState, handleGameHostRef);
      },
    };

    const handleGameHostRef: RefCallback<HTMLDivElement> = (node) => {
      if (!node) {
        return;
      }

      gameHost = node;
      controller.gameHost = node;

      if (gameHost) {
        resolve(controller);
      }
    };

    renderApp(root, currentState, handleGameHostRef);
  });
}
