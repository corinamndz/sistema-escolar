/**
 * Motor del generador automático de horarios (CSP), sin acceso a la base:
 * recibe los datos ya cargados y devuelve dónde va cada clase. Así se puede
 * probar aislado y el servicio solo traduce de/a la base.
 *
 * Modelo
 * ------
 *   Celda   = (día, bloque de clase). C = días × bloques (los recreos no cuentan).
 *   Grupo   = una materia de una sección con su docente: necesita `hours` celdas.
 *   Fijas   = clases que ya existen y no se mueven (otras secciones del año, o las
 *             ya colocadas en modo "completar"): ocupan sección, docente y aula.
 *
 * Restricciones DURAS (nunca se violan):
 *   - una clase por celda en cada sección;
 *   - un docente no da dos clases en la misma celda (anti-cruce);
 *   - un docente no da clase en un bloque marcado como no disponible;
 *   - dos secciones que comparten aula no coinciden en la misma celda;
 *   - una materia no pasa de `maxPerDay` horas en un mismo día
 *     (ceil(horas / días); si así no hay solución, se permite una hora más).
 * Objetivo: cumplir TODAS las horas semanales. Preferencias (no obligatorias):
 *   repartir cada materia en la semana y evitar huecos del docente.
 *
 * Búsqueda
 * --------
 *   Backtracking con:
 *   - variable más restringida primero (MRV): el grupo con menos holgura
 *     (celdas posibles − horas pendientes), desempatando por el docente con
 *     más carga y la materia con más horas;
 *   - ruptura de simetría: las horas de un mismo grupo se colocan en orden
 *     creciente de celda (son intercambiables);
 *   - forward checking: tras colocar, todo grupo vecino (misma sección,
 *     docente o aula) debe conservar celdas suficientes para sus horas;
 *   - reinicios con otra semilla dentro de un presupuesto de tiempo.
 *   Si no hay solución completa, se devuelve la mejor parcial (la que coloca
 *   más horas) y, por cada grupo incompleto, el diagnóstico de por qué.
 */

// PRNG determinista (mulberry32): misma semilla → mismo horario.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * @param {object} input
 *   days:   [1..5]
 *   slots:  [{ id }] bloques de clase en orden
 *   groups: [{ key, sectionId, teacherId, roomId|null, hours }]
 *   fixed:  [{ sectionId, teacherId, roomId|null, day, slotId, label }]
 *   unavailable: [{ teacherId, day, slotId, reason }]
 *   options: { timeMs = 6000, maxNodesPerAttempt = 60000, seed = 1 }
 */
