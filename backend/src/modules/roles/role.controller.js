const { z } = require('zod');
const roleService = require('./role.service');
const { asyncHandler } = require('../../utils/asyncHandler');

const list = asyncHandler(async (req, res) => {
  const roles = await roleService.listRoles(req.db, req.tenantId);
  res.status(200).json(roles);
});

const getOne = asyncHandler(async (req, res) => {
  const role = await roleService.getRoleWithPermissions(req.db, req.tenantId, req.params.id);
  res.status(200).json(role);
});

const create = asyncHandler(async (req, res) => {
  const schema = z.object({ name: z.string().min(1) });
  const data = schema.parse(req.body);
  const role = await roleService.createRole(req.db, req.tenantId, data);
  res.status(201).json(role);
});

const rename = asyncHandler(async (req, res) => {
  const schema = z.object({ name: z.string().min(1) });
  const data = schema.parse(req.body);
  const role = await roleService.renameRole(req.db, req.tenantId, req.params.id, data);
  res.status(200).json(role);
});

const remove = asyncHandler(async (req, res) => {
  await roleService.deleteRole(req.db, req.tenantId, req.params.id);
  res.status(204).send();
});

const permissionSchema = z.object({
  moduleCode: z.string().min(1),
  canCreate: z.boolean().default(false),
  canRead: z.boolean().default(false),
  canUpdate: z.boolean().default(false),
  canDelete: z.boolean().default(false),
  extraActions: z.record(z.boolean()).default({}),
});

const setPermissions = asyncHandler(async (req, res) => {
  const schema = z.object({ permissions: z.array(permissionSchema).min(1) });
  const { permissions } = schema.parse(req.body);
  const role = await roleService.setRolePermissions(req.db, req.tenantId, req.params.id, permissions);
  res.status(200).json(role);
});

const listModules = asyncHandler(async (req, res) => {
  const modules = await roleService.listModules(req.db);
  res.status(200).json(modules);
});

module.exports = { list, getOne, create, rename, remove, setPermissions, listModules };
