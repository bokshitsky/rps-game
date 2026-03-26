Original prompt: Я хочу разработать игру одна должна В ИТОГЕ запускаться на любой платформе, поэтому делай её на html+typescript-технологиях. Игра должна работать по принципу "камень - ножницы - бумага". на доске 8х6 есть два игрока. У каждого игрока 16 фигурок из них 6-6-6 фигурок каждого типа. Игроки ходят по очереди. Как только сталкиваются две фигурки - одна из них побеждает. Если у фигурок одинаковые типы - игроки выбирают какой-то новый тип для своих фигурок и сравнение повторяется. Игроки НЕ ЗНАЮТ тип фигурок соперника.

Notes:
- Assumption: use 18 pieces per player because 6-6-6 is explicit and sums to 18, while "16" appears inconsistent.
- Planned implementation: local hot-seat prototype in HTML + TypeScript with hidden information, automatic starting layout, orthogonal movement, and repeated tie resolution with secret re-selection.

- npm install completed.
- First build failed with TS syntax error around src/main.ts line 196.

- Pinned Vite to v6 for Node compatibility and refreshed dependencies.

- Fixed strict TypeScript DOM typing and global window hook declarations.

- Installed Playwright and Chromium for browser verification.
- Playwright client succeeded against the local dev server and produced screenshot/state artifacts in output/web-game.

- Switched rendering/input to Phaser 3 and updated starting layout to a chess-like back-rank formation.
- Production build passes; noted a large bundle warning from Phaser.

- Replaced text markers with procedural Phaser pixel-art character sprites carrying hidden RPS items behind their backs.

- Increased board render resolution and sprite scale for better visibility.
- Hidden enemy pieces now render as plain characters with no visible item.

- Added FastAPI multiplayer backend with room creation, invite-link flow, and WebSocket snapshots.
- Reworked frontend to create/join rooms and render server-driven multiplayer state.

- Switched Python dependency management to Poetry with in-project .venv and installed FastAPI/Uvicorn there.

- Fixed hidden modal CSS so it no longer intercepts clicks in the multiplayer lobby flow.

- Verified multiplayer room flow end to end with separate browser contexts: host creates link, guest joins, both receive active match state.

- Split src/main.ts into smaller modules: constants, types, utils, UI shell, and Phaser board scene.

- Switched multiplayer transport to HTTP for actions and state fetches, with WebSocket used only as a refresh signal.

- Moved board perspective handling to the frontend renderer so player 2 now sees the board rotated like a chess opponent view; clicks are translated back into logical server coordinates.
- Split server/app.py into package modules: server models, constants, schemas, and room manager logic, with app.py left as the FastAPI entrypoint.
- Reworked match start into a setup phase: 16 pieces in two back rows, random 5/5/5 plus one extra type, reroll support per player, and match start only after both players press Ready.

- Added client-only animation payloads in room snapshots:
  - `animationHint` for move/attack transitions
  - battle snapshot now exposes attacker/defender ids and current types so battle UI and board use the same sprites
- Movement animation is now triggered only when snapshot refresh comes from WebSocket; polling, bootstrap, and immediate HTTP action fetches do a plain rerender.
- Added fetch-source queueing on the client so a WebSocket refresh is not lost if it arrives during an in-flight HTTP fetch.
- Attack flow updates:
  - defender type is always revealed at attack time
  - both pieces move toward the center on decisive combat
  - if combat is tied, both pieces stay in place until players submit new simultaneous choices
  - after combat, the winner is revealed to the opponent for 2 turns
- Validation:
  - `npm run build` passes
  - `poetry run python -m py_compile server/models.py server/manager.py` passes
  - Runtime browser verification is currently blocked in this sandbox because binding a local server port is denied (`operation not permitted` on `127.0.0.1:8000`).
