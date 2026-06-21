import { Router } from "express";
import { prisma } from "../../prisma";
import { requireSession } from "../../middleware";
import {
  listLeadsSchema,
  createLeadSchema,
  updateLeadStatusSchema,
  addLeadNoteSchema,
  assignLeadSchema,
} from "./leads.schemas";
import {
  listLeads,
  getLead,
  createLead,
  updateLeadStatus,
  addLeadNote,
  assignLead,
  getLeadsByContact,
} from "./leads.service";
import { logAuditEvent } from "../../utils";

const router = Router();

router.get("/", requireSession, async (req, res, next) => {
  try {
    const filters = listLeadsSchema.parse(req.query);
    const result = await listLeads(req.workspaceContext.workspaceId, filters, prisma);
    res.json({ data: result });
  } catch (error) {
    next(error);
  }
});

router.post("/", requireSession, async (req, res, next) => {
  try {
    const payload = createLeadSchema.parse(req.body);
    const lead = await createLead(req.workspaceContext.workspaceId, payload, prisma);
    res.status(201).json({ data: lead });
  } catch (error) {
    next(error);
  }
});

router.get("/contact/:contactId", requireSession, async (req, res, next) => {
  try {
    const leads = await getLeadsByContact(
      req.params.contactId,
      req.workspaceContext.workspaceId,
      prisma
    );
    res.json({ data: leads });
  } catch (error) {
    next(error);
  }
});

router.get("/:id", requireSession, async (req, res, next) => {
  try {
    const lead = await getLead(String(req.params.id), req.workspaceContext.workspaceId, prisma);
    res.json({ data: lead });
  } catch (error) {
    next(error);
  }
});

router.patch("/:id/status", requireSession, async (req, res, next) => {
  try {
    const payload = updateLeadStatusSchema.parse(req.body);
    const lead = await updateLeadStatus(
      String(req.params.id),
      req.workspaceContext.workspaceId,
      payload,
      prisma
    );
    res.json({ data: lead });
  } catch (error) {
    next(error);
  }
});

router.post("/:id/notes", requireSession, async (req, res, next) => {
  try {
    const payload = addLeadNoteSchema.parse(req.body);
    const lead = await addLeadNote(
      String(req.params.id),
      req.workspaceContext.workspaceId,
      payload,
      prisma
    );
    res.status(201).json({ data: lead });
  } catch (error) {
    next(error);
  }
});

router.post("/:id/assign", requireSession, async (req, res, next) => {
  try {
    const { userId } = assignLeadSchema.parse(req.body);
    const lead = await assignLead(
      String(req.params.id),
      req.workspaceContext.workspaceId,
      userId,
      prisma
    );
    await logAuditEvent({
      workspaceId: req.workspaceContext.workspaceId,
      actorId: req.workspaceContext.userId,
      action: "lead.assigned",
      summary: userId ? `Lead ${String(req.params.id)} assigned to ${userId}` : `Lead ${String(req.params.id)} unassigned`,
      payload: { leadId: String(req.params.id), assignedTo: userId },
    });
    res.json({ data: lead });
  } catch (error) {
    next(error);
  }
});

export default router;
