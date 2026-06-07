import { prisma } from "../../prisma";
import { ConnectionStatus, AppConversationStatus, AppMessageDirection } from "@prisma/client";
import {
  exchangeMetaCode,
  sendMetaTemplateMessage,
  sendMetaTextMessage,
  getMetaWebhookVerifyToken,
  buildCampaignBodyParameters,
  mapTemplateLanguageToMetaCode,
} from "../../meta";
import {
  persistWhatsAppWebhookEvent,
  persistLeadgenWebhookEvent,
  claimWebhookEvent,
  summarizeMetaWebhookPayload,
} from "../../metaWebhook";
import {
  getWorkspaceContextFromRequestAuthHeader,
} from "../../supabaseAdmin";
import { logOperationalEvent, logFailedSend, getErrorMessage, getActiveMetaAuthorization, getEnabledAutomationRule, logAutomationEvent } from "../../utils";
import type {
  MetaExchangeInput,
  MetaSendTemplateInput,
  MetaSendCampaignInput,
  MetaReplyInput,
  MetaLeadSourceMappingInput,
} from "./meta.schemas";

// OAuth: Exchange Meta code for access token
export async function handleMetaOAuth(input: MetaExchangeInput) {
  const data = await exchangeMetaCode(input);
  return data;
}

// OAuth: Store authorization in database
export async function storeMetaAuthorization(workspaceId: string, exchangeData: any) {
  await prisma.metaAuthorization.upsert({
    where: { workspaceId },
    update: {
      accessToken: exchangeData.authorization.accessToken,
      tokenType: exchangeData.authorization.tokenType,
      expiresAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
    },
    create: {
      workspaceId,
      accessToken: exchangeData.authorization.accessToken,
      tokenType: exchangeData.authorization.tokenType,
      expiresAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
    },
  });
}

// OAuth: Store WhatsApp connection
export async function storeWhatsAppConnection(workspaceId: string, exchangeData: any) {
  const existingConnection = await prisma.whatsAppConnection.findFirst({
    where: { workspaceId },
    select: { id: true },
  });

  const connectionData = {
    metaBusinessId: exchangeData.candidate.metaBusinessId,
    metaBusinessPortfolioId: exchangeData.candidate.metaBusinessPortfolioId,
    wabaId: exchangeData.candidate.wabaId,
    phone_number_id: exchangeData.candidate.phoneNumberId,
    display_phone_number: exchangeData.candidate.displayPhoneNumber,
    verified_name: exchangeData.candidate.verifiedName,
    business_portfolio: exchangeData.candidate.businessPortfolio,
    business_name: exchangeData.candidate.businessName,
    status: ConnectionStatus.connected,
    business_verification_status: exchangeData.candidate.businessVerificationStatus,
    account_review_status: exchangeData.candidate.accountReviewStatus,
    oba_status: exchangeData.candidate.obaStatus,
  };

  if (existingConnection) {
    return await prisma.whatsAppConnection.update({
      where: { id: existingConnection.id },
      data: connectionData,
    });
  } else {
    return await prisma.whatsAppConnection.create({
      data: {
        workspaceId,
        ...connectionData,
      },
    });
  }
}

// Send template message
export async function sendTemplateMessage(workspaceId: string, input: MetaSendTemplateInput) {
  const [authorization, connection] = await Promise.all([
    getActiveMetaAuthorization(workspaceId),
    prisma.whatsAppConnection.findFirst({
      where: { workspaceId },
      select: { phone_number_id: true },
    }),
  ]);

  if (!connection?.phone_number_id) {
    throw new Error("No connected Meta phone number was found for this workspace.");
  }

  const data = await sendMetaTemplateMessage({
    accessToken: authorization.accessToken,
    phoneNumberId: connection.phone_number_id,
    to: input.to,
    templateName: input.templateName,
    languageCode: input.languageCode,
    bodyParameters: input.bodyParameters,
  });

  await logOperationalEvent({
    workspaceId,
    eventType: "template_sent",
    level: "info",
    summary: `Template ${input.templateName} sent to ${input.to}.`,
    payload: {
      destination: input.to,
      templateName: input.templateName,
    },
  });

  return data;
}

