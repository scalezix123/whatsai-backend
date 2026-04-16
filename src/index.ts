import "dotenv/config";
import { createHash } from "node:crypto";
import cors from "cors";
import express from "express";
import { 
  CampaignStatus, 
  ConnectionStatus, 
  MessageTemplateCategory, 
  TemplateStatus,
  AppAutomationRuleType,
  AppConversationStatus,
  AppMessageDirection,
  AppLeadStatus,
  AppLeadSource
} from "@prisma/client";
import { z } from "zod";
import { hashPassword, verifyPassword } from "./auth";
import { COST_PER_MESSAGE } from "./sharedTypes";
import { prisma } from "./prisma";
import {
  buildAppState,
  createWorkspaceForUser,
  ensureSession,
  getCurrentUser,
  seedWorkspace,
  setCurrentUser,
} from "./state";
import { startFlowForLead, processFlowRun } from "./flowEngine";
import {
  buildCampaignBodyParameters,
  buildTemplateBodyParameters,
  exchangeMetaCode,
  getMetaWebhookVerifyToken,
  mapTemplateLanguageToMetaCode,
  sendMetaTemplateMessage,
  sendMetaTextMessage,
} from "./meta";
import {
  type SummarizedLeadWebhookEvent,
  type SummarizedMetaWebhookEvent,
  type SummarizedWhatsAppWebhookEvent,
  summarizeMetaWebhookPayload,
} from "./metaWebhook";
import { getWorkspaceContextFromRequestAuthHeader } from "./supabaseAdmin";

const app = express();
const port = Number(process.env.PORT || 3001);
const startupRetryDelaysMs = [1000, 2000, 5000, 10000];

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientDatabaseStartupError(error: unknown) {
  if (!error || typeof error !== "object") return false;

  const code = "code" in error ? String(error.code) : "";
  const message = error instanceof Error ? error.message : String(error);

  return (
    code === "EAI_AGAIN" ||
    code === "P1001" ||
    message.includes("EAI_AGAIN") ||
    message.includes("Can't reach database server") ||
    message.includes("Temporary failure in name resolution")
  );
}

async function ensureSessionWithRetry() {
  let lastError: unknown;

  for (let attempt = 0; attempt <= startupRetryDelaysMs.length; attempt += 1) {
    try {
      return await ensureSession(prisma);
    } catch (error) {
      lastError = error;

      if (!isTransientDatabaseStartupError(error) || attempt === startupRetryDelaysMs.length) {
        throw error;
      }

      const delayMs = startupRetryDelaysMs[attempt];
      console.warn(
        `Database not reachable during startup (attempt ${attempt + 1}/${startupRetryDelaysMs.length + 1}). Retrying in ${delayMs}ms...`,
      );
      await sleep(delayMs);
    }
  }

  throw lastError;
}

app.use(cors({
  origin: true,
  credentials: true,
}));
app.use(express.json());

const signInSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const signUpSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters long."),
});

const connectWhatsAppSchema = z.object({
  businessPortfolio: z.string().min(1),
  wabaName: z.string().min(1),
  phoneNumber: z.string().min(1),
  businessName: z.string().min(1),
});

const walletSchema = z.object({
  amount: z.number().positive(),
  source: z.string().optional(),
});

const contactSchema = z.object({
  name: z.string().min(1),
  phone: z.string().min(1),
  tags: z.array(z.string()).default([]),
});

const campaignSchema = z.object({
  name: z.string().min(1),
  templateId: z.string().min(1),
  contactIds: z.array(z.string()).min(1),
  sendNow: z.boolean(),
});

const metaExchangeSchema = z.object({
  code: z.string().min(1),
  redirectUri: z.string().url(),
});

const metaSendTemplateSchema = z.object({
  to: z.string().min(1),
  templateName: z.string().min(1),
  languageCode: z.string().min(1),
  bodyParameters: z.array(z.string()).optional(),
});

const metaSendCampaignSchema = z.object({
  templateId: z.string().min(1),
  contactIds: z.array(z.string()).min(1),
  bodyParameters: z.array(z.string()).optional(),
});

const metaReplySchema = z.object({
  conversationId: z.string().uuid(),
  to: z.string().min(1),
  body: z.string().min(1).max(4096),
});

const metaLeadSourceMappingSchema = z.object({
  label: z.string().default(""),
  pageId: z.string().optional().default(""),
  adId: z.string().optional().default(""),
  formId: z.string().optional().default(""),
});

const automationLeadContactedSchema = z.object({
  leadId: z.string().uuid(),
});

const retryFailedSendSchema = z.object({
  failedSendLogId: z.string().uuid(),
});

function actionResponse(data: unknown, result: { ok: boolean; message: string }) {
  return { data, result };
}

function leadSourceToDb(source: string) {
  if (source === "Meta Ads") {
    return "meta_ads";
  }

  if (source === "Campaign") {
    return "campaign";
  }

  if (source === "Manual") {
    return "manual";
  }

  if (source === "Organic") {
    return "organic";
  }

  return "whatsapp_inbound";
}

function buildLeadAttributionLabel(input: {
  label?: string | null;
  adId?: string | null;
  formId?: string | null;
  pageId?: string | null;
}) {
  const parts = [
    input.label?.trim(),
    input.pageId ? `Page ${input.pageId}` : null,
    input.adId ? `Ad ${input.adId}` : null,
    input.formId ? `Form ${input.formId}` : null,
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(" • ") : "Meta Lead Ad";
}

function buildLeadAttributionNotes(input: {
  adId?: string | null;
  formId?: string | null;
  pageId?: string | null;
}) {
  const details = [
    "Lead captured automatically from Meta Lead Ads webhook.",
    input.pageId ? `Page ID: ${input.pageId}` : null,
    input.adId ? `Ad ID: ${input.adId}` : null,
    input.formId ? `Form ID: ${input.formId}` : null,
  ].filter(Boolean);

  return details.join("\n");
}

type AutomationRuleRecord = {
  id: string;
  rule_type: "auto_reply_first_inbound" | "auto_assign_new_lead" | "no_reply_reminder" | "follow_up_after_contacted";
  enabled: boolean;
  config: Record<string, unknown> | null;
};

async function getEnabledAutomationRule(
  workspaceId: string,
  ruleType: AppAutomationRuleType,
) {
  const rule = await prisma.automationRule.findUnique({
    where: {
      workspaceId_ruleType: {
        workspaceId,
        ruleType,
      },
    },
  });

  if (!rule || !rule.enabled) return null;
  return rule;
}

async function logAutomationEvent(
  input: {
    workspaceId: string;
    ruleType: AppAutomationRuleType;
    conversationId?: string | null;
    leadId?: string | null;
    status: "triggered" | "skipped" | "failed";
    summary: string;
    payload?: Record<string, unknown>;
  },
) {
  await prisma.automationEvent.create({
    data: {
      workspaceId: input.workspaceId,
      ruleType: input.ruleType,
      conversationId: input.conversationId ?? null,
      leadId: input.leadId ?? null,
      status: input.status,
      summary: input.summary,
      payload: (input.payload as any) ?? {},
    },
  });
}

function resolveAutomationMessage(template: string, input: { contactName: string; contactPhone: string }) {
  return template
    .replaceAll("{{contact.name}}", input.contactName)
    .replaceAll("{{contact.phone}}", input.contactPhone);
}

async function getActiveMetaAuthorization(
  workspaceId: string,
) {
  const authorization = await prisma.metaAuthorization.findUnique({
    where: { workspaceId },
  });

  if (!authorization?.accessToken) {
    throw new Error("No stored Meta authorization found for this workspace. Reconnect WhatsApp to continue.");
  }

  if (authorization.expiresAt && new Date(authorization.expiresAt).getTime() <= Date.now()) {
    throw new Error("Meta authorization has expired for this workspace. Reconnect WhatsApp before sending again.");
  }

  return authorization;
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message;
  }

  return "Unknown server error";
}

async function logOperationalEvent(
  input: {
    workspaceId: string;
    eventType: string;
    level: "info" | "warning" | "error";
    summary: string;
    payload?: Record<string, unknown>;
  },
) {
  await prisma.operationalLog.create({
    data: {
      workspaceId: input.workspaceId,
      eventType: input.eventType,
      level: input.level,
      summary: input.summary,
      payload: (input.payload as any) ?? {},
    },
  });
}

async function logFailedSend(
  input: {
    workspaceId: string;
    channel: "campaign" | "reply" | "automation" | "template";
    targetType: "contact" | "conversation" | "lead" | "workspace";
    targetId?: string | null;
    destination: string;
    templateName?: string | null;
    messageBody?: string | null;
    errorMessage: string;
    payload?: Record<string, unknown>;
  },
) {
  await Promise.all([
    prisma.failedSendLog.create({
      data: {
        workspaceId: input.workspaceId,
        channel: input.channel,
        targetType: input.targetType,
        targetId: input.targetId ?? null,
        destination: input.destination,
        templateName: input.templateName ?? null,
        messageBody: input.messageBody ?? null,
        errorMessage: input.errorMessage,
        payload: (input.payload as any) ?? {},
      },
    }),
    logOperationalEvent({
      workspaceId: input.workspaceId,
      eventType: `${input.channel}_send_failed`,
      level: "error",
      summary: `${input.channel} send failed for ${input.destination}.`,
      payload: {
        targetType: input.targetType,
        targetId: input.targetId ?? null,
        templateName: input.templateName ?? null,
        errorMessage: input.errorMessage,
        ...input.payload,
      },
    }),
  ]);
}

