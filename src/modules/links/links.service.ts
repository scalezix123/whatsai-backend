import { PrismaClient } from "@prisma/client";
import type { CreateTrackedLinkInput } from "./links.schemas";

const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || "http://localhost:3001").replace(/\/$/, "");

function randomCode(): string {
  return Math.random().toString(36).slice(2, 9);
}

/** Build the public, click-logging short URL for a code in a workspace. */
export function shortUrlFor(workspaceId: string, code: string): string {
  return `${PUBLIC_BASE_URL}/t/${code}?wid=${workspaceId}`;
}

export async function createTrackedLink(
  workspaceId: string,
  input: CreateTrackedLinkInput,
  db: PrismaClient
) {
  if (input.campaignId) {
    const campaign = await db.campaign.findFirst({
      where: { id: input.campaignId, workspaceId },
      select: { id: true },
    });
    if (!campaign) throw new Error("Campaign not found");
  }

  // Resolve a unique code: honor a custom slug, else generate until free.
  let code = input.code;
  if (code) {
    const clash = await db.trackedLink.findFirst({
      where: { workspaceId, code },
      select: { id: true },
    });
    if (clash) throw new Error(`Link code "${code}" already in use`);
  } else {
    do {
      code = randomCode();
    } while (await db.trackedLink.findFirst({ where: { workspaceId, code }, select: { id: true } }));
  }

  const link = await db.trackedLink.create({
    data: {
      workspaceId,
      code,
      originalUrl: input.originalUrl,
      title: input.title ?? null,
      campaignId: input.campaignId ?? null,
    },
  });
  return { ...link, shortUrl: shortUrlFor(workspaceId, code) };
}

export async function listTrackedLinks(workspaceId: string, db: PrismaClient) {
  const links = await db.trackedLink.findMany({
    where: { workspaceId },
    orderBy: { createdAt: "desc" },
  });
  return {
    total: links.length,
    links: links.map((l) => ({ ...l, shortUrl: shortUrlFor(workspaceId, l.code) })),
  };
}

/**
 * Click analytics for one link: total + unique clicks (by contact, falling back
 * to IP for anonymous), a per-day timeline, and the most recent clicks.
 */
export async function getLinkAnalytics(workspaceId: string, id: string, db: PrismaClient) {
  const link = await db.trackedLink.findFirst({ where: { id, workspaceId } });
  if (!link) throw new Error("Tracked link not found");

  const clicks = await db.linkClick.findMany({
    where: { workspaceId, linkCode: link.code },
    orderBy: { clickedAt: "desc" },
    select: { contactId: true, ipAddress: true, clickedAt: true },
  });

  const uniqueKeys = new Set(clicks.map((c) => c.contactId ?? c.ipAddress ?? "anon"));
  const byDay: Record<string, number> = {};
  for (const c of clicks) {
    const day = c.clickedAt.toISOString().slice(0, 10);
    byDay[day] = (byDay[day] ?? 0) + 1;
  }

  return {
    link: { ...link, shortUrl: shortUrlFor(workspaceId, link.code) },
    totalClicks: clicks.length,
    uniqueClicks: uniqueKeys.size,
    timeline: Object.entries(byDay)
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date)),
    recentClicks: clicks.slice(0, 20),
  };
}

/**
 * Resolve a tracked link to its destination and log the click. Returns the
 * destination URL, or null when no tracked link matches (caller may then fall
 * back to legacy static short links). Click logging never blocks the redirect.
 */
export async function resolveTrackedLink(
  workspaceId: string,
  code: string,
  ctx: { ipAddress?: string; userAgent?: string; contactId?: string },
  db: PrismaClient
): Promise<string | null> {
  const link = await db.trackedLink.findFirst({ where: { workspaceId, code } });
  if (!link) return null;

  db.linkClick
    .create({
      data: {
        workspaceId,
        contactId: ctx.contactId || null,
        linkCode: code,
        originalUrl: link.originalUrl,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    })
    .catch((err) => console.error("[links] failed to log click", err));

  db.trackedLink
    .update({ where: { id: link.id }, data: { clickCount: { increment: 1 } } })
    .catch((err) => console.error("[links] failed to bump clickCount", err));

  return link.originalUrl;
}
