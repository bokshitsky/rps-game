import { createRoot, type Root } from "react-dom/client";
import type { ChangeEvent, RefCallback } from "react";

import { canvasHeight, canvasWidth, pieceTypes } from "./constants";
import type { PieceType } from "./types";
import "./ui.css";

function battleChoiceIcon(type: PieceType): string {
  const svg =
    type === "rock"
      ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path fill="#9aa3af" d="M18 48 9 36l8-15 19-7 14 8 4 18-11 11z"/><path fill="#cbd5e1" d="m19 34 8-10 13-4 6 4-10 9z"/><path fill="none" stroke="#243140" stroke-width="4" stroke-linejoin="round" d="M18 48 9 36l8-15 19-7 14 8 4 18-11 11z"/></svg>`
      : type === "paper"
        ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect x="16" y="10" width="32" height="44" rx="3" fill="#fffdf7"/><path fill="#dbe4ef" d="M22 18h20v3H22zm0 9h20v3H22zm0 9h16v3H22z"/><rect x="16" y="10" width="32" height="44" rx="3" fill="none" stroke="#243140" stroke-width="4"/></svg>`
        : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="20" cy="16" r="8" fill="#f7c948"/><circle cx="42" cy="16" r="8" fill="#f7c948"/><circle cx="20" cy="16" r="8" fill="none" stroke="#243140" stroke-width="4"/><circle cx="42" cy="16" r="8" fill="none" stroke="#243140" stroke-width="4"/><path d="M23 22 31 30" stroke="#243140" stroke-width="4" stroke-linecap="round"/><path d="M39 22 31 30" stroke="#243140" stroke-width="4" stroke-linecap="round"/><path d="M31 30 16 50" stroke="#bfc7d2" stroke-width="7" stroke-linecap="round"/><path d="M31 30 48 50" stroke="#bfc7d2" stroke-width="7" stroke-linecap="round"/><path d="M31 30 16 50" stroke="#243140" stroke-width="3" stroke-linecap="round"/><path d="M31 30 48 50" stroke="#243140" stroke-width="3" stroke-linecap="round"/></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export interface AppShellState {
  canCopyLink: boolean;
  copyLinkLabel: string;
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
  overlayTitle: string | null;
  overlayDescription: string | null;
  overlayPrimaryLabel: string | null;
  overlaySecondaryLabel: string | null;
  passiveOverlayLabel: string | null;
  onStart: () => void;
  onRestart: () => void;
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
  overlayTitle: "Новая игра",
  overlayDescription: null,
  overlayPrimaryLabel: "Новая игра",
  overlaySecondaryLabel: null,
  passiveOverlayLabel: null,
  onStart: () => undefined,
  onRestart: () => undefined,
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
                      src={battleChoiceIcon(type)}
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
            <p>Пока добавлен стартовый пресет. Позже сюда можно вынести реальные настройки партии.</p>
            <label htmlFor="preset-select">Пресет</label>
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
            <label htmlFor="victory-target-range">Сколько фигур нужно съесть для победы: {state.victoryTarget}</label>
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
            <div className="modal-actions">
              <button
                className="secondary"
                onClick={state.onCancelModal}
              >
                Отмена
              </button>
              <button onClick={state.onConfirmModal}>Создать ссылку</button>
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
