import { canvasWidth } from "./constants";

export interface AppShellRefs {
  root: HTMLDivElement;
  startBtn: HTMLButtonElement;
  copyLinkBtn: HTMLButtonElement;
  battleChoicePanel: HTMLDivElement;
  setupPanel: HTMLDivElement;
  rerollSetupBtn: HTMLButtonElement;
  readySetupBtn: HTMLButtonElement;
  setupStatusLine: HTMLDivElement;
  footerStatusLine: HTMLSpanElement;
  footerConnectionLine: HTMLSpanElement;
  gameHost: HTMLDivElement;
  modalRoot: HTMLDivElement;
  presetInput: HTMLSelectElement;
  cancelConfigBtn: HTMLButtonElement;
  confirmConfigBtn: HTMLButtonElement;
}

export function createAppShell(app: HTMLDivElement): AppShellRefs {
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
      position: relative;
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
    .setup-panel {
      position: absolute;
      left: 50%;
      top: 50%;
      transform: translate(-50%, -50%);
      display: grid;
      justify-items: center;
      gap: 10px;
      padding: 14px 18px;
      border-radius: 22px;
      background: rgba(255, 255, 255, 0.9);
      border: 1px solid rgba(19,33,47,0.12);
      box-shadow: 0 16px 40px rgba(19,33,47,0.18);
      backdrop-filter: blur(10px);
      min-width: 260px;
      text-align: center;
    }
    .setup-panel .setup-actions {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      justify-content: center;
    }
    .setup-panel .setup-status {
      font-size: 13px;
      color: var(--muted);
      max-width: 280px;
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

  app.innerHTML = `
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
        </div>
      </div>
      <div class="board-wrap">
        <div id="game-host"></div>
        <div id="setup-panel" class="setup-panel hidden">
          <div class="setup-actions">
            <button id="ready-setup-btn">Готов</button>
            <button id="reroll-setup-btn" class="secondary">Пересбросить</button>
          </div>
          <div id="setup-status" class="setup-status"></div>
        </div>
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

  const startBtn = app.querySelector<HTMLButtonElement>("#start-btn");
  const copyLinkBtn = app.querySelector<HTMLButtonElement>("#copy-link-btn");
  const battleChoicePanel = app.querySelector<HTMLDivElement>("#choice-panel");
  const setupPanel = app.querySelector<HTMLDivElement>("#setup-panel");
  const rerollSetupBtn = app.querySelector<HTMLButtonElement>("#reroll-setup-btn");
  const readySetupBtn = app.querySelector<HTMLButtonElement>("#ready-setup-btn");
  const setupStatusLine = app.querySelector<HTMLDivElement>("#setup-status");
  const footerStatusLine = app.querySelector<HTMLSpanElement>("#status-line");
  const footerConnectionLine = app.querySelector<HTMLSpanElement>("#connection-line");
  const gameHost = app.querySelector<HTMLDivElement>("#game-host");
  const modalRoot = app.querySelector<HTMLDivElement>("#config-modal");
  const presetInput = app.querySelector<HTMLSelectElement>("#preset-select");
  const cancelConfigBtn = app.querySelector<HTMLButtonElement>("#cancel-config-btn");
  const confirmConfigBtn = app.querySelector<HTMLButtonElement>("#confirm-config-btn");

  if (
    !startBtn ||
    !copyLinkBtn ||
    !battleChoicePanel ||
    !setupPanel ||
    !rerollSetupBtn ||
    !readySetupBtn ||
    !setupStatusLine ||
    !footerStatusLine ||
    !footerConnectionLine ||
    !gameHost ||
    !modalRoot ||
    !presetInput ||
    !cancelConfigBtn ||
    !confirmConfigBtn
  ) {
    throw new Error("Required UI elements not found");
  }

  return {
    root: app,
    startBtn,
    copyLinkBtn,
    battleChoicePanel,
    setupPanel,
    rerollSetupBtn,
    readySetupBtn,
    setupStatusLine,
    footerStatusLine,
    footerConnectionLine,
    gameHost,
    modalRoot,
    presetInput,
    cancelConfigBtn,
    confirmConfigBtn,
  };
}
