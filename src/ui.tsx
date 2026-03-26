import { createRoot, type Root } from "react-dom/client";
import type { ChangeEvent, RefCallback } from "react";

import { canvasHeight, canvasWidth, pieceTypes } from "./constants";
import { createPieceIconDataUrl } from "./pieceArt";
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
  showBattleChoices: boolean;
  showSetup: boolean;
  readyDisabled: boolean;
  readyLabel: string;
  rerollDisabled: boolean;
  showModal: boolean;
  presetValue: string;
  victoryTarget: number;
  choicePlayerId: PlayerId;
  overlayTitle: string | null;
  overlayDescription: string | null;
  overlayPrimaryLabel: string | null;
  overlaySecondaryLabel: string | null;
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
  showBattleChoices: false,
  showSetup: false,
  readyDisabled: false,
  readyLabel: "Готов",
  rerollDisabled: false,
  showModal: false,
  presetValue: "standard",
  victoryTarget: 12,
  choicePlayerId: 1,
  overlayTitle: "Новая игра",
  overlayDescription: null,
  overlayPrimaryLabel: "Начать",
  overlaySecondaryLabel: null,
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

  return (
    <div className="shell">
      <div className="shell-layout">
        {state.showControls ? (
          <div className="controls-dock">
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
        ) : null}

        <div className="board-wrap">
          <div
            className="board-stage"
            style={{ aspectRatio }}
          >
            <div
              id="game-host"
              ref={onGameHostRef}
            />

            {state.overlayTitle ? (
              <div className="overlay-panel">
                <div className="overlay-card">
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
                </div>
              </div>
            ) : null}

            {state.passiveOverlayLabel ? (
              <div className="passive-turn-overlay">
                <div className="passive-turn-label">{state.passiveOverlayLabel}</div>
              </div>
            ) : null}

            {state.showBattleChoices ? (
              <div className="choice-row">
                {pieceTypes.map((type) => (
                      <button
                        key={type}
                        onClick={() => state.onBattleChoice(type)}
                        title={type}
                        aria-label={type}
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
                    Пересбросить
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>

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