function fingerprintWebhookEvent(event: SummarizedMetaWebhookEvent) {
  return createHash("sha256").update(JSON.stringify(event)).digest("hex");
}

async function claimWebhookEvent(
  event: SummarizedMetaWebhookEvent,
) {
  try {
    await prisma.processedWebhookEvent.create({
      data: {
        fingerprint: fingerprintWebhookEvent(event),
        eventType: event.field,
        workspaceId: null,
      },
    });
    return true;
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && error.code === "P2002") {
      return false;
    }
    throw error;
  }
}

async function sendWorkspaceAutomationMessage(
  input: {
    workspaceId: string;
    to: string;
    body: string;
  },
) {
  const [authorization, connection] = await Promise.all([
    getActiveMetaAuthorization(input.workspaceId),
    prisma.whatsAppConnection.findFirst({
      where: { workspaceId: input.workspaceId },
      select: { phone_number_id: true },
    }),
  ]);

  if (!connection?.phone_number_id) {
    throw new Error("Meta authorization or connected phone number is missing for this workspace.");
  }

  return sendMetaTextMessage({
    accessToken: authorization.accessToken,
    phoneNumberId: connection.phone_number_id,
    to: input.to,
    body: input.body,
  });
}

async function persistWhatsAppWebhookEvent(event: SummarizedWhatsAppWebhookEvent) {
  if (!event.phoneNumberId) {
    return;
  }

  const connection = await prisma.whatsAppConnection.findUnique({
    where: { phone_number_id: event.phoneNumberId },
    select: { workspaceId: true },
  });

  const workspaceId = connection?.workspaceId ?? null;
  if (!workspaceId) {
    await prisma.metaWebhookEvent.create({
      data: {
        workspaceId: null,
        eventType: event.field,
        payload: event as any,
      },
    });
    return;
  }

  await prisma.metaWebhookEvent.create({
    data: {
      workspaceId: workspaceId,
      eventType: event.field,
      payload: event as any,
    },
  });

  await logOperationalEvent({
    workspaceId,
    eventType: "meta_webhook_received",
    level: "info",
    summary: `Webhook received with ${event.inboundMessages.length} inbound message(s) and ${event.messageStatuses.length} status update(s).`,
    payload: {
      phoneNumberId: event.phoneNumberId,
      field: event.field,
    },
  });

  for (const inboundMessage of event.inboundMessages) {
    if (!inboundMessage.from) {
      continue;
    }

    const contact = await prisma.contact.findFirst({
      where: {
        workspaceId: workspaceId,
        phone: inboundMessage.from,
      },
      select: { id: true, name: true },
    });

    const displayName = contact?.name ?? inboundMessage.from;

    const existingConversation = await prisma.conversation.findFirst({
      where: {
        workspaceId: workspaceId,
        phone: inboundMessage.from,
      },
      select: { id: true, unreadCount: true },
    });

    const lastMessageAt = inboundMessage.timestamp 
      ? new Date(Number(inboundMessage.timestamp) * 1000) 
      : new Date();

    const conversationData = {
      workspaceId: workspaceId,
      contactId: contact?.id ?? null,
      phone: inboundMessage.from,
      displayName: displayName,
      status: AppConversationStatus.open,
      source: AppLeadSource.whatsapp_inbound,
      lastMessagePreview: inboundMessage.body ?? "",
      lastMessageAt: lastMessageAt,
      unreadCount: (existingConversation?.unreadCount ?? 0) + 1,
    };

    const conversation = await prisma.conversation.upsert({
      where: { id: existingConversation?.id ?? "new-id" },
      update: conversationData,
      create: conversationData,
    });

    await prisma.conversationMessage.create({
      data: {
        workspaceId: workspaceId,
        conversationId: conversation.id,
        metaMessageId: inboundMessage.id,
        direction: AppMessageDirection.inbound,
        messageType: inboundMessage.type ?? "text",
        body: inboundMessage.body ?? "",
        status: "received",
        payload: inboundMessage as any,
        sentAt: lastMessageAt,
      },
    });

    try {
      if (contact?.id) {
        await prisma.contactTag.upsert({
          where: {
            contactId_tag: {
              contactId: contact.id,
              tag: "Joined",
            },
          },
          update: { workspaceId },
          create: {
            workspaceId,
            contactId: contact.id,
            tag: "Joined",
          },
        });

        // If it was a button click, log it as an automation interactive step
        if (inboundMessage.interactiveId) {
          await logAutomationEvent({
            workspaceId,
            ruleType: AppAutomationRuleType.auto_reply_first_inbound,
            conversationId: conversation.id,
            status: "triggered",
            summary: `User clicked interactive button: ${inboundMessage.interactiveTitle} (${inboundMessage.interactiveId})`,
            payload: {
              interactiveId: inboundMessage.interactiveId,
              interactiveTitle: inboundMessage.interactiveTitle,
            },
          });
        }
      }
    } catch (tagError) {
      console.error("Failed to apply 'Joined' tag or log interactive response", tagError);
    }

    const existingLead = await prisma.lead.findFirst({
      where: {
        workspaceId: workspaceId,
        phone: inboundMessage.from,
      },
      select: { id: true },
    });

    if (!existingLead) {
      let assignedTo: string | null = null;
      const assignRule = await getEnabledAutomationRule(workspaceId, AppAutomationRuleType.auto_assign_new_lead);
      if (assignRule?.config && typeof assignRule.config === "object") {
        const configuredOwner = "ownerName" in (assignRule.config as any) && typeof (assignRule.config as any).ownerName === "string"
          ? (assignRule.config as any).ownerName.trim()
          : "";
        assignedTo = configuredOwner || null;
      }

      const createdLead = await prisma.lead.create({
        data: {
          workspaceId: workspaceId,
          contactId: contact?.id ?? null,
          conversationId: conversation.id,
          fullName: displayName,
          phone: inboundMessage.from,
          status: AppLeadStatus.new,
          source: AppLeadSource.whatsapp_inbound,
          sourceLabel: "Inbound WhatsApp conversation",
          assignedTo: assignedTo,
          notes: "Lead created automatically from inbound WhatsApp webhook.",
        },
        select: { id: true },
      });

      if (assignedTo && createdLead?.id) {
        await logAutomationEvent({
          workspaceId,
          ruleType: AppAutomationRuleType.auto_assign_new_lead,
          conversationId: conversation.id,
          leadId: createdLead.id,
          status: "triggered",
          summary: `New inbound lead assigned to ${assignedTo}.`,
        });
      }
    }

    if (!existingConversation?.id) {
      const autoReplyRule = await getEnabledAutomationRule(workspaceId, AppAutomationRuleType.auto_reply_first_inbound);
      const autoReplyTemplate = autoReplyRule?.config && typeof autoReplyRule.config === "object" && "message" in (autoReplyRule.config as any) && typeof (autoReplyRule.config as any).message === "string"
        ? (autoReplyRule.config as any).message.trim()
        : "";

      if (autoReplyTemplate) {
        try {
          const body = resolveAutomationMessage(autoReplyTemplate, {
            contactName: displayName,
            contactPhone: inboundMessage.from,
          });
          const response = await sendWorkspaceAutomationMessage({
            workspaceId,
            to: inboundMessage.from,
            body,
          });
          const sentAt = new Date();
          const messageId = Array.isArray((response as { messages?: Array<{ id?: string }> }).messages)
            ? (response as { messages?: Array<{ id?: string }> }).messages?.[0]?.id ?? null
            : null;

          await Promise.all([
            prisma.conversationMessage.create({
              data: {
                workspaceId: workspaceId,
                conversationId: conversation.id,
                metaMessageId: messageId,
                direction: AppMessageDirection.outbound,
                messageType: "text",
                body,
                status: "sent",
                payload: response as any,
                sentAt: sentAt,
              },
            }),
            prisma.conversation.update({
              where: { id: conversation.id },
              data: {
                lastMessagePreview: body,
                lastMessageAt: sentAt,
              },
            }),
          ]);

          await logAutomationEvent({
            workspaceId,
            ruleType: AppAutomationRuleType.auto_reply_first_inbound,
            conversationId: conversation.id,
            status: "triggered",
            summary: `First inbound auto-reply sent to ${displayName}.`,
          });
        } catch (error) {
          await logFailedSend({
            workspaceId,
            channel: "automation",
            targetType: "conversation",
            targetId: conversation.id,
            destination: inboundMessage.from,
            messageBody: autoReplyTemplate,
            errorMessage: getErrorMessage(error),
            payload: {
              automationRule: "auto_reply_first_inbound",
              conversationId: conversation.id,
            },
          });
          await logAutomationEvent({
            workspaceId,
            ruleType: AppAutomationRuleType.auto_reply_first_inbound,
            conversationId: conversation.id,
            status: "failed",
            summary: `First inbound auto-reply failed for ${displayName}.`,
            payload: {
              message: error instanceof Error ? error.message : "Unknown automation error",
            },
          });
        }
      }
    }
  }

  for (const messageStatus of event.messageStatuses) {
    if (!messageStatus.id) {
      continue;
    }

    await prisma.conversationMessage.updateMany({
      where: {
        workspaceId,
        metaMessageId: messageStatus.id,
      },
      data: {
        status: messageStatus.status ?? "sent",
      },
    });
  }
}

