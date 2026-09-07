import { RummyBot, type PlayerView } from "./bot";

const bot = new RummyBot();

self.onmessage = (event: MessageEvent) => {
  const { id, view, difficulty, debug } = event.data as {
    id: number;
    view: PlayerView;
    difficulty: string;
    debug: boolean;
  };
  try {
    const move = bot.chooseMove(view, difficulty, debug);
    self.postMessage({ id, ok: true, move });
  } catch (err) {
    self.postMessage({
      id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};
