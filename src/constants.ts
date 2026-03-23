import type { PieceType, PlayerId } from "./types";

export const boardCols = 8;
export const boardRows = 6;
export const cellSize = 112;
export const boardWidth = boardCols * cellSize;
export const boardHeight = boardRows * cellSize;
export const sidePanelWidth = 380;
export const canvasWidth = boardWidth + sidePanelWidth;
export const canvasHeight = boardHeight;
export const boardLight = 0xd8e98b;
export const boardDark = 0xabca1a;

export const pieceTypes: PieceType[] = ["rock", "paper", "scissors"];

export const typeLabels: Record<PieceType, string> = {
  rock: "Камень",
  paper: "Бумага",
  scissors: "Ножницы",
};

export const playerColors: Record<PlayerId, number> = {
  1: 0xe25a2c,
  2: 0x2f6bff,
};
