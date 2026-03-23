import fs from "node:fs";
import { chromium } from "playwright";

const outDir = "output/multiplayer-check";
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });

try {
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();

  const host = await hostContext.newPage();
  await host.goto("http://127.0.0.1:8000", { waitUntil: "networkidle" });
  await host.click("#start-btn");
  await host.click("#confirm-config-btn");
  await host.waitForURL(/room=/);
  const inviteUrl = host.url();

  await host.screenshot({ path: `${outDir}/host-waiting.png`, fullPage: true });
  const waitingState = await host.evaluate(() => window.render_game_to_text());

  const guest = await guestContext.newPage();
  await guest.goto(inviteUrl, { waitUntil: "networkidle" });

  await guest.waitForFunction(() => {
    const raw = window.render_game_to_text();
    if (!raw) return false;
    const data = JSON.parse(raw);
    return data.mode === "turn" && Array.isArray(data.visiblePieces) && data.visiblePieces.length === 36;
  });

  await host.waitForFunction(() => {
    const raw = window.render_game_to_text();
    if (!raw) return false;
    const data = JSON.parse(raw);
    return data.mode === "turn" && Array.isArray(data.visiblePieces) && data.visiblePieces.length === 36;
  });

  const hostState = await host.evaluate(() => window.render_game_to_text());
  const guestState = await guest.evaluate(() => window.render_game_to_text());

  await host.screenshot({ path: `${outDir}/host-active.png`, fullPage: true });
  await guest.screenshot({ path: `${outDir}/guest-active.png`, fullPage: true });

  fs.writeFileSync(`${outDir}/waiting-state.json`, waitingState);
  fs.writeFileSync(`${outDir}/host-state.json`, hostState);
  fs.writeFileSync(`${outDir}/guest-state.json`, guestState);

  console.log(JSON.stringify({ inviteUrl }, null, 2));
} finally {
  await browser.close();
}
