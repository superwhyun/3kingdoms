import { FACILITY_LABEL, SCHEME_LABEL, TAX_LABEL, UNIT_LABEL, UNIT_TYPES, type Command, type GameView, type Units } from '@ch/engine';

export function unitsText(u: Partial<Units>): string {
  const parts = UNIT_TYPES.filter((t) => (u[t] ?? 0) > 0).map((t) => `${UNIT_LABEL[t]} ${u[t]}`);
  return parts.length ? parts.join('·') : '병력 없음';
}

const FIELD: Record<string, string> = { agriculture: '농업 개발', commerce: '상업 개발', defense: '성벽 보수', loyalty: '민심 안정' };

export function describe(cmd: Command, view: GameView): string {
  const g = (id: string) => view.generals.find((x) => x.id === id)?.name ?? id;
  const c = (id: string) => view.cities.find((x) => x.id === id)?.name ?? id;
  const f = (id: string) => view.factions.find((x) => x.id === id)?.name ?? id;
  switch (cmd.type) {
    case 'develop':
      return `${g(cmd.general)}: ${FIELD[cmd.field]}`;
    case 'draft':
      return `${g(cmd.general)}: ${UNIT_LABEL[cmd.unit]} ${cmd.amount}명 징병`;
    case 'train':
      return `${g(cmd.general)}: 훈련`;
    case 'trade':
      return `${g(cmd.general)}: 군량 ${cmd.action === 'buy' ? '매입' : '매각'} (금 ${cmd.gold})`;
    case 'search':
      return `${g(cmd.general)}: 인재·물자 탐색`;
    case 'recruit':
      return `${g(cmd.general)}: ${g(cmd.target)} 등용`;
    case 'reward':
      return `${g(cmd.target)}에게 포상 (금 ${cmd.gold})`;
    case 'release':
      return `포로 ${g(cmd.target)} 석방`;
    case 'move':
      return `${g(cmd.general)}: ${c(cmd.to)}(으)로 이동`;
    case 'transport':
      return `${g(cmd.general)}: ${c(cmd.to)}(으)로 수송 (금 ${cmd.gold}, 군량 ${cmd.food}, ${unitsText(cmd.units)})`;
    case 'attack':
      return `출진 → ${c(cmd.to)}: ${cmd.generals.map(g).join('·')} / ${unitsText(cmd.units)}, 군량 ${cmd.food}, 전략 ${cmd.plan.filter((r) => r.count > 0).length}라운드`;
    case 'setDefense':
      return `${c(cmd.city)} 수비 전략 ${cmd.plan ? `설정 (${cmd.plan.filter((r) => r.count > 0).length}라운드 투입)` : '자동으로 되돌림'}`;
    case 'setTax':
      return `${c(cmd.city)} 세율 → ${TAX_LABEL[cmd.tax]}`;
    case 'appoint':
      return cmd.general ? `${c(cmd.city)} 태수 임명: ${g(cmd.general)}` : `${c(cmd.city)} 태수 해임`;
    case 'build':
      return `${g(cmd.general)}: ${FACILITY_LABEL[cmd.facility]} 건설`;
    case 'scheme':
      return `${g(cmd.general)}: ${c(cmd.to)}에 ${SCHEME_LABEL[cmd.kind]}${cmd.target ? ` (${g(cmd.target)})` : ''}`;
    case 'propose':
      return `${f(cmd.to)}에 ${cmd.kind === 'alliance' ? '동맹' : '정전'} 제안`;
    case 'respond': {
      const p = view.proposals.find((x) => x.id === cmd.proposal);
      return `${p ? f(p.from) : '?'}의 제안 ${cmd.accept ? '수락' : '거절'}`;
    }
    case 'break':
      return `${f(cmd.to)}와의 협정 파기`;
    case 'tribute':
      return `${c(cmd.from)}에서 ${f(cmd.to)}에 공물 (금 ${cmd.gold})`;
  }
  return '알 수 없는 명령';
}

/** 명령에서 행동하는 장수 목록 */
export function actorsOf(cmd: Command): string[] {
  if (cmd.type === 'attack') return cmd.generals;
  if (cmd.type === 'appoint') return [];
  if ('general' in cmd) return [cmd.general];
  return [];
}
