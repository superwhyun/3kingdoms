import type { GameView } from '@ch/engine';

interface Props {
  view: GameView;
  selected: string | null;
  onSelect: (id: string) => void;
  /** 출진·이동 대상 표시 */
  highlight?: Set<string>;
}

export function MapView({ view, selected, onSelect, highlight }: Props) {
  const colors = Object.fromEntries(view.factions.map((f) => [f.id, f.color]));
  const byId = Object.fromEntries(view.cities.map((c) => [c.id, c]));
  const edges: [string, string][] = [];
  for (const [a, list] of Object.entries(view.roads)) for (const b of list) if (a < b) edges.push([a, b]);

  return (
    <svg className="map" viewBox="0 0 1000 700" role="img" aria-label="지도">
      <rect x="0" y="0" width="1000" height="700" className="map-bg" />
      {/* 강줄기 장식 (대략적인 황하·장강) */}
      <path className="river" d="M60 230 C200 250 320 270 420 285 S600 250 700 230 S820 200 900 190" />
      <path className="river" d="M120 560 C220 560 330 560 450 545 S600 520 680 520 S800 470 900 460" />
      {edges.map(([a, b]) => (
        <line key={`${a}-${b}`} x1={byId[a].x} y1={byId[a].y} x2={byId[b].x} y2={byId[b].y} className="road" />
      ))}
      {view.cities.map((c) => {
        const fill = c.owner ? colors[c.owner] : '#9a9a8a';
        const isSel = selected === c.id;
        const mine = view.me !== null && c.owner === view.me;
        return (
          <g key={c.id} className="city" transform={`translate(${c.x},${c.y})`} onClick={() => onSelect(c.id)}>
            {highlight?.has(c.id) && <circle r="20" className="target-ring" />}
            <rect x={-11} y={-11} width={22} height={22} rx={4} fill={fill} className={`city-mark ${isSel ? 'sel' : ''} ${mine ? 'mine' : ''}`} />
            <text y={28} className="city-label">
              {c.name}
            </text>
            {c.troops !== null && (
              <text y={4} className="city-troops">
                {c.troops >= 10000 ? `${Math.round(c.troops / 1000)}k` : c.troops >= 1000 ? `${(c.troops / 1000).toFixed(1)}k` : c.troops}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
