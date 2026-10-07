import type { GamePayload } from "../types";

export const PROTOCOL_VERSION = 1;

export type SeatRequest = {
  kind: "human" | "bot";
  difficulty?: string;
};

export type CreateRoomBody = {
  name: string;
  seats: SeatRequest[];
};

export type JoinRoomBody = {
  code: string;
  name: string;
};

export type RoomCredentials = {
  code: string;
  token: string;
  seat: number;
};

export type WaitingSeat = {
  name: string;
  isBot: boolean;
  filled: boolean;
  connected: boolean;
};

export type WaitingInfo = {
  code: string;
  yourSeat: number;
  seats: WaitingSeat[];
};

export type ClientMessage =
  | { type: "draw"; requestId: string }
  | { type: "play"; requestId: string; tileIds: number[]; melds?: number[][] }
  | { type: "nextRound"; requestId: string };

export type ServerMessage =
  | {
      type: "welcome";
      version: number;
      code: string;
      seat: number;
      payload: GamePayload | null;
      waiting: WaitingInfo | null;
    }
  | { type: "state"; payload: GamePayload; requestId?: string }
  | { type: "waiting"; waiting: WaitingInfo }
  | { type: "error"; message: string; requestId?: string };

export type ErrorBody = { error: string };
