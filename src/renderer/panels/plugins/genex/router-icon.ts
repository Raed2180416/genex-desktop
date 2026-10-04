/**
 * The router's picture as a timeline: the tools it routes on a 2×2 board that is never empty.
 * Every move pushes one row or column a cell along: one tool slides off one side, the next
 * waiting tool slides in on the other, and the pushes go round the board until the first four
 * are back where they began, so the loop has no seam.
 */
import { SECOND_MS } from "../../../../shared/duration.ts";

/** A place as [column, row]: 0 and 1 are on the board, -1 and 2 just off it, where a tool waits or leaves. */
export type Cell = readonly [number, number];

/** The four cells, where the first four tools start. */
export const BOARD_CELLS: readonly Cell[] = [
  [0, 0],
  [1, 0],
  [0, 1],
  [1, 1],
];

/** One move's length, the slide inside it and the still moment before the slide. */
export const MOVE_MS = 1.3 * SECOND_MS;
const SLIDE_MS = 0.5 * SECOND_MS;
const LEAD_MS = 0.4 * SECOND_MS;
/** A waiting tool's hop to where it slides in from, off the board and so unseen. */
const HOP_MS = 20;
/** Where a tool that has not been on the board yet waits. */
const WAITING: Cell = [-1, -1];
/** More moves than any board here needs to come back to its start. */
const MAX_MOVES = 1000;

/** Which way a push moves a row or a column. */
const Push = { Right: "right", Down: "down", Left: "left", Up: "up" } as const;
type Push = (typeof Push)[keyof typeof Push];

/** The pushes in turn, so the board turns round: top row right, right column down, bottom row left, left column up. */
const PUSHES: ReadonlyArray<{ push: Push; line: 0 | 1 }> = [
  { push: Push.Right, line: 0 },
  { push: Push.Down, line: 1 },
  { push: Push.Left, line: 1 },
  { push: Push.Up, line: 0 },
];

/** One tool's slide in a move. */
export interface PieceStep {
  piece: number;
  from: Cell;
  to: Cell;
}

/** One point on a tool's timeline; `jump` means it hops to the next point at the end of this segment. */
export interface PieceFrame {
  offset: number;
  cell: Cell;
  jump: boolean;
}

/** The four places a push passes through, in its direction: where a tool comes in, the two cells, where one leaves. */
function lane(push: Push, line: number): [Cell, Cell, Cell, Cell] {
  switch (push) {
    case Push.Right:
      return [
        [-1, line],
        [0, line],
        [1, line],
        [2, line],
      ];
    case Push.Left:
      return [
        [2, line],
        [1, line],
        [0, line],
        [-1, line],
      ];
    case Push.Down:
      return [
        [line, -1],
        [line, 0],
        [line, 1],
        [line, 2],
      ];
    default:
      return [
        [line, 2],
        [line, 1],
        [line, 0],
        [line, -1],
      ];
  }
}

const slot = (cell: Cell): number => cell[0] + 2 * cell[1];
const same = (a: Cell, b: Cell): boolean => a[0] === b[0] && a[1] === b[1];

/** Every move of one loop for `tools` tools (at least five), as each tool's slide in it. */
export function boardMoves(tools: number): PieceStep[][] {
  const board = [0, 1, 2, 3];
  const waiting = Array.from({ length: tools - BOARD_CELLS.length }, (_, i) => i + BOARD_CELLS.length);
  const start = JSON.stringify([board, waiting]);
  const moves: PieceStep[][] = [];
  while (moves.length < MAX_MOVES) {
    const { push, line } = PUSHES[moves.length % PUSHES.length] ?? { push: Push.Right, line: 0 };
    const [entry, first, second, exit] = lane(push, line);
    const incoming = waiting.shift() ?? 0;
    const pushed = board[slot(first)] ?? 0;
    const leaving = board[slot(second)] ?? 0;
    moves.push([
      { piece: incoming, from: entry, to: first },
      { piece: pushed, from: first, to: second },
      { piece: leaving, from: second, to: exit },
    ]);
    board[slot(first)] = incoming;
    board[slot(second)] = pushed;
    waiting.push(leaving);
    if (moves.length % PUSHES.length === 0 && JSON.stringify([board, waiting]) === start) return moves;
  }
  return moves;
}

/** How long one loop of the board takes, for `tools` tools. */
export const loopMs = (tools: number): number => boardMoves(tools).length * MOVE_MS;

/** Each tool's timeline over one loop, from 0 to 1, in the order `boardMoves` numbers them. */
export function pieceFrames(tools: number): PieceFrame[][] {
  const moves = boardMoves(tools);
  const total = moves.length * MOVE_MS;
  return Array.from({ length: tools }, (_, piece) => {
    const start = BOARD_CELLS[piece] ?? WAITING;
    const frames: Array<{ at: number; cell: Cell; jump: boolean }> = [{ at: 0, cell: start, jump: false }];
    const last = (): Cell => frames[frames.length - 1]?.cell ?? start;
    moves.forEach((move, index) => {
      const step = move.find((s) => s.piece === piece);
      if (!step) return;
      const begins = index * MOVE_MS + LEAD_MS;
      if (!same(last(), step.from)) frames.push({ at: begins - HOP_MS, cell: last(), jump: true });
      frames.push({ at: begins, cell: step.from, jump: false });
      frames.push({ at: begins + SLIDE_MS, cell: step.to, jump: false });
    });
    if (!same(last(), start)) frames.push({ at: total - HOP_MS, cell: last(), jump: true });
    frames.push({ at: total, cell: start, jump: false });
    return frames.map(({ at, cell, jump }) => ({ offset: at / total, cell, jump }));
  });
}
