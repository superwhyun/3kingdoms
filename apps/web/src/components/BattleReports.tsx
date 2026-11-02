import { useState } from 'react';
import { UNIT_LABEL, sumUnits, type BattleReport, type BattleSide, type GameView } from '@ch/engine';
import { unitsText } from './describe';

const OUTCOME: Record<BattleReport['outcome'], string> = {
  captured: '함락',
  withdrawn: '철수',
  starved: '군량 부족 퇴각',
  annihilated: '공격군 전멸',
};

export function BattleReports({ view, onCity }: { view: GameView; onCity: (id: string) => void }) {
  const [open, setOpen] = useState<number | null>(view.battles.length ? 0 : null);
  if (view.battles.length === 0) return null;
  const fname = (id: string | null) => (id ? view.factions.find((f) => f.id === id)?.name ?? id : '중립');
  const gname = (id: string | null) => (id ? view.generals.find((g) => g.id === id)?.name ?? id : '자동');
  const cname = (id: string) => view.cities.find((c) => c.id === id)?.name ?? id;
  const side = (s: BattleSide | null) =>
    s ? (
      <>
        <span className={`unit-tag u-${s.unit}`}>{UNIT_LABEL[s.unit]}</span> {s.count.toLocaleString()}
        <span className="muted"> ({gname(s.general)})</span>
        <div className="loss">−{s.loss.toLocaleString()}</div>
      </>
    ) : (
      <span className="muted">대기</span>
    );

  return (
    <div className="battles">
      <h2>전투 리포트</h2>
      {view.battles.map((b, i) => {
        const mineAtt = b.attacker === view.me;
        const won = mineAtt ? b.outcome === 'captured' : b.outcome !== 'captured';
        return (
          <div key={i} className={`battle ${won ? 'won' : 'lost'}`}>
            <button className="battle-head" onClick={() => setOpen(open === i ? null : i)}>
              <strong>
                {fname(b.attacker)} → {fname(b.defender)} {cname(b.city)}
              </strong>
              <span className="badge">{OUTCOME[b.outcome]}</span>
              <span className="muted">{mineAtt ? '공격' : '수비'}</span>
              {b.river && <span className="badge">강</span>}
            </button>
            {open === i && (
              <div className="battle-body">
                <p className="muted small">
                  공격 {unitsText(b.attackerStart)} → 잔여 {sumUnits(b.attackerEnd).toLocaleString()}
                  <br />
                  수비 {unitsText(b.defenderStart)} → 잔여 {sumUnits(b.defenderEnd).toLocaleString()}
                  {b.defenderAuto && ' (수비측 자동 전략)'}
                  <br />
                  성벽 {b.wallStart} → {b.wallEnd}
                </p>
                <table className="round-table">
                  <thead>
                    <tr>
                      <th>R</th>
                      <th>공격</th>
                      <th>수비</th>
                      <th>성벽/예비대</th>
                    </tr>
                  </thead>
                  <tbody>
                    {b.rounds.map((r) => (
                      <tr key={r.round}>
                        <td>{r.round}</td>
                        <td>{side(r.att)}</td>
                        <td>{side(r.def)}</td>
                        <td className="small">
                          {r.wallDamage > 0 && <>성벽 −{r.wallDamage}</>}
                          {r.reserveLoss > 0 && (
                            <>
                              <br />
                              수비 예비대 −{r.reserveLoss.toLocaleString()}
                            </>
                          )}
                          {r.attReserveLoss > 0 && (
                            <>
                              <br />
                              공격 예비대 −{r.attReserveLoss.toLocaleString()}
                            </>
                          )}
                          <div className="muted">
                            {r.attRemaining.toLocaleString()} : {r.defRemaining.toLocaleString()}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {b.rounds.length < 10 && <p className="muted small">{b.rounds.length}라운드에서 전투가 끝났다.</p>}
                <button className="link" onClick={() => onCity(b.city)}>
                  {cname(b.city)} 보기
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
