import studentsApi from '../../api/endpoints/students.api';
import { getErrorMessage } from '../../api/axiosClient';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import { useToast } from '../../components/ui/Toast';

/** Reactivar a un alumno retirado (con confirmación), avisando si alguna matrícula no se pudo devolver. */
export function useReactivateStudent() {
  const confirm = useConfirm();
  const toast = useToast();
  return async (student, onDone) => {
    const name = `${student.first_name} ${student.last_name}`;
    const ok = await confirm({
      title: `¿Reactivar a ${name}?`,
      message: 'Volverá a estar Activo y regresará a la sección de la que se retiró, si su año sigue abierto y hay cupo. Sus mensualidades vuelven desde el mes en curso. Sus clubes no se restauran, y el registro del retiro se conserva.',
      confirmLabel: 'Reactivar',
    });
    if (!ok) return;
    try {
      const res = await studentsApi.reactivate(student.id);
      const missing = res.not_restored || [];
      if (missing.length) {
        toast.error(`${name} está activo, pero sin sección`, missing.map((m) => `${m.grade_name} ${m.section_name} (${m.school_period_name}): ${m.reason}`).join(' '));
      } else {
        toast.success('Alumno reactivado', res.restored?.length ? `${name} · ${res.restored[0].grade_name} ${res.restored[0].section_name}` : `${name} · sin sección asignada`);
      }
      onDone();
    } catch (err) {
      toast.error('No se pudo reactivar', getErrorMessage(err));
    }
  };
}
