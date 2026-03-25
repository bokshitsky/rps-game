import { playerColors } from "./constants";
import type { KnownType, PlayerId } from "./types";
import { mixColor } from "./utils";

export const pieceTextureSize = 48;

export function paintPieceSprite(ctx: CanvasRenderingContext2D, player: PlayerId, type: KnownType): void {
  const base = playerColors[player];
  const accent = `#${base.toString(16).padStart(6, "0")}`;
  const lightAccent = mixColor(base, 0xffffff, 0.22);
  const outline = "#2c2f38";
  const tintedShadow = mixColor(base, 0x0b1020, 0.78);
  const metal = "#c5ccd6";
  const gold = "#f2be39";
  const goldLight = "#ffe28a";

  const px = (x: number, y: number, w = 1, h = 1, color = outline): void => {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
  };

  px(10, 38, 28, 5, tintedShadow);
  px(14, 35, 20, 3, tintedShadow);

  if (type === "rock") {
    px(11, 17, 26, 14, mixColor(base, 0x6d7682, 0.35));
    px(9, 20, 30, 11, mixColor(base, 0x8d97a5, 0.28));
    px(14, 14, 20, 8, mixColor(base, 0xaeb7c4, 0.2));
    px(19, 19, 10, 4, mixColor(base, 0xd7dde4, 0.1));
    px(9, 20, 2, 11, outline);
    px(37, 20, 2, 11, outline);
    px(14, 14, 20, 2, outline);
    px(11, 30, 26, 2, outline);
    return;
  }

  if (type === "paper") {
    px(13, 9, 18, 24, "#fffdf7");
    px(15, 11, 18, 24, "#f4f6fa");
    px(24, 9, 9, 9, lightAccent);
    px(13, 9, 2, 24, outline);
    px(13, 9, 18, 2, outline);
    px(31, 11, 2, 22, outline);
    px(15, 33, 18, 2, outline);
    px(18, 16, 11, 2, "#d1d7e0");
    px(18, 21, 11, 2, "#d1d7e0");
    px(18, 26, 8, 2, "#d1d7e0");
    return;
  }

  if (type === "scissors") {
    px(8, 12, 9, 9, accent);
    px(31, 12, 9, 9, accent);
    px(11, 15, 3, 3, lightAccent);
    px(34, 15, 3, 3, lightAccent);
    px(16, 20, 7, 4, metal);
    px(25, 20, 7, 4, metal);
    px(21, 23, 6, 3, metal);
    px(18, 25, 3, 12, metal);
    px(27, 25, 3, 12, metal);
    px(14, 33, 6, 3, metal);
    px(28, 33, 6, 3, metal);
    px(8, 12, 2, 9, outline);
    px(15, 12, 2, 9, outline);
    px(31, 12, 2, 9, outline);
    px(38, 12, 2, 9, outline);
    px(16, 20, 2, 6, outline);
    px(30, 20, 2, 6, outline);
    px(20, 23, 2, 14, outline);
    px(27, 23, 2, 14, outline);
    px(14, 34, 6, 2, outline);
    px(28, 34, 6, 2, outline);
    return;
  }

  if (type === "king") {
    px(12, 16, 24, 6, gold);
    px(10, 22, 28, 12, gold);
    px(14, 33, 20, 5, "#deab2a");
    px(12, 10, 5, 12, goldLight);
    px(21, 6, 6, 16, goldLight);
    px(31, 10, 5, 12, goldLight);
    px(16, 16, 2, 2, accent);
    px(23, 12, 2, 2, accent);
    px(30, 16, 2, 2, accent);
    px(10, 22, 2, 12, outline);
    px(36, 22, 2, 12, outline);
    px(12, 16, 24, 2, outline);
    px(14, 36, 20, 2, outline);
    return;
  }

  px(12, 10, 24, 24, mixColor(base, 0x000000, 0.18));
  px(10, 12, 28, 20, accent);
  px(14, 14, 20, 16, mixColor(base, 0xffffff, 0.12));
  px(19, 14, 10, 4, outline);
  px(21, 18, 6, 3, outline);
  px(21, 27, 6, 2, outline);
  px(19, 30, 4, 4, outline);
  px(11, 12, 2, 20, outline);
  px(35, 12, 2, 20, outline);
  px(12, 10, 24, 2, outline);
  px(12, 33, 24, 2, outline);
}

const iconCache = new Map<string, string>();

export function createPieceIconDataUrl(player: PlayerId, type: KnownType): string {
  const key = `${player}-${type}`;
  const existing = iconCache.get(key);
  if (existing) {
    return existing;
  }

  const canvas = document.createElement("canvas");
  canvas.width = pieceTextureSize;
  canvas.height = pieceTextureSize;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return "";
  }

  ctx.imageSmoothingEnabled = false;
  paintPieceSprite(ctx, player, type);
  const dataUrl = canvas.toDataURL("image/png");
  iconCache.set(key, dataUrl);
  return dataUrl;
}
