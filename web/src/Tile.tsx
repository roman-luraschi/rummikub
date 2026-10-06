import type { PointerEvent } from "react";
import type { JokerBindingData, TileData } from "./types";

type TileSize = "sm" | "md" | "lg";

type Props = {
  tile: TileData;
  selected?: boolean;
  size?: TileSize;
  binding?: JokerBindingData;
  onClick?: () => void;
  faceDown?: boolean;
  className?: string;
  dimmed?: boolean;
  landing?: boolean;
  onPointerDown?: (event: PointerEvent<HTMLButtonElement>) => void;
  dragging?: boolean;
};

function JokerIcon() {
  return (
    <svg className="rk-joker-icon" viewBox="0 0 64 64" aria-hidden="true">
      <circle cx="11" cy="16" r="5.5" />
      <path d="M11 21c-2 10 6 16 18 20l3-5C20 32 16 26 15 21z" />
      <circle cx="53" cy="16" r="5.5" />
      <path d="M53 21c2 10-6 16-18 20l-3-5c12-4 16-10 15-15z" />
      <circle cx="32" cy="6" r="5.5" />
      <path d="M32 11 25 40h14L32 11z" />
      <rect x="17" y="40" width="30" height="8" rx="3" />
    </svg>
  );
}

function resolveFace(tile: TileData, binding?: JokerBindingData) {
  if (tile.isJoker) {
    return {
      rank: binding ? String(binding.rank) : "",
      color: binding?.color ?? "joker",
      joker: true,
    };
  }
  return {
    rank: String(tile.rank ?? tile.label.replace(/\D/g, "")),
    color: tile.color,
    joker: false,
  };
}

export default function TileView({
  tile,
  selected,
  size = "md",
  binding,
  onClick,
  faceDown,
  className: extraClass,
  dimmed,
  landing,
  onPointerDown,
  dragging,
}: Props) {
  if (faceDown) {
    return (
      <div className={`rk-tile rk-tile-${size} rk-tile-back ${extraClass ?? ""}`.trim()} aria-hidden>
        <span className="rk-tile-back-mark">R</span>
      </div>
    );
  }

  const face = resolveFace(tile, binding);
  const className = [
    "rk-tile",
    `rk-tile-${size}`,
    `rk-color-${face.color}`,
    selected ? "is-selected" : "",
    onClick || onPointerDown ? "is-clickable" : "",
    onPointerDown ? "is-grabbable" : "",
    dragging ? "is-source" : "",
    face.joker ? "is-joker" : "",
    dimmed ? "is-dimmed" : "",
    landing ? "is-landing" : "",
    extraClass,
  ]
    .filter(Boolean)
    .join(" ");

  const inner = (
    <>
      <span className="rk-tile-shine" />
      {face.joker && !binding ? <JokerIcon /> : <span className="rk-tile-rank">{face.rank}</span>}
      {face.joker && <span className="rk-tile-joker">JOKER</span>}
    </>
  );

  if (!onClick && !onPointerDown) {
    return (
      <div className={className} aria-label={tile.label}>
        {inner}
      </div>
    );
  }

  return (
    <button
      type="button"
      className={className}
      onClick={onClick}
      onPointerDown={onPointerDown}
      aria-pressed={selected}
      aria-label={tile.label}
    >
      {inner}
    </button>
  );
}
