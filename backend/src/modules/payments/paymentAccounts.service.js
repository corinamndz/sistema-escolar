const { ApiError } = require('../../utils/ApiError');

/**
 * Datos de pago del colegio (migración 025): pago móvil y cuentas bancarias
 * donde los representantes pagan. La administración los gestiona en
 * Configuración → Datos de pago; el representante los ve al reportar un pago,
 * según el método elegido (pago móvil → pago móvil; transferencia o depósito
 * → cuentas bancarias).
 */

const METHODS = ['mobile_payment', 'transfer'];
const ACCOUNT_TYPES = { checking: 'Corriente', savings: 'Ahorros' };

/** "v12345678" → "V-12345678"; "j123456789" → "J-12345678-9". Si no encaja, se deja tal cual (en mayúsculas). */
function normalizeHolderId(value) {
  const raw = String(value || '').trim().toUpperCase().replace(/[\s.]/g, '');
  const m = /^([VEJGPC])-?(\d{5,9})-?(\d)?$/.exec(raw);
  if (!m) return raw;
  const [, letter, num, check] = m;
  if (check) return `${letter}-${num}-${check}`;
  // RIF de persona jurídica sin guion: los 9 dígitos llevan el verificador al final.
  if ((letter === 'J' || letter === 'G') && num.length === 9) return `${letter}-${num.slice(0, 8)}-${num.slice(8)}`;
  return `${letter}-${num}`;
}

/** "+58 414 1234567" / "04141234567" → "0414-1234567"; otros formatos se dejan tal cual. */
function normalizePhone(value) {
  const raw = String(value || '').trim();
  const digits = raw.replace(/\D/g, '');
  const m = /^(?:58)?0?(4\d{2})(\d{7})$/.exec(digits);
  return m ? `0${m[1]}-${m[2]}` : raw;
}

/** Número de cuenta: solo dígitos (se aceptan espacios y guiones al escribirlo). */
const normalizeAccount = (value) => String(value || '').replace(/[\s-]/g, '');

function toRow({ method, bankCode, bankName, holderName, holderId, phone, accountNumber, accountType, notes, isActive }) {
  const row = {
    method,
    bank_code: bankCode || null,
    bank_name: String(bankName).trim(),
    holder_name: holderName?.trim() || null,
    holder_id: normalizeHolderId(holderId),
    notes: notes?.trim() || null,
    is_active: isActive ?? true,
    // Solo los campos de su método (no quedan datos de pago móvil en una cuenta bancaria ni al revés).
    phone: method === 'mobile_payment' ? normalizePhone(phone) : null,
    account_number: method === 'transfer' ? normalizeAccount(accountNumber) : null,
    account_type: method === 'transfer' ? accountType : null,
  };
  if (method === 'mobile_payment' && !phone) {
    throw ApiError.badRequest('Indica el teléfono afiliado al pago móvil.', [{ path: 'phone', message: 'Requerido.' }]);
  }
  if (method === 'transfer') {
    if (!/^\d{10,30}$/.test(row.account_number)) {
      throw ApiError.badRequest('El número de cuenta debe tener solo dígitos (10 a 30; en Venezuela son 20).', [{ path: 'accountNumber', message: 'Número inválido.' }]);
    }
    if (!ACCOUNT_TYPES[accountType]) {
      throw ApiError.badRequest('Elige el tipo de cuenta: corriente o ahorros.', [{ path: 'accountType', message: 'Requerido.' }]);
    }
  }
  return row;
}

const format = (r) => ({ ...r, account_type_label: r.account_type ? ACCOUNT_TYPES[r.account_type] : null });

/** Todas las cuentas (administración): pago móvil primero, luego transferencias. */
async function listAccounts(trx, tenantId) {
  const rows = await trx('payment_accounts')
    .where({ tenant_id: tenantId })
    .orderByRaw("CASE method WHEN 'mobile_payment' THEN 0 ELSE 1 END, sort_order, created_at");
  return rows.map(format);
}

/** Solo las activas y sin datos internos: lo que ve el representante al reportar un pago. */
async function listPublicAccounts(trx, tenantId) {
  const rows = await trx('payment_accounts')
    .where({ tenant_id: tenantId, is_active: true })
    .orderByRaw("CASE method WHEN 'mobile_payment' THEN 0 ELSE 1 END, sort_order, created_at")
    .select('id', 'method', 'bank_code', 'bank_name', 'holder_name', 'holder_id', 'phone', 'account_number', 'account_type', 'notes');
  return rows.map(format);
}

async function loadAccount(trx, tenantId, id) {
  const account = await trx('payment_accounts').where({ id, tenant_id: tenantId }).first();
  if (!account) throw ApiError.notFound('Dato de pago no encontrado.');
  return account;
}

async function createAccount(trx, tenantId, data) {
  const row = toRow(data);
  const { max } = await trx('payment_accounts').where({ tenant_id: tenantId, method: row.method }).max('sort_order as max').first();
  const [created] = await trx('payment_accounts')
    .insert({ ...row, tenant_id: tenantId, sort_order: max === null ? 0 : Number(max) + 1 })
    .returning('*');
  return format(created);
}

async function updateAccount(trx, tenantId, id, data) {
  const current = await loadAccount(trx, tenantId, id);
  // Lo que no venga se conserva (PUT parcial), siempre revalidando el conjunto.
  const merged = {
    method: data.method ?? current.method,
    bankCode: data.bankCode !== undefined ? data.bankCode : current.bank_code,
    bankName: data.bankName ?? current.bank_name,
    holderName: data.holderName !== undefined ? data.holderName : current.holder_name,
    holderId: data.holderId ?? current.holder_id,
    phone: data.phone !== undefined ? data.phone : current.phone,
    accountNumber: data.accountNumber !== undefined ? data.accountNumber : current.account_number,
    accountType: data.accountType !== undefined ? data.accountType : current.account_type,
    notes: data.notes !== undefined ? data.notes : current.notes,
    isActive: data.isActive ?? current.is_active,
  };
  const [updated] = await trx('payment_accounts')
    .where({ id, tenant_id: tenantId })
    .update({ ...toRow(merged), updated_at: trx.fn.now() })
    .returning('*');
  return format(updated);
}

async function deleteAccount(trx, tenantId, id) {
  await loadAccount(trx, tenantId, id);
  await trx('payment_accounts').where({ id, tenant_id: tenantId }).delete();
  return { ok: true };
}

module.exports = { METHODS, ACCOUNT_TYPES, normalizeHolderId, normalizePhone, listAccounts, listPublicAccounts, createAccount, updateAccount, deleteAccount };
