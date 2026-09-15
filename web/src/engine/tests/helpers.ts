import type { PlayerView } from "../bot";
import type { Meld } from "../meld";
import type { TableConfiguration } from "../partition";
import type { Table } from "../table";
import { parseTiles, type Tile } from "../tile";
import { tryMakeMeld } from "../validator";

export function run(spec: string): Meld {
  return tryMakeMeld(parseTiles(spec));
}

export function group(spec: string): Meld {
  return tryMakeMeld(parseTiles(spec));
}

export function tableOf(...melds: Meld[]): Table {
  return { melds };
}

export function configOf(
  table: Table,
  rackUsed: Tile[],
  rackLeft: Tile[] = [],
  solverMode: TableConfiguration["solverMode"] = "full",
): TableConfiguration {
  return { table, rackUsed, rackLeft, solverMode, nodes: 0, cacheHits: 0, timeMs: 0 };
}

export function viewOf(rack: Tile[] | string, extras: Partial<PlayerView> = {}): PlayerView {
  const tiles = typeof rack === "string" ? parseTiles(rack) : rack;
  return {
    playerId: 0,
    rack: tiles,
    table: extras.table ?? { melds: [] },
    rackSizes: extras.rackSizes ?? [tiles.length, 10],
    poolSize: extras.poolSize ?? 40,
    current: 0,
    hasInitialMeld: extras.hasInitialMeld ?? [true, true],
    scores: extras.scores ?? [0, 0],
    history: extras.history ?? [],
    names: extras.names ?? ["A", "B"],
    isBot: extras.isBot ?? [true, true],
    difficulties: extras.difficulties ?? ["hard", "easy"],
    over: extras.over ?? false,
    winner: extras.winner ?? null,
    seedPublic: extras.seedPublic ?? null,
    ...extras,
    rack: tiles,
  };
}
