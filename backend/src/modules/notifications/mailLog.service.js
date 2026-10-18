/**
 * Registro de los correos que NO pasan por la cola de avisos (migración 043):
 * credenciales de acceso y comprobante de pago. No guarda el cuerpo (las
 * credenciales llevan una contraseña temporal; el comprobante se regenera).
 *
 * Nunca rompe el envío que registra: corre en un SAVEPOINT y, antes de la
 * migración, no hace nada.
 */

let ready = false;
async function hasTable(trx) {
  if (ready) return true;
  const { rows } = await trx.raw("SELECT to_regclass('mail_log') IS NOT NULL AS ok");
  ready = rows[0].ok;
  return ready;
}

/** { kind, to, toName, subject, error?, refId?, resendOf?, userId? } → id del registro (o null). */
async function record(trx, tenantId, { kind, to, toName = null, subject, error = null, refId = null, resendOf = null, userId = null }) {
  if (!trx || !tenantId || !to) return null;
  try {
    if (!(await hasTable(trx))) return null;
    return await trx.transaction(async (sp) => {
      const [row] = await sp('mail_log')
        .insert({
          tenant_id: tenantId,
          kind,
          to_email: String(to).slice(0, 255),
          to_name: toName ? String(toName).slice(0, 200) : null,
          subject: String(subject).slice(0, 300),
          status: error ? 'failed' : 'sent',
          error: error ? String(error).slice(0, 500) : null,
          ref_id: refId,
          resend_of: resendOf,
          created_by: userId,
        })
        .returning('id');
      return row.id;
    });
  } catch (err) {
    console.error('[log de correos] No se pudo registrar el envío:', err.message);
    return null;
  }
}

module.exports = { record };
