import { Router } from "express";
import { prisma } from "../../prisma";
import { requireSession } from "../../middleware";
import {
  listConversationsSchema,
  updateConversationSchema,
  addMessageSchema,
  assignConversationSchema,
  addNoteSchema,
} from "./conversations.schemas";
import {
  listConversations,
  getConversation,
  updateConversation,
  addMessage,
  assignConversation,
  addNote,
  markConversationAsRead,
} from "./conversations.service";

const router = Router();

router.get("/", requireSession, async (req, res, next) => {
  try {
    const filters = listConversationsSchema.parse(req.query);
    const result = await listConversations(req.workspaceContext.workspaceId, filters, prisma);
    res.json({ data: result });
  } catch (error) {
    next(error);
  }
});

router.get("/:id", requireSession, async (req, res, next) => {
  try {
    const conversation = await getConversation(
      String(req.params.id),
      req.workspaceContext.workspaceId,
      prisma
    );
    res.json({ data: conversation });
  } catch (error) {
    next(error);
  }
});

router.patch("/:id", requireSession, async (req, res, next) => {
  try {
    const payload = updateConversationSchema.parse(req.body);
    const conversation = await updateConversation(
      String(req.params.id),
      req.workspaceContext.workspaceId,
      payload,
      prisma
    );
    res.json({ data: conversation });
  } catch (error) {
    next(error);
  }
});

router.post("/:id/messages", requireSession, async (req, res, next) => {
  try {
    const payload = addMessageSchema.parse(req.body);
    const message = await addMessage(
      String(req.params.id),
      req.workspaceContext.workspaceId,
      payload,
      prisma
    );
    res.status(201).json({ data: message });
  } catch (error) {
    next(error);
  }
});

router.post("/:id/assign", requireSession, async (req, res, next) => {
  try {
    const payload = assignConversationSchema.parse(req.body);
    const conversation = await assignConversation(
      String(req.params.id),
      req.workspaceContext.workspaceId,
      payload,
      prisma
    );
    res.json({ data: conversation });
  } catch (error) {
    next(error);
  }
});

router.post("/:id/notes", requireSession, async (req, res, next) => {
  try {
    const payload = addNoteSchema.parse(req.body);
    const note = await addNote(
      String(req.params.id),
      req.workspaceContext.workspaceId,
      payload,
      prisma
    );
    res.status(201).json({ data: note });
  } catch (error) {
    next(error);
  }
});

router.post("/:id/mark-read", requireSession, async (req, res, next) => {
  try {
    const conversation = await markConversationAsRead(
      String(req.params.id),
      req.workspaceContext.workspaceId,
      prisma
    );
    res.json({ data: conversation });
  } catch (error) {
    next(error);
  }
});

export default router;