function solve(input) {
  const { days, slots, groups, fixed = [], unavailable = [], options = {} } = input;
  const timeMs = options.timeMs ?? 6000;
  const maxNodes = options.maxNodesPerAttempt ?? 60000;
  const started = Date.now();
  const D = days.length;
  const S = slots.length;
  const C = D * S;
  const dayIndex = new Map(days.map((d, i) => [d, i]));
  const slotIndex = new Map(slots.map((s, i) => [s.id, i]));
  const cellOf = (day, slotId) => dayIndex.get(day) * S + slotIndex.get(slotId);
  const dayOfCell = (c) => Math.floor(c / S);
  const slotOfCell = (c) => c % S;

  // ---- Recursos (sección, docente, aula) → ocupación base (clases fijas) ----
  const base = new Map(); // `s:<id>` | `t:<id>` | `r:<id>` → Uint8Array(C)
  const busyOf = (key) => {
    if (!base.has(key)) base.set(key, new Uint8Array(C));
    return base.get(key);
  };
  const fixedAt = new Map(); // `${key}|${c}` → etiqueta de la clase fija (para el diagnóstico)
  for (const f of fixed) {
    if (!dayIndex.has(f.day) || !slotIndex.has(f.slotId)) continue;
    const c = cellOf(f.day, f.slotId);
    for (const key of [`s:${f.sectionId}`, `t:${f.teacherId}`, f.roomId ? `r:${f.roomId}` : null].filter(Boolean)) {
      busyOf(key)[c] = 1;
      if (!fixedAt.has(`${key}|${c}`)) fixedAt.set(`${key}|${c}`, f.label || '');
    }
  }
  const unavail = new Map(); // teacherId → Uint8Array(C)
  const unavailReason = new Map();
  for (const u of unavailable) {
    if (!dayIndex.has(u.day) || !slotIndex.has(u.slotId)) continue;
    if (!unavail.has(u.teacherId)) unavail.set(u.teacherId, new Uint8Array(C));
    const c = cellOf(u.day, u.slotId);
    unavail.get(u.teacherId)[c] = 1;
    if (u.reason) unavailReason.set(`${u.teacherId}|${c}`, u.reason);
  }

  const G = groups.length;
  const gs = groups.map((g, i) => ({
    ...g,
    i,
    sKey: `s:${g.sectionId}`,
    tKey: `t:${g.teacherId}`,
    rKey: g.roomId ? `r:${g.roomId}` : null,
    capStrict: Math.min(S, Math.max(1, Math.ceil(g.hours / D))),
  }));
  // Vecinos: grupos que comparten sección, docente o aula.
  const byResource = new Map();
  gs.forEach((g) => [g.sKey, g.tKey, g.rKey].filter(Boolean).forEach((k) => (byResource.get(k) || byResource.set(k, []).get(k)).push(g.i)));
  const neighbors = gs.map((g) => [...new Set([g.sKey, g.tKey, g.rKey].filter(Boolean).flatMap((k) => byResource.get(k)))]);
  const teacherLoad = new Map();
  gs.forEach((g) => teacherLoad.set(g.teacherId, (teacherLoad.get(g.teacherId) || 0) + g.hours));

  /** Un intento completo de búsqueda con una semilla y un tope diario. */
  function attempt(seed, relaxed, deadline) {
    const rand = rng(seed);
    const busy = new Map([...base.entries()].map(([k, v]) => [k, Uint8Array.from(v)]));
    const res = (k) => busy.get(k) || busy.set(k, new Uint8Array(C)).get(k);
    gs.forEach((g) => [g.sKey, g.tKey, g.rKey].filter(Boolean).forEach(res));
    const cap = gs.map((g) => Math.min(S, g.capStrict + (relaxed ? 1 : 0)));
    const placed = gs.map(() => []); // celdas por grupo, en orden creciente
    const perDay = gs.map(() => new Uint8Array(D));
    const jitter = gs.map(() => rand());
    let total = 0;
    let nodes = 0;
    let best = { total: -1, placed: null };

    const free = (g, c) => {
      if (busy.get(g.sKey)[c] || busy.get(g.tKey)[c] || (g.rKey && busy.get(g.rKey)[c])) return false;
      const u = unavail.get(g.teacherId);
      if (u && u[c]) return false;
      return perDay[g.i][dayOfCell(c)] < cap[g.i];
    };
    const lastCell = (g) => (placed[g.i].length ? placed[g.i][placed[g.i].length - 1] : -1);
    const remaining = (g) => g.hours - placed[g.i].length;
    /** Celdas posibles para las horas que le faltan (después de la última colocada). */
    const domainCount = (g) => {
      let n = 0;
      for (let c = lastCell(g) + 1; c < C; c += 1) if (free(g, c)) n += 1;
      return n;
    };
    const set = (g, c, v) => {
      busy.get(g.sKey)[c] = v;
      busy.get(g.tKey)[c] = v;
      if (g.rKey) busy.get(g.rKey)[c] = v;
    };

    /** Preferencia de una celda (menor = mejor): reparto en la semana y pocos huecos del docente. */
    const score = (g, c) => {
      const d = dayOfCell(c);
      const k = placed[g.i].length;
      // Día "ideal" de la k-ésima hora si las n horas se repartieran parejo en la semana.
      const idealDay = Math.min(D - 1, Math.floor(((k + 0.5) * D) / g.hours));
      let s = Math.abs(d - idealDay) * 4 + perDay[g.i][d] * 6;
      // Junto a otra clase del docente ese día: menos tiempo muerto.
      const t = busy.get(g.tKey);
      const slot = slotOfCell(c);
      const near = (slot > 0 && t[c - 1]) || (slot < S - 1 && t[c + 1]);
      if (!near) {
        let teachesThatDay = false;
        for (let x = d * S; x < (d + 1) * S; x += 1) if (t[x]) teachesThatDay = true;
        if (teachesThatDay) s += 3;
      }
      return s + rand() * 2;
    };

    function snapshot() {
      if (total > best.total) best = { total, placed: placed.map((p) => [...p]) };
    }

    function pick() {
      let chosen = null;
      let chosenSlack = Infinity;
      let chosenTie = -Infinity;
      for (const g of gs) {
        const rem = remaining(g);
        if (rem <= 0) continue;
        const slack = domainCount(g) - rem;
        const tie = (teacherLoad.get(g.teacherId) || 0) * 10 + g.hours + jitter[g.i];
        if (slack < chosenSlack || (slack === chosenSlack && tie > chosenTie)) {
          chosen = g;
          chosenSlack = slack;
          chosenTie = tie;
        }
      }
      return { g: chosen, slack: chosenSlack };
    }

    function dfs() {
      nodes += 1;
      if (nodes > maxNodes || Date.now() > deadline) return 'budget';
      const { g, slack } = pick();
      if (!g) return 'done';
      if (slack < 0) {
        snapshot();
        return 'fail';
      }
      const rem = remaining(g);
      const candidates = [];
      for (let c = lastCell(g) + 1; c <= C - rem; c += 1) if (free(g, c)) candidates.push(c);
      candidates.sort((a, b) => score(g, a) - score(g, b));
      for (const c of candidates) {
        set(g, c, 1);
        placed[g.i].push(c);
        perDay[g.i][dayOfCell(c)] += 1;
        total += 1;
        // Forward checking sobre los vecinos.
        let ok = true;
        for (const j of neighbors[g.i]) {
          const h = gs[j];
          const r = remaining(h);
          if (r > 0 && domainCount(h) < r) {
            ok = false;
            break;
          }
        }
        if (ok) {
          const out = dfs();
          if (out === 'done' || out === 'budget') {
            if (out === 'budget') snapshot();
            if (out === 'done') snapshot();
            if (out === 'done') return 'done';
            // presupuesto agotado: se deshace igual para dejar el estado consistente
            total -= 1;
            perDay[g.i][dayOfCell(c)] -= 1;
            placed[g.i].pop();
            set(g, c, 0);
            return 'budget';
          }
        } else snapshot();
        total -= 1;
        perDay[g.i][dayOfCell(c)] -= 1;
        placed[g.i].pop();
        set(g, c, 0);
      }
      snapshot();
      return 'fail';
    }

    const outcome = dfs();
    return { outcome, best, nodes };
  }

  /**
   * Respaldo cuando no hay solución completa: voraz que SALTA lo imposible y
   * coloca todo lo demás (más restringido primero). Suele colocar más horas que
   * la mejor rama parcial del backtracking.
   */
  function greedy(seed, relaxed) {
    const rand = rng(seed);
    const busy = new Map([...base.entries()].map(([k, v]) => [k, Uint8Array.from(v)]));
    const res = (k) => busy.get(k) || busy.set(k, new Uint8Array(C)).get(k);
    gs.forEach((g) => [g.sKey, g.tKey, g.rKey].filter(Boolean).forEach(res));
    const cap = gs.map((g) => Math.min(S, g.capStrict + (relaxed ? 1 : 0)));
    const placed = gs.map(() => []);
    const perDay = gs.map(() => new Uint8Array(D));
    const free = (g, c) =>
      !busy.get(g.sKey)[c] && !busy.get(g.tKey)[c] && !(g.rKey && busy.get(g.rKey)[c]) && !(unavail.get(g.teacherId)?.[c]) && perDay[g.i][dayOfCell(c)] < cap[g.i];
    const open = new Set(gs.filter((g) => g.hours > 0).map((g) => g.i));
    let total = 0;
    while (open.size) {
      let chosen = null;
      let options = null;
      for (const i of open) {
        const g = gs[i];
        const cells = [];
        for (let c = 0; c < C; c += 1) if (free(g, c)) cells.push(c);
        const slack = cells.length - (g.hours - placed[i].length);
        if (!chosen || slack < options.slack) {
          chosen = g;
          options = { cells, slack };
        }
      }
      if (!options.cells.length) {
        open.delete(chosen.i); // no cabe más: queda incompleto
        continue;
      }
      // Día con menos horas de esta materia; dentro, junto a clases del docente.
      const t = busy.get(chosen.tKey);
      options.cells.sort((a, b) => {
        const da = perDay[chosen.i][dayOfCell(a)] * 10 + (t[a - 1] || t[a + 1] ? 0 : 2) + rand();
        const db = perDay[chosen.i][dayOfCell(b)] * 10 + (t[b - 1] || t[b + 1] ? 0 : 2) + rand();
        return da - db;
      });
      const c = options.cells[0];
      busy.get(chosen.sKey)[c] = 1;
      busy.get(chosen.tKey)[c] = 1;
      if (chosen.rKey) busy.get(chosen.rKey)[c] = 1;
      placed[chosen.i].push(c);
      perDay[chosen.i][dayOfCell(c)] += 1;
      total += 1;
      if (placed[chosen.i].length >= chosen.hours) open.delete(chosen.i);
    }
    return { total, placed };
  }

  const required = gs.reduce((s, g) => s + g.hours, 0);
  let best = { total: -1, placed: gs.map(() => []) };
  let attempts = 0;
  let nodes = 0;
  let relaxedUsed = false;
  let complete = false;

  if (C > 0 && G > 0 && required > 0) {
    const deadline = started + timeMs;
    // Primero con el reparto estricto; si no alcanza, se permite una hora más por día.
    for (const relaxed of [false, true]) {
      for (let k = 0; k < 6 && Date.now() < deadline; k += 1) {
        attempts += 1;
        const r = attempt((options.seed ?? 1) + k * 7919 + (relaxed ? 104729 : 0), relaxed, Math.min(deadline, Date.now() + Math.max(400, timeMs / 8)));
        nodes += r.nodes;
        if (r.best.total > best.total) {
          best = r.best;
          relaxedUsed = relaxed;
        }
        if (r.outcome === 'done') {
          complete = true;
          break;
        }
      }
      if (complete) break;
    }
    if (!complete) {
      for (const relaxed of [false, true]) {
        const r = greedy((options.seed ?? 1) + 31, relaxed);
        if (r.total > best.total) {
          best = r;
          relaxedUsed = relaxed;
        }
      }
      complete = best.total === required;
    }
  } else {
    complete = required === 0;
    best = { total: 0, placed: gs.map(() => []) };
  }

  // ---- Resultado ----
  const placements = [];
  gs.forEach((g) => (best.placed[g.i] || []).forEach((c) => placements.push({ key: g.key, day: days[dayOfCell(c)], slotId: slots[slotOfCell(c)].id })));

  // Diagnóstico de cada grupo incompleto, con la ocupación FINAL.
  const finalBusy = new Map([...base.entries()].map(([k, v]) => [k, Uint8Array.from(v)]));
  const fres = (k) => finalBusy.get(k) || finalBusy.set(k, new Uint8Array(C)).get(k);
  const placedBy = new Map(); // `${key}|${c}` → grupo colocado (para nombrar el choque)
  gs.forEach((g) =>
    (best.placed[g.i] || []).forEach((c) => {
      for (const k of [g.sKey, g.tKey, g.rKey].filter(Boolean)) {
        fres(k)[c] = 1;
        placedBy.set(`${k}|${c}`, g.key);
      }
    })
  );
  const unplaced = [];
  gs.forEach((g) => {
    const got = (best.placed[g.i] || []).length;
    if (got >= g.hours) return;
    const reasons = { sectionFull: 0, teacherBusy: [], teacherUnavailable: [], roomBusy: [], dailyCap: 0, free: 0 };
    const perDayFinal = new Uint8Array(D);
    (best.placed[g.i] || []).forEach((c) => (perDayFinal[dayOfCell(c)] += 1));
    for (let c = 0; c < C; c += 1) {
      const cell = { day: days[dayOfCell(c)], slotId: slots[slotOfCell(c)].id };
      if (fres(g.sKey)[c]) {
        reasons.sectionFull += 1;
        continue;
      }
      if (unavail.get(g.teacherId)?.[c]) {
        reasons.teacherUnavailable.push({ ...cell, reason: unavailReason.get(`${g.teacherId}|${c}`) || null });
        continue;
      }
      if (fres(g.tKey)[c]) {
        reasons.teacherBusy.push({ ...cell, with: fixedAt.get(`${g.tKey}|${c}`) ?? null, withGroup: placedBy.get(`${g.tKey}|${c}`) ?? null });
        continue;
      }
      if (g.rKey && fres(g.rKey)[c]) {
        reasons.roomBusy.push({ ...cell, with: fixedAt.get(`${g.rKey}|${c}`) ?? null, withGroup: placedBy.get(`${g.rKey}|${c}`) ?? null });
        continue;
      }
      if (perDayFinal[dayOfCell(c)] >= Math.min(S, g.capStrict + 1)) {
        reasons.dailyCap += 1;
        continue;
      }
      reasons.free += 1; // libre para todos: quedó fuera por el resto de la combinación
    }
    unplaced.push({ key: g.key, required: g.hours, placed: got, missing: g.hours - got, reasons });
  });

  return {
    complete,
    placements,
    unplaced,
    stats: { required, placed: placements.length, cells: C, attempts, nodes, relaxed: relaxedUsed, ms: Date.now() - started },
  };
}

module.exports = { solve };
