import type { Command, GameView } from '@ch/engine';

const FIELD: Record<string, string> = { agriculture: '농업 개발', commerce: '상업 개발', defense: '성벽 보수', loyalty: '민심 안정' };

export function describe(cmd: Command, view: GameView): string {
  const g = (id: string) => view.generals.find((x) => x.id === id)?.name ?? id;
  const c = (id: string) => view.cities.find((x) => x.id === id)?.name ?? id;
  const f = (id: string) => view.factions.find((x) => x.id === id)?.name ?? id;
  switch (cmd.type) {
    case 'develop':
      return `${g(cmd.general)}: ${FIELD[cmd.field]}`;
    case 'draft':
      return `${g(cmd.general)}: 징병 ${cmd.amount}명`;
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
      return `${g(cmd.general)}: ${c(cmd.to)}(으)로 수송 (금 ${cmd.gold}, 군량 ${cmd.food}, 병 ${cmd.troops})`;
    case 'attack':
      return `출진 → ${c(cmd.to)}: ${cmd.generals.map(g).join('·')} / 병 ${cmd.troops}, 군량 ${cmd.food}`;
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
}

/** 명령에서 행동하는 장수 목록 */
export function actorsOf(cmd: Command): string[] {
  if (cmd.type === 'attack') return cmd.generals;
  if ('general' in cmd) return [cmd.general];
  return [];
}
