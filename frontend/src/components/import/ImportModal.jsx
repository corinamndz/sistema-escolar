import { useMemo, useState } from 'react';
import importsApi, { saveBlob } from '../../api/endpoints/imports.api';
import { getErrorMessage } from '../../api/axiosClient';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import Alert from '../ui/Alert';
import Icon from '../ui/Icon';
import FileDropzone from '../ui/FileDropzone';

const MAX_BYTES = 5 * 1024 * 1024;
// Windows suele informar los CSV como "application/vnd.ms-excel": se acepta y el backend valida el contenido.
const ACCEPT = {
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
  'text/csv': ['.csv'],
  'application/vnd.ms-excel': ['.csv'],
};

const STEPS = ['Plantilla', 'Archivo', 'Revisión', 'Resultado'];
const STATUS = {
  valid: { label: 'Lista', tone: 'success' },
  imported: { label: 'Importada', tone: 'success' },
  skipped: { label: 'Sin cambios', tone: 'neutral' },
  invalid: { label: 'Con errores', tone: 'danger' },
  failed: { label: 'Falló', tone: 'danger' },
};

/** CSV (separador ";", con BOM para que Excel respete los acentos) con las filas que no se importaron. */
function downloadErrorReport(report) {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [['Fila', 'Registro', 'Columna', 'Problema'].map(esc).join(';')];
  report.rows
    .filter((r) => r.status === 'invalid' || r.status === 'failed')
    .forEach((r) => r.errors.forEach((e) => lines.push([r.row, r.label, e.columnLabel, e.message].map(esc).join(';'))));
  saveBlob(new Blob([`﻿${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' }), `errores-importacion-${report.type}.csv`);
}

/**
 * Carga masiva en 4 pasos: descargar plantilla → subir archivo → revisar la
 * validación (nada se guarda todavía) → importar las filas válidas.
 *
 *   <ImportModal type="students" title="Importar alumnos" onClose={…} onImported={refetch} />
 *   <ImportModal type="scores" params={{ planId }} title="Importar notas" … />
 */
function ImportModal({ type, title, description, params, onClose, onImported }) {
  const [file, setFile] = useState(null);
  const [phase, setPhase] = useState('idle'); // idle | validating | review | importing | done
  const [progress, setProgress] = useState(0);
  const [report, setReport] = useState(null);
  const [error, setError] = useState(null);
  const [downloading, setDownloading] = useState(false);
  const [onlyErrors, setOnlyErrors] = useState(true);

  const busy = phase === 'validating' || phase === 'importing';
  const stepIndex = phase === 'done' ? 3 : phase === 'review' || phase === 'importing' ? 2 : file ? 1 : 0;

  const downloadTemplate = async () => {
    setDownloading(true);
    setError(null);
    try {
      await importsApi.downloadTemplate(type, params);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setDownloading(false);
    }
  };

  const send = async (commit) => {
    setError(null);
    setProgress(0);
    setPhase(commit ? 'importing' : 'validating');
    try {
      const fn = commit ? importsApi.importFile : importsApi.validate;
      const result = await fn(type, file, params, setProgress);
      setReport(result);
      setOnlyErrors(!commit || result.summary.invalid > 0);
      setPhase(commit ? 'done' : 'review');
      if (commit && result.summary.imported > 0) onImported?.(result);
    } catch (err) {
      setError(getErrorMessage(err));
      setPhase(commit ? 'review' : 'idle');
    }
  };

  const changeFile = (f) => {
    setFile(f);
    setReport(null);
    setError(null);
    setPhase('idle');
  };

  const visibleRows = useMemo(() => {
    if (!report) return [];
    return onlyErrors ? report.rows.filter((r) => r.status === 'invalid' || r.status === 'failed') : report.rows;
  }, [report, onlyErrors]);

  const s = report?.summary;
  const hasErrors = s && s.invalid > 0;
  // Cerrar mientras se importa dejaría al usuario sin el reporte.
  const close = () => !busy && onClose();

  return (
    <Modal title={title} onClose={close} size="lg">
      <ol className="import-steps" aria-label="Pasos de la importación">
        {STEPS.map((label, i) => (
          <li key={label} className={i < stepIndex ? 'is-done' : i === stepIndex ? 'is-current' : ''}>
            <span className="import-steps__dot">{i < stepIndex ? <Icon name="check" size={13} strokeWidth={2.6} /> : i + 1}</span>
            {label}
          </li>
        ))}
      </ol>

      <Alert>{error}</Alert>

      {phase !== 'done' && (
        <>
          <section className="import-block">
            <div className="import-block__text">
              <strong>1. Descarga la plantilla</strong>
              <span>
                {description ||
                  'Trae las columnas exactas, listas desplegables y una hoja de instrucciones con ejemplos. Las columnas con * son obligatorias.'}
              </span>
            </div>
            <Button variant="secondary" icon="download" onClick={downloadTemplate} loading={downloading} loadingText="Generando…">
              Descargar plantilla
            </Button>
          </section>

          <section className="import-block import-block--column">
            <div className="import-block__text">
              <strong>2. Sube el archivo completado</strong>
              <span>Excel (.xlsx) o CSV, hasta 5 MB y 1.000 filas. Primero se valida: no se guarda nada hasta que confirmes.</span>
            </div>
            <FileDropzone
              value={file}
              onChange={changeFile}
              accept={ACCEPT}
              maxBytes={MAX_BYTES}
              label="Arrastra aquí tu plantilla de Excel"
              hint="o haz clic para elegirla (.xlsx o .csv)"
              disabled={busy}
            />
          </section>
        </>
      )}

      {busy && (
        <div className="import-progress" role="status">
          <div className="import-progress__label">
            {progress < 100 ? `Subiendo archivo… ${progress}%` : phase === 'importing' ? 'Importando registros…' : 'Validando filas…'}
          </div>
          <div className={`progress-bar ${progress >= 100 ? 'progress-bar--indeterminate' : ''}`}>
            <div className="progress-bar__fill" style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}

      {report && !busy && (
        <section className="import-report">
          <Alert variant={phase === 'done' ? (s.imported ? (hasErrors ? 'warning' : 'success') : 'error') : hasErrors ? 'warning' : 'info'}>
            {report.message}
          </Alert>

          <div className="import-stats">
            <div className="import-stat import-stat--success">
              <span>{phase === 'done' ? s.imported : s.valid}</span>
              {phase === 'done' ? 'importadas' : 'listas para importar'}
            </div>
            <div className="import-stat import-stat--danger">
              <span>{s.invalid}</span>
              {phase === 'done' ? 'no importadas' : 'con errores'}
            </div>
            {s.skipped > 0 && (
              <div className="import-stat">
                <span>{s.skipped}</span>sin cambios
              </div>
            )}
            <div className="import-stat">
              <span>{s.total}</span>filas leídas
            </div>
          </div>

          {report.rows.length > 0 && (
            <>
              <div className="import-report__toolbar">
                <label className="checkbox-row">
                  <input type="checkbox" checked={onlyErrors} onChange={(e) => setOnlyErrors(e.target.checked)} />
                  Mostrar solo filas con errores
                </label>
                {hasErrors && (
                  <Button size="sm" variant="ghost" icon="download" onClick={() => downloadErrorReport(report)}>
                    Descargar errores (CSV)
                  </Button>
                )}
              </div>

              {visibleRows.length === 0 ? (
                <p className="text-sm text-muted import-report__empty">
                  <Icon name="checkCircle" size={16} /> No hay filas con errores.
                </p>
              ) : (
                <div className="table-wrap import-report__table">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Fila</th>
                        <th>Registro</th>
                        <th>Estado</th>
                        <th>Detalle</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleRows.map((r) => (
                        <tr key={r.row}>
                          <td className="text-muted">{r.row}</td>
                          <td>{r.label || <span className="text-muted">—</span>}</td>
                          <td>
                            <span className={`badge badge--${STATUS[r.status].tone}`}>{STATUS[r.status].label}</span>
                          </td>
                          <td>
                            {r.errors.length > 0 ? (
                              <ul className="import-errors">
                                {r.errors.map((e, i) => (
                                  <li key={i}>
                                    {e.columnLabel && <strong>{e.columnLabel}: </strong>}
                                    {e.message}
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <span className="text-muted text-sm">{r.notes?.join(' · ') || '—'}</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </section>
      )}

      <div className="form-actions">
        {phase === 'done' ? (
          <>
            <Button variant="secondary" icon="upload" onClick={() => changeFile(null)}>
              Importar otro archivo
            </Button>
            <Button onClick={onClose}>Listo</Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={close} disabled={busy}>
              Cancelar
            </Button>
            {phase === 'review' || phase === 'importing' ? (
              <Button icon="upload" onClick={() => send(true)} loading={phase === 'importing'} loadingText="Importando…" disabled={!s?.valid}>
                {s?.valid ? `Importar ${s.valid} fila${s.valid === 1 ? '' : 's'} válida${s.valid === 1 ? '' : 's'}` : 'Nada para importar'}
              </Button>
            ) : (
              <Button icon="checkCircle" onClick={() => send(false)} disabled={!file} loading={phase === 'validating'} loadingText="Validando…">
                Validar archivo
              </Button>
            )}
          </>
        )}
      </div>
      {phase === 'review' && hasErrors && s.valid > 0 && (
        <p className="text-sm text-muted import-footnote">
          Las filas con errores no se importarán. Puedes importar ahora las válidas y luego subir un archivo solo con las corregidas.
        </p>
      )}
    </Modal>
  );
}

export default ImportModal;
