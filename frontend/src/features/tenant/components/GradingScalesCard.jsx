import { useMemo, useState } from 'react';
import tenantApi from '../../../api/endpoints/tenant.api';
import { getErrorMessage } from '../../../api/axiosClient';
import { useFetch } from '../../../hooks/useFetch';
import Card from '../../../components/ui/Card';
import Alert from '../../../components/ui/Alert';
import Spinner from '../../../components/ui/Spinner';
import Icon from '../../../components/ui/Icon';
import { useToast } from '../../../components/ui/Toast';
import { GRADING_SCALES, QUALITATIVE_LEVELS, rangeOf } from '../../grading/gradingScale';

const SCALE_KEYS = Object.keys(GRADING_SCALES);

/**
 * Escalas de calificación por grado (Configuración): cada grado usa la
 * escala cuantitativa (0–20) o la cualitativa (literales A–E). Se guarda al
 * instante al elegir; también se puede aplicar a todo un nivel de una vez.
 * Los cálculos siguen siendo numéricos: la escala solo cambia cómo se cargan
 * y se muestran las notas (libreta del docente, planes y portal).
 */
function GradingScalesCard({ canEdit }) {
  const toast = useToast();
  const { data, loading, error, setData } = useFetch(() => tenantApi.getGradingScales(), []);
  const [saving, setSaving] = useState(null); // id del grado (o del nivel) que se está guardando

  const levels = useMemo(() => {
    const map = new Map();
    (data?.grades || []).forEach((g) => {
      if (!map.has(g.level_code)) map.set(g.level_code, { code: g.level_code, name: g.level_name, grades: [] });
      map.get(g.level_code).grades.push(g);
    });
    return [...map.values()];
  }, [data]);

  const save = async (changes, key, label) => {
    setSaving(key);
    try {
      setData(await tenantApi.setGradingScales(changes));
      toast.success('Escala actualizada', label);
    } catch (err) {
      toast.error('No se pudo guardar la escala', getErrorMessage(err));
    } finally {
      setSaving(null);
    }
  };

  return (
    <Card
      title="Escalas de calificación"
      subtitle="Define si cada grado se evalúa con notas numéricas o con literales. Los promedios se siguen calculando igual."
    >
      <Alert>{error}</Alert>
      {loading && !data ? (
        <Spinner />
      ) : !levels.length ? (
        <p className="text-muted">Aún no hay grados: créalos en Grados y secciones.</p>
      ) : (
        <div className="scales">
          {levels.map((level) => {
            const all = (scale) => level.grades.every((g) => g.grading_scale === scale);
            return (
              <section key={level.code} className="scales__level">
                <header className="scales__level-head">
                  <strong>{level.name}</strong>
                  {canEdit && level.grades.length > 1 && (
                    <span className="scales__bulk">
                      Todo el nivel:
                      {SCALE_KEYS.map((scale) => (
                        <button
                          key={scale}
                          type="button"
                          className="link-button"
                          disabled={all(scale) || saving === level.code}
                          onClick={() =>
                            save(
                              level.grades.map((g) => ({ gradeId: g.id, gradingScale: scale })),
                              level.code,
                              `${level.name}: ${GRADING_SCALES[scale].label.toLowerCase()}`,
                            )
                          }
                        >
                          {GRADING_SCALES[scale].label}
                        </button>
                      ))}
                    </span>
                  )}
                </header>
                <ul className="scales__list">
                  {level.grades.map((g) => (
                    <li key={g.id} className="scales__row">
                      <span className="scales__grade">{g.name}</span>
                      <div className="segmented scales__toggle" role="radiogroup" aria-label={`Escala de ${g.name}`}>
                        {SCALE_KEYS.map((scale) => {
                          const on = g.grading_scale === scale;
                          return (
                            <button
                              key={scale}
                              type="button"
                              role="radio"
                              aria-checked={on}
                              className={`segmented__item ${on ? 'segmented__item--active' : ''}`}
                              disabled={!canEdit || saving === g.id || saving === level.code}
                              onClick={() => !on && save([{ gradeId: g.id, gradingScale: scale }], g.id, `${g.name}: ${GRADING_SCALES[scale].label.toLowerCase()}`)}
                              title={GRADING_SCALES[scale].hint}
                            >
                              <Icon name={GRADING_SCALES[scale].icon} size={14} /> {GRADING_SCALES[scale].label}
                              <small>{GRADING_SCALES[scale].short}</small>
                            </button>
                          );
                        })}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}

          <div className="scales__legend">
            <span className="student-card__label">Escala cualitativa: equivalencias sobre 20</span>
            <ul>
              {QUALITATIVE_LEVELS.map((l) => (
                <li key={l.code}>
                  <span className={`literal-badge literal-badge--${l.code}`}>{l.code}</span>
                  <span>
                    <strong>{l.label}</strong>
                    <small>{rangeOf(l)}</small>
                  </span>
                </li>
              ))}
            </ul>
            <p className="form-hint">
              En un grado cualitativo el docente califica eligiendo el literal; internamente se guarda su valor (A = 19, B = 16, C = 13, D = 11,
              E = 7), así los promedios, la promoción y el historial funcionan igual.
            </p>
          </div>
        </div>
      )}
    </Card>
  );
}

export default GradingScalesCard;