async function persistLeadgenWebhookEvent(event: SummarizedLeadWebhookEvent) {
  const fullName = event.fieldData.find((field) => field.name?.toLowerCase().includes("name"))?.values?.[0] ?? "Meta Lead";
  const phone = event.fieldData.find((field) => field.name?.toLowerCase().includes("phone"))?.values?.[0] ?? "";
  const email = event.fieldData.find((field) => field.name?.toLowerCase().includes("email"))?.values?.[0] ?? "";

  if (!phone) {
    return;
  }

  const mappedSource = await prisma.metaLeadSourceMapping.findMany({
    where: {
      OR: [
        event.adId ? { adId: event.adId } : undefined,
        event.pageId ? { pageId: event.pageId } : undefined,
      ].filter(Boolean) as any,
    },
    take: 5,
  });

  const prioritizedMapping = (mappedSource ?? []).sort((left, right) => {
    const leftScore = (left.adId ? 4 : 0) + (left.formId ? 2 : 0) + (left.pageId ? 1 : 0);
    const rightScore = (right.adId ? 4 : 0) + (right.formId ? 2 : 0) + (right.pageId ? 1 : 0);
    return rightScore - leftScore;
  })[0];

  const workspaceId = prioritizedMapping?.workspaceId ?? null;
  await prisma.metaWebhookEvent.create({
    data: {
      workspaceId: workspaceId,
      eventType: event.field,
      payload: event as any,
    },
  });

  if (!workspaceId) {
    return;
  }

  await logOperationalEvent({
    workspaceId,
    eventType: "meta_lead_captured",
    level: "info",
    summary: `Lead captured from Meta Ads for ${fullName}.`,
    payload: {
      pageId: event.pageId,
      adId: event.adId,
      phone,
    },
  });

  const contact = await prisma.contact.upsert({
    where: {
      workspaceId_phone: {
        workspaceId: workspaceId,
        phone,
      },
    },
    update: { name: fullName },
    create: {
      workspaceId: workspaceId,
      name: fullName,
      phone,
    },
    select: { id: true },
  });

  const conversation = await prisma.conversation.create({
    data: {
      workspaceId: workspaceId,
      contactId: contact?.id ?? null,
      phone,
      displayName: fullName,
      status: AppConversationStatus.open,
      source: AppLeadSource.meta_ads,
      lastMessagePreview: "Lead captured from Meta ad form",
      lastMessageAt: event.createdTime ? new Date(event.createdTime * 1000) : new Date(),
      unreadCount: 0,
    },
    select: { id: true },
  });

  const assignRule = await getEnabledAutomationRule(workspaceId, AppAutomationRuleType.auto_assign_new_lead);
  const configuredOwner = assignRule?.config && typeof assignRule.config === "object" && "ownerName" in (assignRule.config as any) && typeof (assignRule.config as any).ownerName === "string"
    ? (assignRule.config as any).ownerName.trim()
    : "";

  const leadRecord = await prisma.lead.upsert({
    where: { metaLeadId: event.leadgenId ?? "new-meta-lead-id" },
    update: {
      workspaceId: workspaceId,
      contactId: contact?.id ?? null,
      conversationId: conversation?.id ?? null,
      fullName: fullName,
      phone,
      email,
      status: AppLeadStatus.new,
      source: AppLeadSource.meta_ads,
      sourceLabel: buildLeadAttributionLabel({
        label: prioritizedMapping?.label,
        pageId: event.pageId,
        adId: event.adId,
      }),
      assignedTo: configuredOwner || null,
      notes: buildLeadAttributionNotes({
        pageId: event.pageId,
        adId: event.adId,
      }),
    },
    create: {
      workspaceId: workspaceId,
      contactId: contact?.id ?? null,
      conversationId: conversation?.id ?? null,
      metaLeadId: event.leadgenId,
      fullName: fullName,
      phone,
      email,
      status: AppLeadStatus.new,
      source: AppLeadSource.meta_ads,
      sourceLabel: buildLeadAttributionLabel({
        label: prioritizedMapping?.label,
        pageId: event.pageId,
        adId: event.adId,
      }),
      assignedTo: configuredOwner || null,
      notes: buildLeadAttributionNotes({
        pageId: event.pageId,
        adId: event.adId,
      }),
    },
    select: { id: true },
  });

  if (leadRecord?.id) {
    if (configuredOwner) {
      await logAutomationEvent({
        workspaceId,
        ruleType: AppAutomationRuleType.auto_assign_new_lead,
        conversationId: conversation?.id ?? null,
        leadId: leadRecord.id,
        status: "triggered",
        summary: `Meta ad lead assigned to ${configuredOwner}.`,
      });
    }

    try {
      // In Neon version, we pass the Prisma client or use internally
      await startFlowForLead(workspaceId, leadRecord.id);
    } catch (flowError) {
      console.error("Failed to start Phase 1 flow for lead", flowError);
    }
  }
}

async function requireUser() {
  const user = await getCurrentUser(prisma);
  if (!user) {
    throw new Error("No active session. Sign in first.");
  }

  return user;
}

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/t/:code", async (req, res) => {
  try {
    const { code } = req.params;

    // Use a hardcoded or dynamic mapping for Phase 2
    // In a real app, we'd lookup in a 'links' table
    // For now, let's support a few predefined codes for the demo
    const links: Record<string, string> = {
      "join-group": "https://chat.whatsapp.com/example-group-id",
    };

    const targetUrl = links[code];
    if (!targetUrl) {
      res.status(404).send("Link not found.");
      return;
    }

    // Log the click asynchronously
    // Ideally we'd have the contact_id from a query param if coming from a message
    const contactId = typeof req.query.cid === "string" ? req.query.cid : null;
    const workspaceId = typeof req.query.wid === "string" ? req.query.wid : null;

    if (workspaceId) {
      prisma.linkClick.create({
        data: {
          workspaceId: workspaceId,
          contactId: contactId,
          linkCode: code,
          originalUrl: targetUrl,
          ipAddress: req.ip,
          userAgent: req.get("User-Agent"),
        },
      }).catch((err) => console.error("Failed to log link click", err));
    }

    res.redirect(targetUrl);
  } catch (error) {
    console.error("Link redirect failed", error);
    res.status(500).send("Internal server error.");
  }
});

app.get("/meta/webhook", (req, res) => {
  const verifyToken = getMetaWebhookVerifyToken();
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && verifyToken && token === verifyToken && typeof challenge === "string") {
    res.status(200).send(challenge);
    return;
  }

  res.status(403).send("Webhook verification failed.");
});

app.post("/meta/webhook", (req, res) => {
  const summary = summarizeMetaWebhookPayload(req.body);
  console.log("Meta webhook payload received", JSON.stringify(summary));

  void (async () => {
    try {
      for (const event of summary) {
        const isNewEvent = await claimWebhookEvent(event);
        if (!isNewEvent) {
          continue;
        }

        if (event.kind === "whatsapp") {
          await persistWhatsAppWebhookEvent(event);
          continue;
        }

        await persistLeadgenWebhookEvent(event);
      }
    } catch (error) {
      console.error("Failed to persist Meta webhook event", error);
    }
  })();

  res.status(200).json({ received: true });
});

app.post("/meta/exchange-code", async (req, res, next) => {
  try {
    const payload = metaExchangeSchema.parse(req.body);
    const data = await exchangeMetaCode(payload);

    try {
      const workspaceContext = await getWorkspaceContextFromRequestAuthHeader(req.headers.authorization);
      if (workspaceContext) {
        await prisma.metaAuthorization.upsert({
          where: { workspaceId: workspaceContext.workspaceId },
          update: {
            accessToken: data.authorization.accessToken,
            tokenType: data.authorization.tokenType,
            expiresAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
          },
          create: {
            workspaceId: workspaceContext.workspaceId,
            accessToken: data.authorization.accessToken,
            tokenType: data.authorization.tokenType,
            expiresAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
          },
        });

        const existingConnection = await prisma.whatsAppConnection.findFirst({
          where: { workspaceId: workspaceContext.workspaceId },
          select: { id: true },
        });

        const connectionData = {
          metaBusinessId: data.candidate.metaBusinessId,
          metaBusinessPortfolioId: data.candidate.metaBusinessPortfolioId,
          wabaId: data.candidate.wabaId,
          phone_number_id: data.candidate.phoneNumberId,
          display_phone_number: data.candidate.displayPhoneNumber,
          verified_name: data.candidate.verifiedName,
          business_portfolio: data.candidate.businessPortfolio,
          business_name: data.candidate.businessName,
          status: ConnectionStatus.connected,
          business_verification_status: data.candidate.businessVerificationStatus,
          account_review_status: data.candidate.accountReviewStatus,
          oba_status: data.candidate.obaStatus,
        };

        if (existingConnection) {
          await prisma.whatsAppConnection.update({
            where: { id: existingConnection.id },
            data: connectionData,
          });
        } else {
          await prisma.whatsAppConnection.create({
            data: {
              workspaceId: workspaceContext.workspaceId,
              ...connectionData,
            },
          });
        }
      }
    } catch (persistenceError) {
      console.error("Failed to persist Meta authorization", persistenceError);
    }

    res.json({ data });
  } catch (error) {
    next(error);
  }
});

