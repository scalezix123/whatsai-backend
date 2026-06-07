import { Router } from "express";
import { prisma } from "../../prisma";
import { requireSession } from "../../middleware";
import {
  createContactSchema,
  updateContactSchema,
  listContactsSchema,
  createTagSchema,
  listTagsSchema,
  createAttributeSchema,
  setAttributeValueSchema,
  startContactImportSchema,
  listImportBatchesSchema,
  markContactOptInSchema,
  markContactOptOutSchema,
  bulkUpdateOptInSchema,
} from "./contacts.schemas";
import {
  createContact,
  listContacts,
  getContact,
  updateContact,
  deleteContact,
  createTag,
  listTags,
  assignTagToContact,
  removeTagFromContact,
  createAttributeDefinition,
  setContactAttribute,
  markContactOptIn,
  markContactOptOut,
  bulkUpdateOptInStatus,
  startContactImport,
  listImportBatches,
  getImportBatch,
  downloadImportErrors,
} from "./contacts.service";

const router = Router();

// ============================================================================
// CONTACT CRUD ENDPOINTS
// ============================================================================

router.get("/", requireSession, async (req, res, next) => {
  try {
    const filters = listContactsSchema.parse(req.query);
    const result = await listContacts(req.workspaceContext.workspaceId, filters, prisma);
    res.json({ data: result });
  } catch (error) {
    next(error);
  }
});

router.post("/", requireSession, async (req, res, next) => {
  try {
    const payload = createContactSchema.parse(req.body);
    const contact = await createContact(req.workspaceContext.workspaceId, payload, prisma);
    res.status(201).json({ data: contact });
  } catch (error) {
    next(error);
  }
});

router.get("/:id", requireSession, async (req, res, next) => {
  try {
    const contact = await getContact(req.params.id, req.workspaceContext.workspaceId, prisma);
    res.json({ data: contact });
  } catch (error) {
    next(error);
  }
});

router.patch("/:id", requireSession, async (req, res, next) => {
  try {
    const payload = updateContactSchema.parse(req.body);
    const contact = await updateContact(
      req.params.id,
      req.workspaceContext.workspaceId,
      payload,
      prisma
    );
    res.json({ data: contact });
  } catch (error) {
    next(error);
  }
});

router.delete("/:id", requireSession, async (req, res, next) => {
  try {
    await deleteContact(req.params.id, req.workspaceContext.workspaceId, prisma);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// TAG MANAGEMENT ENDPOINTS
// ============================================================================

router.post("/tags", requireSession, async (req, res, next) => {
  try {
    const payload = createTagSchema.parse(req.body);
    const tag = await createTag(req.workspaceContext.workspaceId, payload, prisma);
    res.status(201).json({ data: tag });
  } catch (error) {
    next(error);
  }
});

router.get("/tags/list", requireSession, async (req, res, next) => {
  try {
    const filters = listTagsSchema.parse(req.query);
    const result = await listTags(req.workspaceContext.workspaceId, filters, prisma);
    res.json({ data: result });
  } catch (error) {
    next(error);
  }
});

router.post("/:id/tags/:tagName", requireSession, async (req, res, next) => {
  try {
    const tag = await assignTagToContact(
      req.params.id,
      req.workspaceContext.workspaceId,
      req.params.tagName,
      prisma
    );
    res.status(201).json({ data: tag });
  } catch (error) {
    next(error);
  }
});

router.delete("/:id/tags/:tagName", requireSession, async (req, res, next) => {
  try {
    await removeTagFromContact(
      req.params.id,
      req.workspaceContext.workspaceId,
      req.params.tagName,
      prisma
    );
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// ATTRIBUTE MANAGEMENT ENDPOINTS
// ============================================================================

router.post("/attributes", requireSession, async (req, res, next) => {
  try {
    const payload = createAttributeSchema.parse(req.body);
    const attribute = await createAttributeDefinition(
      req.workspaceContext.workspaceId,
      payload,
      prisma
    );
    res.status(201).json({ data: attribute });
  } catch (error) {
    next(error);
  }
});

router.post("/:id/attributes", requireSession, async (req, res, next) => {
  try {
    const payload = setAttributeValueSchema.parse(req.body);
    const value = await setContactAttribute(
      req.params.id,
      req.workspaceContext.workspaceId,
      payload.attributeName,
      payload.value,
      prisma
    );
    res.status(201).json({ data: value });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// CONSENT MANAGEMENT ENDPOINTS
// ============================================================================

router.post("/:id/opt-in", requireSession, async (req, res, next) => {
  try {
    const contact = await markContactOptIn(
      req.params.id,
      req.workspaceContext.workspaceId,
      prisma
    );
    res.json({ data: contact });
  } catch (error) {
    next(error);
  }
});

router.post("/:id/opt-out", requireSession, async (req, res, next) => {
  try {
    const { reason } = req.body;
    const contact = await markContactOptOut(
      req.params.id,
      req.workspaceContext.workspaceId,
      reason,
      prisma
    );
    res.json({ data: contact });
  } catch (error) {
    next(error);
  }
});

router.post("/bulk/update-opt-in", requireSession, async (req, res, next) => {
  try {
    const payload = bulkUpdateOptInSchema.parse(req.body);
    const result = await bulkUpdateOptInStatus(req.workspaceContext.workspaceId, payload, prisma);
    res.json({ data: result });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// CSV IMPORT ENDPOINTS
// ============================================================================

router.post("/import/start", requireSession, async (req, res, next) => {
  try {
    // Parse CSV file from request
    // This is a simplified version - real implementation would use multer for file uploads
    const { fileName, rows, columnMapping, skipDuplicates } = req.body;

    const payload = startContactImportSchema.parse({ columnMapping, skipDuplicates });
    const batch = await startContactImport(
      req.workspaceContext.workspaceId,
      fileName || "import.csv",
      rows || [],
      payload.columnMapping,
      payload.skipDuplicates,
      prisma
    );

    res.status(201).json({ data: batch });
  } catch (error) {
    next(error);
  }
});

router.get("/import/batches", requireSession, async (req, res, next) => {
  try {
    const filters = listImportBatchesSchema.parse(req.query);
    const result = await listImportBatches(req.workspaceContext.workspaceId, filters, prisma);
    res.json({ data: result });
  } catch (error) {
    next(error);
  }
});

router.get("/import/batches/:batchId", requireSession, async (req, res, next) => {
  try {
    const batch = await getImportBatch(req.params.batchId, req.workspaceContext.workspaceId, prisma);
    res.json({ data: batch });
  } catch (error) {
    next(error);
  }
});

router.get("/import/batches/:batchId/errors.csv", requireSession, async (req, res, next) => {
  try {
    const csv = await downloadImportErrors(
      req.params.batchId,
      req.workspaceContext.workspaceId,
      prisma
    );
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="import-errors-${req.params.batchId}.csv"`);
    res.send(csv);
  } catch (error) {
    next(error);
  }
});

export default router;
