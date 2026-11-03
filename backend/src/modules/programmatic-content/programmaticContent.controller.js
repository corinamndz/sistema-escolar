const { z } = require('zod');
const service = require('./programmaticContent.service');
const { asyncHandler } = require('../../utils/asyncHandler');
const teacherScope = require('../access/teacherScope');
const reviews = require('../reviews/review.service');

const uuid = (message) => z.string().uuid({ message });
const text = (label, max) => z.string().trim().min(1, `${label} es obligatorio.`).max(max, `${label}: máximo ${max} caracteres.`);
const fields = {
  unit: text('La unidad', 100),
  topic: text('El tema', 200),
  description: text('La descripción del contenido', 4000),
};

/** GET /programmatic-content/options?schoolPeriodId= — materias y grados (docente: los que dicta), con los temas de ese año. */
const listOptions = asyncHandler(async (req, res) => {
  const { schoolPeriodId } = z.object({ schoolPeriodId: uuid('El año escolar no es válido.').optional() }).parse({ schoolPeriodId: req.query.schoolPeriodId || undefined });
  res.status(200).json(await service.listOptions(req.db, req.tenantId, { pairs: await teacherScope.teachingPairs(req), schoolPeriodId }));
});

/** GET /programmatic-content?gradeId=&subjectId=&schoolPeriodId= — temario con sus evaluaciones. */
const getContent = asyncHandler(async (req, res) => {
  const query = z
    .object({
      gradeId: uuid('El grado no es válido.'),
      subjectId: uuid('La materia no es válida.'),
      // Cada año escolar tiene su propio temario (068).
      schoolPeriodId: uuid('Elige el año escolar.'),
    })
    .parse(req.query);
  await teacherScope.assertGradeSubjectAccess(req, query.gradeId, query.subjectId);
  const scope = await teacherScope.getAccessScope(req);
  const content = await service.getContent(req.db, req.tenantId, query, { scope, coversPlan: teacherScope.coversPlan, coversSubject: teacherScope.coversSubject });
  // Revisión académica (059): si está activa, su estado (del programa de ESE año) y si este usuario puede editar.
  res.status(200).json({ ...content, review: await reviews.contentReviewState(req, query.gradeId, query.subjectId, query.schoolPeriodId) });
});

/** POST /programmatic-content — { gradeId, subjectId, schoolPeriodId, unit, topic, description } */
const createItem = asyncHandler(async (req, res) => {
  const data = z
    .object({ gradeId: uuid('El grado no es válido.'), subjectId: uuid('La materia no es válida.'), schoolPeriodId: uuid('Elige el año escolar.'), ...fields })
    .parse(req.body);
  await teacherScope.assertGradeSubjectAccess(req, data.gradeId, data.subjectId);
  await reviews.assertContentEditable(req, data.gradeId, data.subjectId, data.schoolPeriodId);
  res.status(201).json(await service.createItem(req.db, req.tenantId, data));
});

/**
 * Middleware: el ítem de la ruta debe ser de una materia y grado que el docente
 * dicta, y su programa no puede estar bloqueado por la revisión (059).
 */
const ownItem = async (req, res, next) => {
  try {
    const id = uuid('El contenido no es válido.').parse(req.params.id);
    const item = await service.getItem(req.db, req.tenantId, id);
    await teacherScope.assertGradeSubjectAccess(req, item.grade_id, item.subject_id);
    await reviews.assertContentEditable(req, item.grade_id, item.subject_id, item.school_period_id);
    next();
  } catch (err) {
    next(err);
  }
};

/** PUT /programmatic-content/:id — { unit?, topic?, description? } */
const updateItem = asyncHandler(async (req, res) => {
  const data = z.object(fields).partial().parse(req.body);
  res.status(200).json(await service.updateItem(req.db, req.tenantId, req.params.id, data));
});

/** DELETE /programmatic-content/:id → { unlinkedActivities } (las actividades quedan en su plan). */
const deleteItem = asyncHandler(async (req, res) => {
  res.status(200).json(await service.deleteItem(req.db, req.tenantId, req.params.id));
});

/**
 * POST /programmatic-content/duplicate — { gradeId, subjectId, fromPeriodId, toPeriodId }
 * Copia unidades y temas al año destino (en la transacción del request: todo o nada).
 */
const duplicate = asyncHandler(async (req, res) => {
  const data = z
    .object({
      gradeId: uuid('El grado no es válido.'),
      subjectId: uuid('La materia no es válida.'),
      fromPeriodId: uuid('El año de origen no es válido.'),
      toPeriodId: uuid('Elige el año escolar de destino.'),
    })
    .parse(req.body);
  await teacherScope.assertGradeSubjectAccess(req, data.gradeId, data.subjectId);
  // Agregar temas al destino es editar su programa: respeta su revisión.
  await reviews.assertContentEditable(req, data.gradeId, data.subjectId, data.toPeriodId);
  const { map: _map, ...result } = await service.duplicateContent(req.db, req.tenantId, data);
  res.status(201).json(result);
});

module.exports = { listOptions, getContent, createItem, ownItem, updateItem, deleteItem, duplicate };