app.get("/meta/source-mappings", async (req, res, next) => {
  try {
    const workspaceContext = await getWorkspaceContextFromRequestAuthHeader(req.headers.authorization);
    if (!workspaceContext) {
      throw new Error("An active app session is required to load Meta source mappings.");
    }

    const data = await prisma.metaLeadSourceMapping.findMany({
      where: { workspaceId: workspaceContext.workspaceId },
      orderBy: { createdAt: "desc" },
    });

    res.json({ data });
  } catch (error) {
    next(error);
  }
});

app.post("/meta/source-mappings", async (req, res, next) => {
  try {
    const workspaceContext = await getWorkspaceContextFromRequestAuthHeader(req.headers.authorization);
    if (!workspaceContext) {
      throw new Error("An active app session is required to save Meta source mappings.");
    }

    const payload = metaLeadSourceMappingSchema.parse(req.body);
    if (!payload.pageId && !payload.adId && !payload.formId) {
      throw new Error("Provide at least one Meta identifier: page ID, ad ID, or form ID.");
    }

    const data = await prisma.metaLeadSourceMapping.create({
      data: {
        workspaceId: workspaceContext.workspaceId,
        label: payload.label,
        pageId: payload.pageId || null,
        adId: payload.adId || null,
        formId: payload.formId || null,
      },
    });

    res.json({ data });
  } catch (error) {
    next(error);
  }
});

app.post("/meta/send-template", async (req, res, next) => {
  let workspaceId: string | null = null;
  let payload: z.infer<typeof metaSendTemplateSchema> | null = null;
  try {
    payload = metaSendTemplateSchema.parse(req.body);
    const workspaceContext = await getWorkspaceContextFromRequestAuthHeader(req.headers.authorization);
    if (!workspaceContext) {
      throw new Error("An active app session is required to send WhatsApp templates.");
    }
    workspaceId = workspaceContext.workspaceId;

    const [authorization, connection] = await Promise.all([
      getActiveMetaAuthorization(workspaceContext.workspaceId),
      prisma.whatsAppConnection.findFirst({
        where: { workspaceId: workspaceContext.workspaceId },
        select: { phone_number_id: true },
      }),
    ]);

    if (!connection?.phone_number_id) {
      throw new Error("No connected Meta phone number was found for this workspace.");
    }

    const data = await sendMetaTemplateMessage({
      accessToken: authorization.accessToken,
      phoneNumberId: connection.phone_number_id,
      to: payload.to,
      templateName: payload.templateName,
      languageCode: payload.languageCode,
      bodyParameters: payload.bodyParameters,
    });

    await logOperationalEvent({
      workspaceId: workspaceContext.workspaceId,
      eventType: "template_sent",
      level: "info",
      summary: `Template ${payload.templateName} sent to ${payload.to}.`,
      payload: {
        destination: payload.to,
        templateName: payload.templateName,
      },
    });

    res.json({ data });
  } catch (error) {
    if (workspaceId && payload) {
      try {
        await logFailedSend({
          workspaceId,
          channel: "template",
          targetType: "workspace",
          destination: payload.to,
          templateName: payload.templateName,
          errorMessage: getErrorMessage(error),
          payload: {
            languageCode: payload.languageCode,
            bodyParameters: payload.bodyParameters ?? [],
          },
        });
      } catch (loggingError) {
        console.error("Failed to log template send failure", loggingError);
      }
    }
    next(error);
  }
});

app.post("/meta/send-campaign", async (req, res, next) => {
  try {
    const payload = metaSendCampaignSchema.parse(req.body);
    const workspaceContext = await getWorkspaceContextFromRequestAuthHeader(req.headers.authorization);
    if (!workspaceContext) {
      throw new Error("An active app session is required to send WhatsApp campaigns.");
    }

    const [authorization, connection, template, contacts] = await Promise.all([
      getActiveMetaAuthorization(workspaceContext.workspaceId),
      prisma.whatsAppConnection.findFirst({
        where: { workspaceId: workspaceContext.workspaceId },
        select: { phone_number_id: true },
      }),
      prisma.messageTemplate.findUnique({
        where: { id: payload.templateId },
        select: { id: true, name: true, language: true, body: true, workspaceId: true },
      }),
      prisma.contact.findMany({
        where: {
          workspaceId: workspaceContext.workspaceId,
          id: { in: payload.contactIds },
        },
        select: { id: true, name: true, phone: true },
      }),
    ]);

    if (!connection?.phone_number_id) {
      throw new Error("No connected Meta phone number was found for this workspace.");
    }

    if (!template || template.workspaceId !== workspaceContext.workspaceId) {
      throw new Error("Template not found for this workspace.");
    }

    if (!contacts || contacts.length !== payload.contactIds.length) {
      throw new Error("One or more contacts could not be found for this workspace.");
    }

    const results = [];
    const failures: Array<{ contactId: string; phone: string; errorMessage: string }> = [];
    for (const contact of contacts) {
      const bodyParameters = buildCampaignBodyParameters({
        templateBody: template.body,
        contactName: contact.name,
        contactPhone: contact.phone,
        bodyParameters: payload.bodyParameters,
      });

      try {
        const data = await sendMetaTemplateMessage({
          accessToken: authorization.accessToken,
          phoneNumberId: connection.phone_number_id,
          to: contact.phone,
          templateName: template.name,
          languageCode: mapTemplateLanguageToMetaCode(template.language),
          bodyParameters,
        });

        results.push({
          contactId: contact.id,
          phone: contact.phone,
          data,
        });
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        failures.push({
          contactId: contact.id,
          phone: contact.phone,
          errorMessage,
        });
        await logFailedSend({
          workspaceId: workspaceContext.workspaceId,
          channel: "campaign",
          targetType: "contact",
          targetId: contact.id,
          destination: contact.phone,
          templateName: template.name,
          messageBody: template.body,
          errorMessage,
          payload: {
            templateId: template.id,
            campaignContactId: contact.id,
            languageCode: mapTemplateLanguageToMetaCode(template.language),
            bodyParameters,
          },
        });
      }
    }

    await logOperationalEvent({
      workspaceId: workspaceContext.workspaceId,
      eventType: "campaign_send_completed",
      level: failures.length > 0 ? "warning" : "info",
      summary: `Campaign send completed with ${results.length} success(es) and ${failures.length} failure(s).`,
      payload: {
        templateId: payload.templateId,
        sentCount: results.length,
        failedCount: failures.length,
      },
    });

    if (results.length === 0 && failures.length > 0) {
      res.status(502).json({
        message: `Campaign send failed for all selected contacts. ${failures[0]?.errorMessage ?? ""}`.trim(),
        data: {
          sentCount: 0,
          failedCount: failures.length,
          failures,
        },
      });
      return;
    }

    res.json({
      data: {
        sentCount: results.length,
        failedCount: failures.length,
        results,
        failures,
      },
    });
  } catch (error) {
    next(error);
  }
});

app.post("/meta/send-reply", async (req, res, next) => {
  let workspaceId: string | null = null;
  let payload: z.infer<typeof metaReplySchema> | null = null;
  try {
    payload = metaReplySchema.parse(req.body);
    const workspaceContext = await getWorkspaceContextFromRequestAuthHeader(req.headers.authorization);
    if (!workspaceContext) {
      throw new Error("An active app session is required to send WhatsApp replies.");
    }
    workspaceId = workspaceContext.workspaceId;

    const [authorization, connection, conversation] = await Promise.all([
      getActiveMetaAuthorization(workspaceContext.workspaceId),
      prisma.whatsAppConnection.findFirst({
        where: { workspaceId: workspaceContext.workspaceId },
        select: { phone_number_id: true },
      }),
      prisma.conversation.findUnique({
        where: {
          id: payload.conversationId,
        },
        select: { id: true, workspaceId: true },
      }),
    ]);

    if (!connection?.phone_number_id) {
      throw new Error("No connected Meta phone number was found for this workspace.");
    }

    if (!conversation || conversation.workspaceId !== workspaceContext.workspaceId) {
      throw new Error("Conversation not found for this workspace.");
    }

    const data = await sendMetaTextMessage({
      accessToken: authorization.accessToken,
      phoneNumberId: connection.phone_number_id,
      to: payload.to,
      body: payload.body,
    });

    const messageId = Array.isArray((data as { messages?: Array<{ id?: string }> }).messages)
      ? (data as { messages?: Array<{ id?: string }> }).messages?.[0]?.id ?? null
      : null;
    const sentAt = new Date();

    await prisma.$transaction([
      prisma.conversation.update({
        where: { id: payload.conversationId },
        data: {
          lastMessagePreview: payload.body,
          lastMessageAt: sentAt,
          status: AppConversationStatus.open,
        },
      }),
      prisma.conversationMessage.create({
        data: {
          workspaceId: workspaceContext.workspaceId,
          conversationId: payload.conversationId,
          metaMessageId: messageId,
          direction: AppMessageDirection.outbound,
          messageType: "text",
          body: payload.body,
          status: "sent",
          payload: data as any,
          sentAt: sentAt,
        },
      }),
    ]);

    await logOperationalEvent({
      workspaceId: workspaceContext.workspaceId,
      eventType: "reply_sent",
      level: "info",
      summary: `Inbox reply sent to ${payload.to}.`,
      payload: {
        conversationId: payload.conversationId,
        destination: payload.to,
      },
    });

    res.json({
      data: {
        messageId,
        sentAt,
        providerResponse: data,
      },
    });
  } catch (error) {
    if (workspaceId && payload) {
      try {
        await logFailedSend({
          workspaceId,
          channel: "reply",
          targetType: "conversation",
          targetId: payload.conversationId,
          destination: payload.to,
          messageBody: payload.body,
          errorMessage: getErrorMessage(error),
          payload: {
            conversationId: payload.conversationId,
          },
        });
      } catch (loggingError) {
        console.error("Failed to log reply send failure", loggingError);
      }
    }
    next(error);
  }
});

