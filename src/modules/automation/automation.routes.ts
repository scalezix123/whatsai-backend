import { Router } from "express";
import { prisma } from "../../prisma";
import { requireSession } from "../../middleware";
import { getCurrentUser } from "../../state";
import {
  getDefinitionsSchema,
  createDefinitionSchema,
  leadContactedSchema,
} from "./automation.schemas";
import {
  getAutomationDefinitions,
  createOrUpdateAutomationDefinition,
  processAutomationFlows,
  processReminders,
  processLeadContacted,
  deleteAutomationDefinition,
} from "./automation.service";
import { processFlowRun as engineProcessFlowRun } from "../../flowEngine";

const router = Router();

router.get("/definitions", requireSession, async (_req, res, next) => {
  try {
    const definitions = await getAutomationDefinitions();
    res.json(definitions);
  } catch (error) {
    next(error);
  }
});

router.post("/definitions", requireSession, async (req, res, next) => {
  try {
    const payload = createDefinitionSchema.parse(req.body);
    const definition = await createOrUpdateAutomationDefinition(payload);
    res.json(definition);
  } catch (error) {
    next(error);
  }
});

router.post("/process-flows", async (req, res, next) => {
  try {
    const cronSecret = req.headers["x-cron-secret"] as string | undefined;
    const result = await processAutomationFlows(cronSecret);
    res.json({ result });
  } catch (error) {
    next(error);
  }
});

router.post("/process-reminders", async (req, res, next) => {
  try {
    const result = await processReminders();
    res.json({ result });
  } catch (error) {
    next(error);
  }
});

router.post("/lead-contacted", async (req, res, next) => {
  try {
    const payload = leadContactedSchema.parse(req.body);
    const result = await processLeadContacted(payload);
    res.json({ result });
  } catch (error) {
    next(error);
  }
});

router.delete("/definitions/:id", requireSession, async (req, res, next) => {
  try {
    await deleteAutomationDefinition(String(req.params.id));
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

router.get("/runs", requireSession, async (req, res, next) => {
  try {
    const user = await getCurrentUser(prisma);
    if (!user) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 20;
    const status = req.query.status as string | undefined;

    const where: Record<string, unknown> = { workspaceId: user.workspaceId };
    if (status) where.status = status;

    const [runs, total] = await Promise.all([
      prisma.automationFlowRun.findMany({
        where,
        include: {
          lead: { select: { id: true, fullName: true, phone: true } },
          definition: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.automationFlowRun.count({ where }),
    ]);

    res.json({ data: { runs, total, page, limit } });
  } catch (error) {
    next(error);
  }
});

router.get("/runs/stats", requireSession, async (req, res, next) => {
  try {
    const user = await getCurrentUser(prisma);
    if (!user) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const [total, active, completed, failed, paused] = await Promise.all([
      prisma.automationFlowRun.count({ where: { workspaceId: user.workspaceId } }),
      prisma.automationFlowRun.count({ where: { workspaceId: user.workspaceId, status: "active" } }),
      prisma.automationFlowRun.count({ where: { workspaceId: user.workspaceId, status: "completed" } }),
      prisma.automationFlowRun.count({ where: { workspaceId: user.workspaceId, status: "failed" } }),
      prisma.automationFlowRun.count({ where: { workspaceId: user.workspaceId, status: "paused" } }),
    ]);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayRuns = await prisma.automationFlowRun.count({
      where: { workspaceId: user.workspaceId, createdAt: { gte: today } },
    });

    res.json({ data: { total, active, completed, failed, paused, todayRuns } });
  } catch (error) {
    next(error);
  }
});

router.get("/analytics", requireSession, async (req, res, next) => {
  try {
    const user = await getCurrentUser(prisma);
    if (!user) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const definitions = await prisma.automationFlowDefinition.findMany({
      where: { workspaceId: user.workspaceId },
      select: { id: true, name: true },
    });

    const analytics = await Promise.all(
      definitions.map(async (def) => {
        const [totalRuns, completed, failed, active] = await Promise.all([
          prisma.automationFlowRun.count({ where: { flowDefinitionId: def.id } }),
          prisma.automationFlowRun.count({ where: { flowDefinitionId: def.id, status: "completed" } }),
          prisma.automationFlowRun.count({ where: { flowDefinitionId: def.id, status: "failed" } }),
          prisma.automationFlowRun.count({ where: { flowDefinitionId: def.id, status: "active" } }),
        ]);

        const lastRun = await prisma.automationFlowRun.findFirst({
          where: { flowDefinitionId: def.id },
          orderBy: { createdAt: "desc" },
          select: { createdAt: true, status: true },
        });

        return {
          flowId: def.id,
          flowName: def.name,
          totalRuns,
          completed,
          failed,
          active,
          completionRate: totalRuns > 0 ? Math.round((completed / totalRuns) * 100) : 0,
          lastRunAt: lastRun?.createdAt ?? null,
          lastRunStatus: lastRun?.status ?? null,
        };
      })
    );

    res.json({ data: analytics });
  } catch (error) {
    next(error);
  }
});

router.post("/test", requireSession, async (req, res, next) => {
  try {
    const user = await getCurrentUser(prisma);
    if (!user) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const { flowDefinitionId, leadId } = req.body as { flowDefinitionId?: string; leadId?: string };
    if (!leadId) {
      res.status(400).json({ message: "leadId is required" });
      return;
    }

    const lead = await prisma.lead.findFirst({
      where: { id: leadId, workspaceId: user.workspaceId },
    });
    if (!lead) {
      res.status(404).json({ message: "Lead not found" });
      return;
    }

    let definition;
    if (flowDefinitionId) {
      definition = await prisma.automationFlowDefinition.findFirst({
        where: { id: flowDefinitionId, workspaceId: user.workspaceId },
      });
    } else {
      definition = await prisma.automationFlowDefinition.findFirst({
        where: { workspaceId: user.workspaceId, isActive: true },
        orderBy: { createdAt: "desc" },
      });
    }

    if (!definition) {
      res.status(404).json({ message: "No flow definition found" });
      return;
    }

    const nodes = definition.nodes as any[];
    const triggerNode = nodes.find((n: any) => n.type === "trigger" || n.type === "lead_trigger");

    const flowRun = await prisma.automationFlowRun.create({
      data: {
        workspaceId: user.workspaceId,
        leadId: lead.id,
        flowDefinitionId: definition.id,
        currentNodeId: triggerNode?.id ?? null,
        status: "active",
        scheduledAt: new Date(),
      },
    });

    try {
      await engineProcessFlowRun({
        id: flowRun.id,
        workspaceId: user.workspaceId,
        leadId: lead.id,
        flowDefinitionId: definition.id,
        currentNodeId: triggerNode?.id ?? null,
        status: "active",
        retryCount: 0,
        scheduledAt: new Date(),
      });
    } catch (error) {
      console.error(`Test flow run ${flowRun.id} failed:`, error);
    }

    res.json({ data: { flowRunId: flowRun.id, message: "Test flow run created and executed" } });
  } catch (error) {
    next(error);
  }
});

export default router;
