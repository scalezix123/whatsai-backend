import { Router } from "express";
import { prisma } from "../../prisma";
import { requireSession } from "../../middleware";
import {
  createSegmentSchema,
  updateSegmentSchema,
  previewSegmentSchema,
} from "./segments.schemas";
import {
  createSegment,
  listSegments,
  getSegment,
  updateSegment,
  deleteSegment,
  previewSegment,
} from "./segments.service";
import { logAuditEvent } from "../../utils";

const router = Router();

router.get("/", requireSession, async (req, res, next) => {
  try {
    const result = await listSegments(req.workspaceContext.workspaceId, prisma);
    res.json({ data: result });
  } catch (error) {
    next(error);
  }
});

// Preview an ad-hoc filter (live builder) before saving. Body may carry filters;
// omit to require ?id resolution via the /:id/preview route below.
router.post("/preview", requireSession, async (req, res, next) => {
  try {
    const { filters, sampleSize } = previewSegmentSchema.parse(req.body);
    const result = await previewSegment(
      req.workspaceContext.workspaceId,
      { filters, sampleSize },
      prisma
    );
    res.json({ data: result });
  } catch (error) {
    next(error);
  }
});

router.post("/", requireSession, async (req, res, next) => {
  try {
    const payload = createSegmentSchema.parse(req.body);
    const result = await createSegment(req.workspaceContext.workspaceId, payload, prisma);
    await logAuditEvent({
      workspaceId: req.workspaceContext.workspaceId,
      actorId: req.workspaceContext.userId,
      action: "segment.created",
      summary: `Segment "${payload.name}" created`,
      payload: { segmentId: result.id },
    });
    res.status(201).json({ data: result });
  } catch (error) {
    next(error);
  }
});

router.get("/:id", requireSession, async (req, res, next) => {
  try {
    const result = await getSegment(req.workspaceContext.workspaceId, req.params.id, prisma);
    res.json({ data: result });
  } catch (error) {
    next(error);
  }
});

router.post("/:id/preview", requireSession, async (req, res, next) => {
  try {
    const { sampleSize } = previewSegmentSchema.parse(req.body ?? {});
    const result = await previewSegment(
      req.workspaceContext.workspaceId,
      { id: String(req.params.id), sampleSize },
      prisma
    );
    res.json({ data: result });
  } catch (error) {
    next(error);
  }
});

router.patch("/:id", requireSession, async (req, res, next) => {
  try {
    const payload = updateSegmentSchema.parse(req.body);
    const result = await updateSegment(
      req.workspaceContext.workspaceId,
      req.params.id,
      payload,
      prisma
    );
    res.json({ data: result });
  } catch (error) {
    next(error);
  }
});

router.delete("/:id", requireSession, async (req, res, next) => {
  try {
    const result = await deleteSegment(req.workspaceContext.workspaceId, req.params.id, prisma);
    await logAuditEvent({
      workspaceId: req.workspaceContext.workspaceId,
      actorId: req.workspaceContext.userId,
      action: "segment.deleted",
      summary: `Segment ${req.params.id} deleted`,
      payload: { segmentId: req.params.id },
    });
    res.json({ data: result });
  } catch (error) {
    next(error);
  }
});

export default router;