app.post("/automation/process-reminders", async (req, res, next) => {
  try {
    const workspaceContext = await getWorkspaceContextFromRequestAuthHeader(req.headers.authorization);
    if (!workspaceContext) {
      throw new Error("An active app session is required to process automation reminders.");
    }

    const reminderRule = await getEnabledAutomationRule(workspaceContext.workspaceId, AppAutomationRuleType.no_reply_reminder);
    if (!reminderRule) {
      res.json({ result: { ok: true, message: "No reminder automation is enabled for this workspace." } });
      return;
    }

    const reminderHours = reminderRule.config && typeof reminderRule.config === "object" && "reminderHours" in (reminderRule.config as any)
      ? Number((reminderRule.config as any).reminderHours)
      : 4;
    const configuredOwner = reminderRule.config && typeof reminderRule.config === "object" && "ownerName" in (reminderRule.config as any) && typeof (reminderRule.config as any).ownerName === "string"
      ? (reminderRule.config as any).ownerName.trim()
      : "";

    const [conversations, messages, priorEvents] = await Promise.all([
      prisma.conversation.findMany({
        where: {
          workspaceId: workspaceContext.workspaceId,
          status: { in: [AppConversationStatus.open, AppConversationStatus.pending] },
        },
        select: { id: true, displayName: true, status: true, assignedTo: true },
      }),
      prisma.conversationMessage.findMany({
        where: { workspaceId: workspaceContext.workspaceId },
        select: { conversationId: true, direction: true, sentAt: true },
      }),
      prisma.automationEvent.findMany({
        where: {
          workspaceId: workspaceContext.workspaceId,
          ruleType: AppAutomationRuleType.no_reply_reminder,
        },
        select: { conversationId: true, createdAt: true },
      }),
    ]);

    const now = Date.now();
    let triggeredCount = 0;

    for (const conversation of conversations ?? []) {
      const threadMessages = (messages ?? []).filter((message) => message.conversationId === conversation.id);
      const latestInbound = threadMessages
        .filter((message) => message.direction === AppMessageDirection.inbound)
        .sort((left, right) => new Date(right.sentAt).getTime() - new Date(left.sentAt).getTime())[0];
      const latestOutbound = threadMessages
        .filter((message) => message.direction === AppMessageDirection.outbound)
        .sort((left, right) => new Date(right.sentAt).getTime() - new Date(left.sentAt).getTime())[0];

      if (!latestInbound) {
        continue;
      }

      const latestInboundAt = new Date(latestInbound.sentAt).getTime();
      const latestOutboundAt = latestOutbound ? new Date(latestOutbound.sentAt).getTime() : 0;
      const mostRecentReminder = (priorEvents ?? [])
        .filter((event) => event.conversationId === conversation.id)
        .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())[0];
      const mostRecentReminderAt = mostRecentReminder ? new Date(mostRecentReminder.createdAt).getTime() : 0;

      if (latestOutboundAt >= latestInboundAt) {
        continue;
      }

      if (mostRecentReminderAt >= latestInboundAt) {
        continue;
      }

      const hoursSinceInbound = (now - latestInboundAt) / (1000 * 60 * 60);
      if (hoursSinceInbound < reminderHours) {
        continue;
      }

      await prisma.conversation.update({
        where: { id: conversation.id },
        data: {
          status: AppConversationStatus.pending,
          assignedTo: configuredOwner || conversation.assignedTo,
        },
      });

      await logAutomationEvent({
        workspaceId: workspaceContext.workspaceId,
        ruleType: AppAutomationRuleType.no_reply_reminder,
        conversationId: conversation.id,
        status: "triggered",
        summary: `No-reply reminder flagged ${conversation.displayName} for follow-up after ${reminderHours} hours.`,
      });
      triggeredCount += 1;
    }

    res.json({
      result: {
        ok: true,
        message: triggeredCount > 0
          ? `${triggeredCount} conversation reminder${triggeredCount === 1 ? "" : "s"} flagged for follow-up.`
          : "No overdue conversations needed reminders right now.",
      },
    });
  } catch (error) {
    next(error);
  }
});

// GET /automation/definitions

