import { Router } from "express";
import { prisma } from "../../prisma";
import { requireSession } from "../../middleware";

const router = Router();

router.get("/performance", requireSession, async (req, res, next) => {
  try {
    const workspaceId = req.workspaceContext.workspaceId;
    const agents = await prisma.agentProfile.findMany({
      where: { workspaceId },
      include: {
        user: { select: { id: true, name: true, email: true } },
      },
    });

    const performance = await Promise.all(
      agents.map(async (agent) => {
        const conversations = await prisma.conversation.findMany({
          where: { workspaceId, assignedTo: agent.userId },
          select: {
            id: true,
            status: true,
            createdAt: true,
            updatedAt: true,
            lastMessageAt: true,
          },
        });

        const messages = await prisma.conversationMessage.findMany({
          where: {
            workspaceId,
            conversationId: { in: conversations.map((c) => c.id) },
            direction: "outbound",
          },
          select: { sentAt: true, conversationId: true },
        });

        const resolved = conversations.filter((c) => c.status === "resolved");
        const totalResolved = resolved.length;

        let totalResponseTime = 0;
        let responseCount = 0;
        for (const conv of conversations) {
          const inboundMsgs = await prisma.conversationMessage.findMany({
            where: {
              conversationId: conv.id,
              direction: "inbound",
            },
            orderBy: { sentAt: "asc" },
            take: 1,
          });
          const outboundMsgs = messages.filter((m) => m.conversationId === conv.id);
          if (inboundMsgs.length > 0 && outboundMsgs.length > 0) {
            const firstInbound = inboundMsgs[0].sentAt;
            const firstOutbound = outboundMsgs[0].sentAt;
            if (firstOutbound > firstInbound) {
              totalResponseTime += (firstOutbound.getTime() - firstInbound.getTime()) / 1000;
              responseCount++;
            }
          }
        }

        const avgResponseTime = responseCount > 0 ? totalResponseTime / responseCount : null;

        return {
          agentId: agent.id,
          userId: agent.userId,
          name: agent.user.name,
          email: agent.user.email,
          status: agent.status,
          teamId: agent.teamId,
          totalConversations: conversations.length,
          resolvedConversations: totalResolved,
          openConversations: conversations.filter((c) => c.status === "open").length,
          pendingConversations: conversations.filter((c) => c.status === "pending").length,
          totalMessagesSent: messages.length,
          avgResponseTimeSeconds: avgResponseTime ? Math.round(avgResponseTime) : null,
          resolutionRate: conversations.length > 0
            ? Math.round((totalResolved / conversations.length) * 100)
            : 0,
        };
      })
    );

    res.json({ data: performance });
  } catch (error) {
    next(error);
  }
});

router.get("/performance/:userId", requireSession, async (req, res, next) => {
  try {
    const workspaceId = req.workspaceContext.workspaceId;
    const userId = String(req.params.userId);

    const agent = await prisma.agentProfile.findFirst({
      where: { workspaceId, userId },
      include: { user: { select: { id: true, name: true, email: true } }, team: { select: { id: true, name: true } } },
    }) as (Awaited<ReturnType<typeof prisma.agentProfile.findFirst>> & { user: { name: string; email: string } }) | null;

    if (!agent) {
      res.status(404).json({ message: "Agent not found" });
      return;
    }

    const conversations = await prisma.conversation.findMany({
      where: { workspaceId, assignedTo: userId },
      orderBy: { lastMessageAt: "desc" },
      take: 50,
      select: {
        id: true,
        displayName: true,
        phone: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        lastMessageAt: true,
      },
    });

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const dailyStats = await Promise.all(
      Array.from({ length: 30 }, async (_, i) => {
        const date = new Date(thirtyDaysAgo.getTime() + i * 24 * 60 * 60 * 1000);
        const nextDate = new Date(date.getTime() + 24 * 60 * 60 * 1000);
        const count = await prisma.conversationMessage.count({
          where: {
            workspaceId,
            direction: "outbound",
            sentAt: { gte: date, lt: nextDate },
            conversation: { assignedTo: userId },
          },
        });
        return { date: date.toISOString().slice(0, 10), messagesSent: count };
      })
    );

    res.json({
      data: {
        agent: {
          id: agent.id,
          name: agent.user.name,
          email: agent.user.email,
          status: agent.status,
          skills: agent.skills,
          totalResolved: agent.totalResolved,
          avgResponseTime: agent.avgResponseTime,
        },
        conversations,
        dailyStats,
      },
    });
  } catch (error) {
    next(error);
  }
});

export default router;
