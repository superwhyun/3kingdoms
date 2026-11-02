import {
  BATTLE_ROUNDS,
  Rng,
  UNIT_LABEL,
  UNIT_TYPES,
  aptitude,
  autoPlan,
  sumUnits,
  type GeneralView,
  type RoundPlan,
  type UnitType,
  type Units,
} from '@ch/engine';

interface Props {
  plan: RoundPlan[];
  onChange: (plan: RoundPlan[]) => void;
  /** 이 전투에서 쓸 수 있는 병력 */
  units: Units;
  generals: GeneralView[];
  /** 수비측이면 true (프리셋 문구가 달라진다) */
  defense?: boolean;
}

export function emptyPlan(): RoundPlan[] {
  return Array.from({ length: BATTLE_ROUNDS }, () => ({ general: null, unit: 'spear' as UnitType, count: 0 }));
}

/** 10행으로 맞춘다 */
export function padPlan(plan: RoundPlan[] | null | undefined): RoundPlan[] {
  const out = emptyPlan();
  (plan ?? []).slice(0, BATTLE_ROUNDS).forEach((r, i) => (out[i] = { ...r }));
  return out;
}

type Preset = 'even' | 'probe' | 'rush' | 'hold';

export function presetPlan(units: Units, preset: Preset): RoundPlan[] {
  const total = sumUnits(units);
  if (total <= 0) return emptyPlan();
  // 병종 순서를 매번 섞어 프리셋끼리 같은 순서로 맞붙지 않게 한다
  const base = autoPlan(units, new Rng((Date.now() ^ Math.floor(Math.random() * 2 ** 31)) >>> 0));
  return base.map((r, i) => {
    switch (preset) {
      case 'even':
        return { ...r, count: Math.round(units[r.unit] * 0.6) };
      case 'probe':
        return i < 2 ? { ...r, count: Math.max(1, Math.round(total * 0.04)) } : { ...r, count: Math.round(units[r.unit] * 0.75) };
      case 'rush':
        return { ...r, count: Math.round(units[r.unit] * (i < 4 ? 0.9 : 0.4)) };
      case 'hold':
        // 수비: 초반엔 소수로 버티고 후반에 주력
        return { ...r, count: Math.round(units[r.unit] * (i < 3 ? 0.25 : 0.7)) };
    }
  });
}

export function PlanEditor({ plan, onChange, units, generals, defense }: Props) {
  const rows = padPlan(plan);
  const set = (i: number, patch: Partial<RoundPlan>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const available = UNIT_TYPES.filter((t) => units[t] > 0);
  const peak: Partial<Record<UnitType, number>> = {};
  for (const r of rows) if (r.count > 0) peak[r.unit] = Math.max(peak[r.unit] ?? 0, r.count);

  return (
    <div className="plan">
      <div className="chips">
        <button className="chip" onClick={() => onChange(presetPlan(units, 'even'))}>균등</button>
        {defense ? (
          <button className="chip" onClick={() => onChange(presetPlan(units, 'hold'))}>버티다 반격</button>
        ) : (
          <button className="chip" onClick={() => onChange(presetPlan(units, 'probe'))}>정찰 후 주력</button>
        )}
        <button className="chip" onClick={() => onChange(presetPlan(units, 'rush'))}>초반 총력</button>
        <button className="chip" onClick={() => onChange(emptyPlan())}>비우기</button>
      </div>
      <table className="plan-table">
        <thead>
          <tr>
            <th>R</th>
            <th>지휘</th>
            <th>병종</th>
            <th>투입</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const g = generals.find((x) => x.id === r.general);
            return (
              <tr key={i} className={r.count === 0 ? 'idle' : ''}>
                <td>{i + 1}</td>
                <td>
                  <select value={r.general ?? ''} onChange={(e) => set(i, { general: e.target.value || null })}>
                    <option value="">자동</option>
                    {generals.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name} ({aptitude(x as never, r.unit)})
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <select value={r.unit} onChange={(e) => set(i, { unit: e.target.value as UnitType })}>
                    {UNIT_TYPES.map((t) => (
                      <option key={t} value={t} disabled={units[t] <= 0}>
                        {UNIT_LABEL[t]}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    type="number"
                    min={0}
                    step={100}
                    value={r.count}
                    title={g ? `${g.name} 적성 ${aptitude(g as never, r.unit)}` : undefined}
                    onChange={(e) => set(i, { count: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="muted small">
        투입 0 = 대기 라운드.{' '}
        {defense
          ? '수비가 대기하면 공격군이 예비대와 성벽을 직접 타격한다.'
          : '공격이 대기하면 군량만 소모한다.'}{' '}
        살아남은 병력은 다음 라운드에 다시 쓸 수 있다. 남은 병력보다 많이 적으면 남은 만큼만 투입된다.
      </p>
      <p className="muted small">
        보유:{' '}
        {available.length === 0
          ? '없음'
          : available.map((t) => `${UNIT_LABEL[t]} ${units[t].toLocaleString()}`).join(' · ')}
        {Object.entries(peak).some(([t, n]) => n! > units[t as UnitType]) && (
          <span className="warn"> · 일부 라운드 투입량이 보유량을 넘는다</span>
        )}
      </p>
    </div>
  );
}

export function UnitInputs({
  value,
  onChange,
  max,
  allow,
}: {
  value: Partial<Units>;
  onChange: (u: Partial<Units>) => void;
  max: Units;
  allow?: (t: UnitType) => boolean;
}) {
  return (
    <div className="unit-inputs">
      {UNIT_TYPES.filter((t) => max[t] > 0 && (!allow || allow(t))).map((t) => (
        <label key={t}>
          {UNIT_LABEL[t]} (최대 {max[t].toLocaleString()})
          <input
            type="number"
            min={0}
            max={max[t]}
            step={100}
            value={value[t] ?? 0}
            onChange={(e) => onChange({ ...value, [t]: Math.max(0, Math.min(max[t], Math.floor(Number(e.target.value) || 0))) })}
          />
        </label>
      ))}
      {UNIT_TYPES.every((t) => max[t] <= 0) && <span className="muted">병력이 없다</span>}
    </div>
  );
}

/** 0인 항목을 뺀 Partial<Units> */
export function compactUnits(u: Partial<Units>): Partial<Units> {
  const out: Partial<Units> = {};
  for (const t of UNIT_TYPES) if ((u[t] ?? 0) > 0) out[t] = u[t];
  return out;
}