app.get("/automation/definitions", async (req, res) => {
  try {
    const context = await getWorkspaceContextFromRequestAuthHeader(req.headers.authorization);
    if (!context) return res.status(401).json({ error: "Unauthorized" });
    const { workspaceId } = context;

    const data = await prisma.automationFlowDefinition.findMany({
      where: { workspaceId: workspaceId },
      orderBy: { updatedAt: "desc" },
    });

    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/automation/definitions", async (req, res) => {
  try {
    const context = await getWorkspaceContextFromRequestAuthHeader(req.headers.authorization);
    if (!context) return res.status(401).json({ error: "Unauthorized" });
    const { workspaceId } = context;
    const { id, name, description, nodes, edges, is_active } = req.body;

    if (!name?.trim()) {
      return res.status(400).json({ error: "Flow name is required." });
    }

    let data;
    if (id) {
      data = await prisma.automationFlowDefinition.update({
        where: { id },
        data: {
          name: name.trim(),
          description,
          nodes: nodes || [],
          edges: edges || [],
          isActive: is_active ?? true,
        },
      });
    } else {
      data = await prisma.automationFlowDefinition.create({
        data: {
          workspaceId,
          name: name.trim(),
          description,
          nodes: nodes || [],
          edges: edges || [],
          isActive: is_active ?? true,
        },
      });
    }

    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/automation/process-flows", async (req, res, next) => {
  try {
    const cronSecret = req.headers["x-cron-secret"];
    const isCronAuthorized = cronSecret && cronSecret === process.env.CRON_SECRET;

    const workspaceContext = await getWorkspaceContextFromRequestAuthHeader(req.headers.authorization);
    
    if (!workspaceContext && !isCronAuthorized) {
      throw new Error("Authorization or CRON_SECRET is required to process automation flows.");
    }
    
    // If it's a cron trigger without a specific workspace context, we process ALL active flows across all workspaces
    const dueFlows = await prisma.automationFlowRun.findMany({
      where: {
        status: "active",
        scheduledAt: { lte: new Date() },
        workspaceId: workspaceContext ? workspaceContext.workspaceId : undefined,
      },
    });

    if (!dueFlows || dueFlows.length === 0) {
      res.json({ result: { ok: true, message: "No due automation flows to process." } });
      return;
    }

    for (const flowRun of dueFlows) {
      await processFlowRun({
        id: flowRun.id,
        workspaceId: flowRun.workspaceId,
        leadId: flowRun.leadId,
        conversationId: flowRun.conversationId,
        flowDefinitionId: flowRun.flowDefinitionId,
        currentNodeId: flowRun.currentNodeId,
        status: flowRun.status as "active" | "completed" | "failed" | "paused",
        retryCount: flowRun.retryCount,
        scheduledAt: flowRun.scheduledAt,
      });
    }

    res.json({ result: { ok: true, message: `Processed ${dueFlows.length} automation flow(s).` } });
  } catch (error) {
    next(error);
  }
});

app.post("/automation/lead-contacted", async (req, res, next) => {
  try {
    const payload = automationLeadContactedSchema.parse(req.body);
    const workspaceContext = await getWorkspaceContextFromRequestAuthHeader(req.headers.authorization);
    if (!workspaceContext) {
      throw new Error("An active app session is required to process contacted-lead automation.");
    }

    const followUpRule = await getEnabledAutomationRule(workspaceContext.workspaceId, AppAutomationRuleType.follow_up_after_contacted);
    if (!followUpRule) {
      res.json({ result: { ok: true, message: "No contacted-lead follow-up automation is enabled." } });
      return;
    }

    const lead = await prisma.lead.findUnique({
      where: {
        id: payload.leadId,
      },
      select: { id: true, fullName: true, phone: true, conversationId: true, source: true },
    });

    if (!lead || lead.phone === null) {
      throw new Error("Lead not found or missing phone number.");
    }

    const followUpTemplate = followUpRule.config && typeof followUpRule.config === "object" && "message" in (followUpRule.config as any) && typeof (followUpRule.config as any).message === "string"
      ? (followUpRule.config as any).message.trim()
      : "";

    if (!followUpTemplate) {
      res.json({ result: { ok: true, message: "Follow-up automation is enabled but no message template is configured." } });
      return;
    }

    let conversationId = lead.conversationId;
    if (!conversationId) {
      // Look up contact by phone so the conversation is properly linked.
      const contact = await prisma.contact.findFirst({
        where: { workspaceId: workspaceContext.workspaceId, phone: lead.phone },
        select: { id: true },
      });
      const conversation = await prisma.conversation.create({
        data: {
          workspaceId: workspaceContext.workspaceId,
          contactId: contact?.id ?? null,
          phone: lead.phone,
          displayName: lead.fullName,
          status: AppConversationStatus.open,
          source: lead.source,
          lastMessagePreview: "",
          lastMessageAt: new Date(),
          unreadCount: 0,
        },
        select: { id: true },
      });
      conversationId = conversation?.id ?? null;
    }

    const body = resolveAutomationMessage(followUpTemplate, {
      contactName: lead.fullName,
      contactPhone: lead.phone,
    });

    try {
      const response = await sendWorkspaceAutomationMessage({
        workspaceId: workspaceContext.workspaceId,
        to: lead.phone,
        body,
      });
      const sentAt = new Date();
      const messageId = Array.isArray((response as { messages?: Array<{ id?: string }> }).messages)
        ? (response as { messages?: Array<{ id?: string }> }).messages?.[0]?.id ?? null
        : null;

      if (conversationId) {
        await Promise.all([
          prisma.conversationMessage.create({
            data: {
              workspaceId: workspaceContext.workspaceId,
              conversationId,
              metaMessageId: messageId,
              direction: AppMessageDirection.outbound,
              messageType: "text",
              body,
              status: "sent",
              payload: response as any,
              sentAt,
            },
          }),
          prisma.conversation.update({
            where: { id: conversationId },
            data: {
              lastMessagePreview: body,
              lastMessageAt: sentAt,
              status: AppConversationStatus.open,
            },
          }),
          prisma.lead.update({
            where: { id: lead.id },
            data: { conversationId },
          }),
        ]);
      }

      await logAutomationEvent({
        workspaceId: workspaceContext.workspaceId,
        ruleType: AppAutomationRuleType.follow_up_after_contacted,
        conversationId,
        leadId: lead.id,
        status: "triggered",
        summary: `Contacted follow-up sent to ${lead.fullName}.`,
      });
      await logOperationalEvent({
        workspaceId: workspaceContext.workspaceId,
        eventType: "automation_follow_up_sent",
        level: "info",
        summary: `Follow-up automation sent to ${lead.fullName}.`,
        payload: {
          leadId: lead.id,
          conversationId,
          phone: lead.phone,
        },
      });
    } catch (error) {
      await logFailedSend({
        workspaceId: workspaceContext.workspaceId,
        channel: "automation",
        targetType: "lead",
        targetId: lead.id,
        destination: lead.phone,
        messageBody: body,
        errorMessage: getErrorMessage(error),
        payload: {
          automationRule: "follow_up_after_contacted",
          conversationId,
        },
      });
      await logAutomationEvent({
        workspaceId: workspaceContext.workspaceId,
        ruleType: "follow_up_after_contacted",
        conversationId,
        leadId: lead.id,
        status: "failed",
        summary: `Contacted follow-up failed for ${lead.fullName}.`,
        payload: {
          message: error instanceof Error ? error.message : "Unknown automation error",
        },
      });
      throw error;
    }

    res.json({ result: { ok: true, message: "Contacted-lead follow-up automation processed." } });
  } catch (error) {
    next(error);
  }
});

app.post("/ops/retry-failed-send", async (req, res, next) => {
  try {
    const payload = retryFailedSendSchema.parse(req.body);
    const workspaceContext = await getWorkspaceContextFromRequestAuthHeader(req.headers.authorization);
    if (!workspaceContext) {
      throw new Error("An active app session is required to retry failed sends.");
    }

    const failedLog = await prisma.failedSendLog.findFirst({
      where: {
        workspaceId: workspaceContext.workspaceId,
        id: payload.failedSendLogId,
      },
    });

    if (!failedLog) {
      throw new Error("Failed send log not found for this workspace.");
    }

    const [authorization, connection] = await Promise.all([
      getActiveMetaAuthorization(workspaceContext.workspaceId),
      prisma.whatsAppConnection.findFirst({
        where: { workspaceId: workspaceContext.workspaceId },
        select: { phone_number_id: true },
      }),
    ]);

    if (!connection?.phone_number_id) {
      throw new Error("No connected Meta phone number was found for this workspace.");
    }

    const payloadData = failedLog.payload && typeof failedLog.payload === "object"
      ? failedLog.payload as Record<string, unknown>
      : {};

    if (failedLog.channel === "campaign" || failedLog.channel === "template") {
      await sendMetaTemplateMessage({
        accessToken: authorization.accessToken,
        phoneNumberId: connection.phone_number_id,
        to: failedLog.destination,
        templateName: failedLog.templateName ?? String(payloadData.templateName ?? ""),
        languageCode: String(payloadData.languageCode ?? "en"),
        bodyParameters: Array.isArray(payloadData.bodyParameters)
          ? payloadData.bodyParameters.filter((value): value is string => typeof value === "string")
          : [],
      });
    } else {
      const replyBody = failedLog.messageBody ?? String(payloadData.body ?? "");
      if (!replyBody.trim()) {
        throw new Error("No retry payload body was stored for this failed send.");
      }

      const providerResponse = await sendMetaTextMessage({
        accessToken: authorization.accessToken,
        phoneNumberId: connection.phone_number_id,
        to: failedLog.destination,
        body: replyBody,
      });

      const conversationId = typeof payloadData.conversationId === "string" ? payloadData.conversationId : null;
      const leadId = typeof payloadData.leadId === "string" ? payloadData.leadId : null;
      const sentAt = new Date().toISOString();
      const messageId = Array.isArray((providerResponse as { messages?: Array<{ id?: string }> }).messages)
        ? (providerResponse as { messages?: Array<{ id?: string }> }).messages?.[0]?.id ?? null
        : null;

      if (conversationId) {
        await Promise.all([
          prisma.conversationMessage.create({
            data: {
              workspaceId: workspaceContext.workspaceId,
              conversationId,
              metaMessageId: messageId,
              direction: AppMessageDirection.outbound,
              messageType: "text",
              body: replyBody,
              status: "sent",
              payload: providerResponse as any,
              sentAt: new Date(sentAt),
            },
          }),
          prisma.conversation.update({
            where: { id: conversationId },
            data: {
              lastMessagePreview: replyBody,
              lastMessageAt: new Date(sentAt),
              status: AppConversationStatus.open,
            },
          }),
        ]);
      }

      if (leadId) {
        await prisma.lead.update({
          where: { id: leadId },
          data: { updatedAt: new Date(sentAt) },
        });
      }
    }

    await Promise.all([
      prisma.failedSendLog.update({
        where: { id: failedLog.id },
        data: {
          status: "resolved",
          retryCount: (failedLog.retryCount ?? 0) + 1,
          lastAttemptAt: new Date(),
          resolvedAt: new Date(),
        },
      }),
      logOperationalEvent({
        workspaceId: workspaceContext.workspaceId,
        eventType: "failed_send_retried",
        level: "info",
        summary: `Failed ${failedLog.channel} send retried successfully for ${failedLog.destination}.`,
        payload: {
          failedSendLogId: failedLog.id,
          channel: failedLog.channel,
        },
      }),
    ]);

    res.json({
      result: {
        ok: true,
        message: "Failed send retried successfully.",
      },
    });
  } catch (error) {
    try {
      const payload = retryFailedSendSchema.safeParse(req.body);
      const workspaceContext = await getWorkspaceContextFromRequestAuthHeader(req.headers.authorization);
      if (payload.success && workspaceContext) {
        const failedLog = await prisma.failedSendLog.findFirst({
          where: {
            workspaceId: workspaceContext.workspaceId,
            id: payload.data.failedSendLogId,
          },
          select: { id: true, retryCount: true },
        });

        if (failedLog) {
          await Promise.all([
            prisma.failedSendLog.update({
              where: { id: failedLog.id },
              data: {
                retryCount: (failedLog.retryCount ?? 0) + 1,
                lastAttemptAt: new Date(),
              },
            }),
            logOperationalEvent({
              workspaceId: workspaceContext.workspaceId,
              eventType: "failed_send_retry_failed",
              level: "error",
              summary: `Retry failed for failed send ${failedLog.id}.`,
              payload: {
                failedSendLogId: failedLog.id,
                errorMessage: getErrorMessage(error),
              },
            }),
          ]);
        }
      }
    } catch (loggingError) {
      console.error("Failed to log retry failure", loggingError);
    }

    next(error);
  }
});

app.get("/app-state", async (_req, res, next) => {
  try {
    await ensureSession(prisma);
    const user = await getCurrentUser(prisma);
    const data = await buildAppState(prisma, user);
    res.json({ data });
  } catch (error) {
    next(error);
  }
});

app.post("/session", async (req, res, next) => {
  try {
    const { email, password } = signInSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email } });
    const isValidPassword = user?.passwordHash ? verifyPassword(password, user.passwordHash) : false;

    if (!user || !isValidPassword) {
      throw new Error("Invalid login credentials.");
    }

    await setCurrentUser(prisma, user.id);
    const data = await buildAppState(prisma, user);
    res.json({ data });
  } catch (error) {
    next(error);
  }
});