// Send campaign (batch template messages)
export async function sendCampaignMessages(workspaceId: string, input: MetaSendCampaignInput) {
  const [authorization, connection, template, contacts] = await Promise.all([
    getActiveMetaAuthorization(workspaceId),
    prisma.whatsAppConnection.findFirst({
      where: { workspaceId },
      select: { phone_number_id: true },
    }),
    prisma.messageTemplate.findUnique({
      where: { id: input.templateId },
      select: { id: true, name: true, language: true, body: true, workspaceId: true },
    }),
    prisma.contact.findMany({
      where: {
        workspaceId,
        id: { in: input.contactIds },
      },
      select: { id: true, name: true, phone: true },
    }),
  ]);

  if (!connection?.phone_number_id) {
    throw new Error("No connected Meta phone number was found for this workspace.");
  }

  if (!template || template.workspaceId !== workspaceId) {
    throw new Error("Template not found for this workspace.");
  }

  if (!contacts || contacts.length !== input.contactIds.length) {
    throw new Error("One or more contacts could not be found for this workspace.");
  }

  const results = [];
  const failures: Array<{ contactId: string; phone: string; errorMessage: string }> = [];

  for (const contact of contacts) {
    const bodyParameters = buildCampaignBodyParameters({
      templateBody: template.body,
      contactName: contact.name,
      contactPhone: contact.phone,
      bodyParameters: input.bodyParameters,
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
        workspaceId,
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
    workspaceId,
    eventType: "campaign_send_completed",
    level: failures.length > 0 ? "warning" : "info",
    summary: `Campaign send completed with ${results.length} success(es) and ${failures.length} failure(s).`,
    payload: {
      templateId: input.templateId,
      sentCount: results.length,
      failedCount: failures.length,
    },
  });

  return {
    sentCount: results.length,
    failedCount: failures.length,
    results,
    failures,
  };
}

// Send text reply
export async function sendReply(workspaceId: string, input: MetaReplyInput) {
  const [authorization, connection, conversation] = await Promise.all([
    getActiveMetaAuthorization(workspaceId),
    prisma.whatsAppConnection.findFirst({
      where: { workspaceId },
      select: { phone_number_id: true },
    }),
    prisma.conversation.findUnique({
      where: { id: input.conversationId },
      select: { id: true, workspaceId: true },
    }),
  ]);

  if (!connection?.phone_number_id) {
    throw new Error("No connected Meta phone number was found for this workspace.");
  }

  if (!conversation || conversation.workspaceId !== workspaceId) {
    throw new Error("Conversation not found for this workspace.");
  }

  const data = await sendMetaTextMessage({
    accessToken: authorization.accessToken,
    phoneNumberId: connection.phone_number_id,
    to: input.to,
    body: input.body,
  });

  const messageId = Array.isArray((data as { messages?: Array<{ id?: string }> }).messages)
    ? (data as { messages?: Array<{ id?: string }> }).messages?.[0]?.id ?? null
    : null;
  const sentAt = new Date();

  await prisma.$transaction([
    prisma.conversation.update({
      where: { id: input.conversationId },
      data: {
        lastMessagePreview: input.body,
        lastMessageAt: sentAt,
        status: AppConversationStatus.open,
      },
    }),
    prisma.conversationMessage.create({
      data: {
        workspaceId,
        conversationId: input.conversationId,
        metaMessageId: messageId,
        direction: AppMessageDirection.outbound,
        messageType: "text",
        body: input.body,
        status: "sent",
        payload: data as any,
        sentAt,
      },
    }),
  ]);

  await logOperationalEvent({
    workspaceId,
    eventType: "reply_sent",
    level: "info",
    summary: `Inbox reply sent to ${input.to}.`,
    payload: {
      conversationId: input.conversationId,
      destination: input.to,
    },
  });

  return {
    messageId,
    sentAt,
    providerResponse: data,
  };
}

// Get lead source mappings
export async function getLeadSourceMappings(workspaceId: string) {
  return await prisma.metaLeadSourceMapping.findMany({
    where: { workspaceId },
    orderBy: { createdAt: "desc" },
  });
}

// Create lead source mapping
export async function createLeadSourceMapping(workspaceId: string, input: MetaLeadSourceMappingInput) {
  if (!input.pageId && !input.adId && !input.formId) {
    throw new Error("Provide at least one Meta identifier: page ID, ad ID, or form ID.");
  }

  return await prisma.metaLeadSourceMapping.create({
    data: {
      workspaceId,
      label: input.label,
      pageId: input.pageId || null,
      adId: input.adId || null,
      formId: input.formId || null,
    },
  });
}

// Webhook verification
export function getWebhookVerifyToken(): string {
  return getMetaWebhookVerifyToken();
}

// Process webhook payload
export async function processWebhookPayload(payload: any) {
  const summary = summarizeMetaWebhookPayload(payload);
  console.log("Meta webhook payload received", JSON.stringify(summary));

  const results = [];
  for (const event of summary) {
    try {
      const isNewEvent = await claimWebhookEvent(event);
      if (!isNewEvent) {
        continue;
      }

      if (event.kind === "whatsapp") {
        await persistWhatsAppWebhookEvent(event);
      } else {
        await persistLeadgenWebhookEvent(event);
      }
      results.push({ event, status: "processed" });
    } catch (error) {
      console.error("Failed to persist Meta webhook event", error);
      results.push({ event, status: "failed", error });
    }
  }

  return results;
}
