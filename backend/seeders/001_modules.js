const { MODULES } = require('../src/config/modules');

/** Sincroniza la tabla `modules` (catálogo global) con config/modules.js. */
async function seedModules(db) {
  for (const mod of MODULES) {
    const existing = await db('modules').where({ code: mod.code }).first();
    if (existing) {
      await db('modules').where({ code: mod.code }).update({ label: mod.label, sort_order: mod.sortOrder });
    } else {
      await db('modules').insert({ code: mod.code, label: mod.label, sort_order: mod.sortOrder });
    }
  }
  console.log(`[seed] ${MODULES.length} módulos sincronizados.`);
}

module.exports = { seedModules };
