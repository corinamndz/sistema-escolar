const notifications = require('./notification.service');
const prefs = require('./notificationPreferences.service');
const outbox = require('./emailOutbox.service');
const { escapeHtml } = require('../../services/email/mailer');

/**
 * Despachador de avisos a las familias. TODOS los disparadores (tasa BCV,
 * pagos, cartelera, convivencia, clubes) pasan por aquí:
 *
 *   1. consulta la matriz de Configuración → Notificaciones para cada canal;
 *   2. campana: crea la notificación (para todo el público o DIRIGIDA a los
 *      representantes indicados);
 *   3. correo: encola un correo por representante con correo (sin repetir
 *      direcciones), si el colegio tiene el correo configurado.
 *
 * Corre en un SAVEPOINT y atrapa cualquier error: un problema con el aviso
 * nunca revierte el evento que lo disparó.
 */

const { tenantAppUrl } = require('../../utils/frontendUrl');

/** Correo simple con el nombre del colegio, el aviso y un botón al portal (/<slug>/<link>). */
function renderEmail({ schoolName, schoolSlug, title, body, link, linkLabel }) {
  const url = link ? tenantAppUrl(schoolSlug, link) : null;
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;padding:24px;border:1px solid #e2e8f0">
    <p style="margin:0 0 4px;font-size:13px;color:#64748b">${escapeHtml(schoolName)}</p>
    <h2 style="margin:0 0 12px;font-size:20px">${escapeHtml(title)}</h2>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.5">${escapeHtml(body)}</p>
    ${url ? `<a href="${escapeHtml(url)}" style="display:inline-block;padding:10px 18px;background:#2563eb;color:#ffffff;border-radius:8px;text-decoration:none;font-weight:bold">${escapeHtml(linkLabel || 'Ver en el portal')}</a>` : ''}
    <p style="margin:24px 0 0;font-size:12px;color:#94a3b8">Recibes este correo porque eres representante en ${escapeHtml(schoolName)}.</p>
  </div></body></html>`;
  const text = `${title}\n\n${body}${url ? `\n\n${linkLabel || 'Ver en el portal'}: ${url}` : ''}\n\n— ${schoolName}`;
  return { html, text };
}

/** Representantes de estos alumnos. */
async function guardiansOfStudents(trx, tenantId, studentIds) {
  if (!studentIds.length) return [];
  return trx('student_guardians as sg')
    .join('guardians as g', 'g.id', 'sg.guardian_id')
    .where('g.tenant_id', tenantId)
    .whereIn('sg.student_id', [...new Set(studentIds)])
    .distinct('sg.guardian_id')
    .pluck('sg.guardian_id');
}

/** Representantes de los alumnos con inscripción ACTIVA en estas secciones. */
async function guardiansOfSections(trx, tenantId, sectionIds) {
  if (!sectionIds.length) return [];
  return trx('student_guardians as sg')
    .join('enrollments as e', function joinE() {
      this.on('e.student_id', 'sg.student_id').andOn(trx.raw("e.status = 'active'"));
    })
    .join('guardians as g', 'g.id', 'sg.guardian_id')
    .where('g.tenant_id', tenantId)
    .whereIn('e.section_id', sectionIds)
    .distinct('sg.guardian_id')
    .pluck('sg.guardian_id');
}

/**
 * Emite un aviso.
 *   event         clave de la matriz (bcv_rate, payment_confirmed…)
 *   guardianIds   a quiénes (o `allGuardians: true`, todo el colegio)
 *   alsoStaff     la administración también lo ve en la campana (tasa BCV)
 *   staffOnly     solo la administración, solo campana (p. ej. una simulación)
 *   title, body   texto (campana y correo)
 *   data          datos para el detalle en la campana
 *   links         { guardians, staff } rutas del detalle · linkLabel texto del botón
 *   dedupeKey     el mismo aviso no se repite (por canal y destinatario)
 *   skipEmail     no encolar correo (p. ej. el comprobante de pago va aparte, con su PDF)
 *   channels      { bell, email } elegidos para ESTE aviso (p. ej. en una cita): reemplazan a la matriz
 * Devuelve { bell: notificación|null, emails: n }.
 */
async function notify(trx, tenantId, opts) {
  try {
    return await trx.transaction((sp) => emit(sp, tenantId, opts));
  } catch (err) {
    console.error(`[avisos] No se pudo emitir el aviso ${opts.event}:`, err.message);
    return { bell: null, emails: 0 };
  }
}

async function emit(trx, tenantId, { event, guardianIds = [], allGuardians = false, alsoStaff = false, staffOnly = false, title, body, data = {}, links = {}, linkLabel, dedupeKey = null, skipEmail = false, channels = null }) {
  const ids = [...new Set(guardianIds)];
  if (!allGuardians && !ids.length && !alsoStaff && !staffOnly) return { bell: null, emails: 0 };
  const result = { bell: null, emails: 0 };
  const enabled = async (channel) => (channels ? Boolean(channels[channel]) : prefs.isEnabled(trx, tenantId, event, channel));

  if (await enabled('bell')) {
    result.bell = await notifications.createNotification(trx, tenantId, {
      type: event,
      title,
      body,
      data: { ...data, ...(linkLabel ? { link_label: linkLabel } : {}), links },
      audience: staffOnly ? ['staff'] : alsoStaff ? ['staff', 'guardians'] : ['guardians'],
      targetGuardianIds: staffOnly || allGuardians || (alsoStaff && !ids.length) ? null : ids,
      dedupeKey,
    });
  }

  if (!skipEmail && !staffOnly && (await enabled('email')) && (await prefs.emailStatus(trx, tenantId)).ready) {
    const guardians = await trx('guardians')
      .where({ tenant_id: tenantId })
      .whereNotNull('email')
      .andWhere('email', '<>', '')
      .modify((q) => !allGuardians && q.whereIn('id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']))
      .select('id', 'email');
    const tenant = await trx('tenants').where({ id: tenantId }).first('name', 'slug');
    const { html, text } = renderEmail({
      schoolName: tenant?.name || 'El colegio',
      schoolSlug: tenant?.slug,
      title,
      body,
      link: links.guardians,
      linkLabel,
    });
    const seen = new Set();
    const messages = [];
    for (const g of guardians) {
      const to = g.email.trim().toLowerCase();
      if (seen.has(to)) continue; // un correo compartido recibe un solo aviso
      seen.add(to);
      messages.push({ guardianId: g.id, to, subject: `${title} · ${tenant?.name || 'Colegio'}`, html, text, eventType: event, dedupeKey: dedupeKey ? `${dedupeKey}:${to}` : null });
    }
    result.emails = await outbox.enqueue(trx, tenantId, messages);
  }
  return result;
}

module.exports = { notify, guardiansOfStudents, guardiansOfSections, renderEmail };