app.post("/auth/signup", async (req, res, next) => {
  try {
    const { name, email, password } = signUpSchema.parse(req.body);
    const existing = await prisma.user.findUnique({ where: { email } });
    const passwordHash = hashPassword(password);

    if (existing?.passwordHash) {
      throw new Error("User already registered.");
    }

    const user = existing
      ? await prisma.user.update({
          where: { id: existing.id },
          data: {
            name,
            passwordHash,
          },
        })
      : await createWorkspaceForUser(prisma, { name, email, passwordHash });

    await setCurrentUser(prisma, user.id);
    const data = await buildAppState(prisma, user);
    res.json({ data });
  } catch (error) {
    next(error);
  }
});

app.post("/auth/signout", async (_req, res, next) => {
  try {
    await setCurrentUser(prisma, null);
    const data = await buildAppState(prisma, null);
    res.json({ data });
  } catch (error) {
    next(error);
  }
});

app.post("/onboarding/complete", async (_req, res, next) => {
  try {
    const user = await requireUser();
    await prisma.user.update({
      where: { id: user.id },
      data: { onboardingComplete: true },
    });
    const freshUser = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    const data = await buildAppState(prisma, freshUser);
    res.json({ data });
  } catch (error) {
    next(error);
  }
});

app.post("/whatsapp/connect", async (req, res, next) => {
  try {
    const user = await requireUser();
    const payload = connectWhatsAppSchema.parse(req.body);
    const existing = await prisma.whatsAppConnection.findFirst({
      where: { workspaceId: user.workspaceId },
      orderBy: { updatedAt: "desc" },
    });

    if (existing) {
      await prisma.whatsAppConnection.update({
        where: { id: existing.id },
        data: {
          business_portfolio: payload.businessPortfolio,
          business_name: payload.businessName,
          display_phone_number: payload.phoneNumber,
          status: ConnectionStatus.connected,
        },
      });
    } else {
      await prisma.whatsAppConnection.create({
        data: {
          workspaceId: user.workspaceId,
          business_portfolio: payload.businessPortfolio,
          business_name: payload.businessName,
          display_phone_number: payload.phoneNumber,
          status: ConnectionStatus.connected,
        },
      });
    }

    // Supabase sync removed as we have migrated to Neon/Prisma.
    await logOperationalEvent({
      workspaceId: user.workspaceId,
      eventType: "whatsapp_connected",
      level: "info",
      summary: `WhatsApp number ${payload.phoneNumber} connected.`,
    });

    const freshUser = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    const data = await buildAppState(prisma, freshUser);
    res.json({ data });
  } catch (error) {
    next(error);
  }
});

app.post("/whatsapp/disconnect", async (_req, res, next) => {
  try {
    const user = await requireUser();
    await prisma.whatsAppConnection.updateMany({
      where: { workspaceId: user.workspaceId },
      data: { status: ConnectionStatus.disconnected },
    });

    // Supabase sync removed as we have migrated to Neon/Prisma.
    await logOperationalEvent({
      workspaceId: user.workspaceId,
      eventType: "whatsapp_disconnected",
      level: "warning",
      summary: `WhatsApp connection disconnected.`,
    });

    const freshUser = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    const data = await buildAppState(prisma, freshUser);
    res.json({ data });
  } catch (error) {
    next(error);
  }
});

app.post("/wallet/top-up", async (req, res, next) => {
  try {
    const user = await requireUser();
    const { amount, source } = walletSchema.parse(req.body);
    const currentState = await buildAppState(prisma, user);
    const nextBalance = currentState.walletBalance + amount;

    await prisma.walletTransaction.create({
      data: {
        workspaceId: user.workspaceId,
        type: "credit",
        amount,
        description: source || "Wallet Recharge",
        referenceType: "manual_topup",
        balanceAfter: nextBalance,
      },
    });

    const freshUser = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    const data = await buildAppState(prisma, freshUser);
    res.json(actionResponse(data, { ok: true, message: "Balance added successfully." }));
  } catch (error) {
    next(error);
  }
});

app.post("/contacts", async (req, res, next) => {
  try {
    const user = await requireUser();
    const payload = contactSchema.parse(req.body);
    const contact = await prisma.contact.create({
      data: {
        workspaceId: user.workspaceId,
        name: payload.name,
        phone: payload.phone,
        tags: {
          create: payload.tags.map((tag) => ({
            workspaceId: user.workspaceId,
            tag,
          })),
        },
      },
    });

    await prisma.contact.findUniqueOrThrow({ where: { id: contact.id } });
    const freshUser = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    const data = await buildAppState(prisma, freshUser);
    res.json({ data });
  } catch (error) {
    next(error);
  }
});

app.post("/contacts/upload-sample", async (_req, res, next) => {
  try {
    const user = await requireUser();
    await seedWorkspace(prisma, user.workspaceId);
    const sampleContacts = [
      { name: "Kunal Mehta", phone: "+91 99887 77665", tags: ["CSV", "Shopify"] },
      { name: "Neha Kapoor", phone: "+91 90909 80808", tags: ["CSV", "VIP"] },
      { name: "Ritesh Jain", phone: "+91 93456 78123", tags: ["CSV", "Retail"] },
    ];

    for (const sample of sampleContacts) {
      const exists = await prisma.contact.findFirst({
        where: { workspaceId: user.workspaceId, phone: sample.phone },
      });
      if (exists) {
        continue;
      }
      await prisma.contact.create({
        data: {
          workspaceId: user.workspaceId,
          name: sample.name,
          phone: sample.phone,
          tags: {
            create: sample.tags.map((tag) => ({
              workspaceId: user.workspaceId,
              tag,
            })),
          },
        },
      });
    }

    const freshUser = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    const data = await buildAppState(prisma, freshUser);
    res.json({ data });
  } catch (error) {
    next(error);
  }
});

app.post("/campaigns", async (req, res, next) => {
  try {
    const user = await requireUser();
    const payload = campaignSchema.parse(req.body);
    const currentState = await buildAppState(prisma, user);
    const estimatedCost = Number((payload.contactIds.length * COST_PER_MESSAGE).toFixed(2));

    if (payload.sendNow && currentState.walletBalance < estimatedCost) {
      res.status(400).json(actionResponse(currentState, {
        ok: false,
        message: "Insufficient wallet balance for this campaign.",
      }));
      return;
    }

    const contacts = await prisma.contact.findMany({
      where: {
        workspaceId: user.workspaceId,
        id: { in: payload.contactIds },
      },
    });

    if (contacts.length !== payload.contactIds.length) {
      res.status(400).json(actionResponse(currentState, {
        ok: false,
        message: "One or more contacts were not found.",
      }));
      return;
    }

    const template = await prisma.messageTemplate.findFirst({
      where: {
        workspaceId: user.workspaceId,
        id: payload.templateId,
      },
    });

    if (!template) {
      res.status(400).json(actionResponse(currentState, {
        ok: false,
        message: "Template not found.",
      }));
      return;
    }

    const campaign = await prisma.campaign.create({
      data: {
        workspaceId: user.workspaceId,
        templateId: template.id,
        name: payload.name,
        status: payload.sendNow ? CampaignStatus.sending : CampaignStatus.draft,
        estimatedCost,
        spent: payload.sendNow ? estimatedCost : 0,
        launchedAt: payload.sendNow ? new Date() : null,
        recipients: {
          create: contacts.map((contact) => ({
            workspaceId: user.workspaceId,
            contactId: contact.id,
            status: payload.sendNow ? "sent" : "queued",
            cost: COST_PER_MESSAGE,
          })),
        },
      },
    });

    if (payload.sendNow) {
      await prisma.walletTransaction.create({
        data: {
          workspaceId: user.workspaceId,
          type: "debit",
          amount: -estimatedCost,
          description: `${payload.name} (${payload.contactIds.length} msgs)`,
          referenceType: "campaign_send",
          referenceId: campaign.id,
          balanceAfter: currentState.walletBalance - estimatedCost,
        },
      });
    }

    const freshUser = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    const data = await buildAppState(prisma, freshUser);
    res.json(actionResponse(data, {
      ok: true,
      message: payload.sendNow ? "Campaign launched successfully." : "Draft saved successfully.",
    }));
  } catch (error) {
    next(error);
  }
});

// ── Partner System Routes ─────────────────────────────────────

// Zod schemas
const partnerApplySchema = z.object({
  contactName: z.string().min(1),
  email: z.string().email(),
  phone: z.string().optional(),
  companyName: z.string().optional(),
  partnerType: z.enum(["affiliate", "reseller", "white_label", "api_integration"]),
  message: z.string().optional(),
});

const partnerCommissionSchema = z.object({
  commissionRate: z.number().min(0).max(100),
});

const payoutRequestSchema = z.object({
  amount: z.number().positive(),
  paymentMethod: z.string().min(1),
  paymentDetails: z.record(z.unknown()),
});

// POST /partners/apply - Apply to become a partner
app.post("/partners/apply", async (req, res, next) => {
  try {
    const user = await requireUser();
    const payload = partnerApplySchema.parse(req.body);

    // Generate a unique referral code
    const randomChars = Math.random().toString(36).substring(2, 8).toUpperCase();
    const referralCode = `PRT-${randomChars}`;

    const partner = await prisma.partner.create({
      data: {
        workspaceId: user.workspaceId,
        userId: user.id,
        contactName: payload.contactName,
        email: payload.email,
        phone: payload.phone,
        companyName: payload.companyName,
        partnerType: payload.partnerType,
        message: payload.message,
        referralCode,
        status: "pending",
        commissionRate: 10, // Default 10% commission
        totalEarned: 0,
        totalPaid: 0,
      },
    });

    res.json(actionResponse(partner, { ok: true, message: "Partner application submitted successfully." }));
  } catch (error) {
    next(error);
  }
});

// GET /partners - List all partners for the user's workspace
app.get("/partners", async (req, res, next) => {
  try {
    const user = await requireUser();
    const partners = await prisma.partner.findMany({
      where: { workspaceId: user.workspaceId },
      include: {
        referrals: true,
        payouts: true,
      },
    });

    res.json({ data: partners });
  } catch (error) {
    next(error);
  }
});

// GET /partners/dashboard - Get partner dashboard data
app.get("/partners/dashboard", async (req, res, next) => {
  try {
    const user = await requireUser();
    const partner = await prisma.partner.findFirst({
      where: { userId: user.id },
      include: {
        referrals: true,
        payouts: true,
      },
    });

    if (!partner) {
      res.status(404).json({ message: "Partner not found." });
      return;
    }

    // Calculate stats
    const referralsCount = partner.referrals.length;
    const totalCommissions = partner.referrals.reduce((sum, ref) => sum + (ref.commissionAmount || 0), 0);
    const activeCustomers = partner.referrals.filter((ref) => ref.status === "converted").length;
    const conversionRate = referralsCount > 0 ? (activeCustomers / referralsCount) * 100 : 0;

    const stats = {
      referralsCount,
      totalCommissions,
      activeCustomers,
      conversionRate: Math.round(conversionRate * 100) / 100,
    };

    res.json({
      data: {
        partner,
        stats,
        referrals: partner.referrals,
        payouts: partner.payouts,
      },
    });
  } catch (error) {
    next(error);
  }
});

// GET /partners/:id - Get partner by ID
app.get("/partners/:id", async (req, res, next) => {
  try {
    const user = await requireUser();
    const { id } = req.params;

    const partner = await prisma.partner.findFirst({
      where: {
        id,
        workspaceId: user.workspaceId,
      },
      include: {
        referrals: true,
        payouts: true,
      },
    });

    if (!partner) {
      res.status(404).json({ message: "Partner not found." });
      return;
    }

    res.json({ data: partner });
  } catch (error) {
    next(error);
  }
});

// POST /partners/:id/approve - Approve a partner
app.post("/partners/:id/approve", async (req, res, next) => {
  try {
    const user = await requireUser();
    const { id } = req.params;

    const partner = await prisma.partner.updateMany({
      where: {
        id,
        workspaceId: user.workspaceId,
      },
      data: {
        status: "approved",
        updatedAt: new Date(),
      },
    });

    if (partner.count === 0) {
      res.status(404).json({ message: "Partner not found." });
      return;
    }

    const updatedPartner = await prisma.partner.findFirst({
      where: { id },
    });

    res.json(actionResponse(updatedPartner, { ok: true, message: "Partner approved successfully." }));
  } catch (error) {
    next(error);
  }
});

// POST /partners/:id/reject - Reject a partner
app.post("/partners/:id/reject", async (req, res, next) => {
  try {
    const user = await requireUser();
    const { id } = req.params;

    const partner = await prisma.partner.updateMany({
      where: {
        id,
        workspaceId: user.workspaceId,
      },
      data: {
        status: "rejected",
        updatedAt: new Date(),
      },
    });

    if (partner.count === 0) {
      res.status(404).json({ message: "Partner not found." });
      return;
    }

    const updatedPartner = await prisma.partner.findFirst({
      where: { id },
    });

    res.json(actionResponse(updatedPartner, { ok: true, message: "Partner rejected successfully." }));
  } catch (error) {
    next(error);
  }
});

// PATCH /partners/:id/commission - Update partner commission rate
app.patch("/partners/:id/commission", async (req, res, next) => {
  try {
    const user = await requireUser();
    const { id } = req.params;
    const payload = partnerCommissionSchema.parse(req.body);

    const partner = await prisma.partner.updateMany({
      where: {
        id,
        workspaceId: user.workspaceId,
      },
      data: {
        commissionRate: payload.commissionRate,
        updatedAt: new Date(),
      },
    });

    if (partner.count === 0) {
      res.status(404).json({ message: "Partner not found." });
      return;
    }

    const updatedPartner = await prisma.partner.findFirst({
      where: { id },
    });

    res.json(actionResponse(updatedPartner, { ok: true, message: "Commission rate updated successfully." }));
  } catch (error) {
    next(error);
  }
});

// GET /partners/referrals - List referrals for the current user's partner
app.get("/partners/referrals", async (req, res, next) => {
  try {
    const user = await requireUser();
    const partner = await prisma.partner.findFirst({
      where: { userId: user.id },
    });

    if (!partner) {
      res.status(404).json({ message: "Partner not found." });
      return;
    }

    const referrals = await prisma.partnerReferral.findMany({
      where: { partnerId: partner.id },
    });

    res.json({ data: referrals });
  } catch (error) {
    next(error);
  }
});

// POST /partners/referrals - Create a new referral
app.post("/partners/referrals", async (req, res, next) => {
  try {
    const user = await requireUser();
    const partner = await prisma.partner.findFirst({
      where: { userId: user.id },
    });

    if (!partner) {
      res.status(404).json({ message: "Partner not found." });
      return;
    }

    const referralSchema = z.object({
      referredEmail: z.string().email(),
    });

    const payload = referralSchema.parse(req.body);

    const referral = await prisma.partnerReferral.create({
      data: {
        partnerId: partner.id,
        workspaceId: partner.workspaceId,
        referredEmail: payload.referredEmail,
        status: "pending",
      },
    });

    res.json({ data: referral });
  } catch (error) {
    next(error);
  }
});

// GET /partners/payouts - List payouts for the current user's partner
app.get("/partners/payouts", async (req, res, next) => {
  try {
    const user = await requireUser();
    const partner = await prisma.partner.findFirst({
      where: { userId: user.id },
    });

    if (!partner) {
      res.status(404).json({ message: "Partner not found." });
      return;
    }

    const payouts = await prisma.partnerPayout.findMany({
      where: { partnerId: partner.id },
    });

    res.json({ data: payouts });
  } catch (error) {
    next(error);
  }
});

// POST /partners/payouts/request - Request a payout
app.post("/partners/payouts/request", async (req, res, next) => {
  try {
    const user = await requireUser();
    const payload = payoutRequestSchema.parse(req.body);

    const partner = await prisma.partner.findFirst({
      where: { userId: user.id },
      include: {
        referrals: true,
      },
    });

    if (!partner) {
      res.status(404).json({ message: "Partner not found." });
      return;
    }

    // Calculate earned but unpaid balance
    const totalEarned = partner.referrals.reduce((sum, ref) => sum + (ref.commissionAmount || 0), 0);
    const availableBalance = totalEarned - partner.totalPaid;

    if (payload.amount > availableBalance) {
      res.status(400).json(actionResponse(null, {
        ok: false,
        message: "Insufficient balance for this payout request.",
      }));
      return;
    }

    const payout = await prisma.partnerPayout.create({
      data: {
        partnerId: partner.id,
        workspaceId: partner.workspaceId,
        amount: payload.amount,
        paymentMethod: payload.paymentMethod,
        paymentDetails: JSON.stringify(payload.paymentDetails),
        status: "pending",
      },
    });

    res.json(actionResponse(payout, { ok: true, message: "Payout request submitted successfully." }));
  } catch (error) {
    next(error);
  }
});

// POST /partners/payouts/:id/process - Process a payout (admin)
app.post("/partners/payouts/:id/process", async (req, res, next) => {
  try {
    const user = await requireUser();
    const { id } = req.params;

    const payout = await prisma.partnerPayout.findFirst({
      where: { id },
      include: {
        partner: true,
      },
    });

    if (!payout) {
      res.status(404).json({ message: "Payout not found." });
      return;
    }

    // Verify the partner belongs to the user's workspace
    if (payout.partner.workspaceId !== user.workspaceId) {
      res.status(403).json({ message: "Unauthorized to process this payout." });
      return;
    }

    const [updatedPayout] = await prisma.$transaction([
      prisma.partnerPayout.update({
        where: { id },
        data: {
          status: "completed",
          processedAt: new Date(),
        },
      }),
      prisma.partner.update({
        where: { id: payout.partnerId },
        data: {
          totalPaid: {
            increment: payout.amount,
          },
        },
      }),
    ]);

    res.json(actionResponse(updatedPayout, { ok: true, message: "Payout processed successfully." }));
  } catch (error) {
    next(error);
  }
});

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(error);

  if (error instanceof z.ZodError) {
    res.status(400).json({ message: "Invalid request payload.", issues: error.flatten() });
    return;
  }

  if (error instanceof Error) {
    res.status(400).json({ message: error.message });
    return;
  }

  res.status(500).json({ message: "Unexpected server error." });
});

ensureSessionWithRetry()
  .then(() => {
    app.listen(port, () => {
      console.log(`WaBiz API listening on http://localhost:${port}`);
    });
  })
  .catch(async (error) => {
    console.error("Failed to start server", error);
    await prisma.$disconnect();
    process.exit(1);
  });

export default app;
