import { Router } from "express";
import { getWorkspaceContextFromRequestAuthHeader } from "../../supabaseAdmin";
import {
  metaExchangeSchema,
  metaSendTemplateSchema,
  metaSendCampaignSchema,
  metaReplySchema,
  metaLeadSourceMappingSchema,
} from "./meta.schemas";
import {
  handleMetaOAuth,
  storeMetaAuthorization,
  storeWhatsAppConnection,
  sendTemplateMessage,
  sendCampaignMessages,
  sendReply,
  getLeadSourceMappings,
  createLeadSourceMapping,
  getWebhookVerifyToken,
  verifyWebhookSignature,
  processWebhookPayload,
} from "./meta.service";
import { logFailedSend, getErrorMessage } from "../../utils";

const router = Router();

// Webhook verification (challenge)
router.get("/webhook", (req, res) => {
  const verifyToken = getWebhookVerifyToken();
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && verifyToken && token === verifyToken && typeof challenge === "string") {
    res.status(200).send(challenge);
    return;
  }

  res.status(403).send("Webhook verification failed.");
});

// Webhook receiver (events)
router.post("/webhook", (req, res) => {
  // Verify webhook signature if app secret is configured
  const appSecret = process.env.META_APP_SECRET;
  const signature = req.headers["x-hub-signature-256"] as string;

  if (appSecret && signature) {
    const payload = JSON.stringify(req.body);
    const isValid = verifyWebhookSignature(payload, signature, appSecret);

    if (!isValid) {
      console.warn("Invalid webhook signature");
      return res.status(403).json({ error: "Invalid signature" });
    }
  }

  void (async () => {
    try {
      await processWebhookPayload(req.body);
    } catch (error) {
      console.error("Failed to process Meta webhook", error);
    }
  })();

  res.status(200).json({ received: true });
});

// OAuth: Exchange code for token
router.post("/exchange-code", async (req, res, next) => {
  try {
    const payload = metaExchangeSchema.parse(req.body);
    const data = await handleMetaOAuth(payload);

    try {
      const workspaceContext = await getWorkspaceContextFromRequestAuthHeader(req.headers.authorization);
      if (workspaceContext) {
        await storeMetaAuthorization(workspaceContext.workspaceId, data);
        await storeWhatsAppConnection(workspaceContext.workspaceId, data);
      }
    } catch (persistenceError) {
      console.error("Failed to persist Meta authorization", persistenceError);
    }

    res.json({ data });
  } catch (error) {
    next(error);
  }
});

// Get lead source mappings
router.get("/source-mappings", async (req, res, next) => {
  try {
    const workspaceContext = await getWorkspaceContextFromRequestAuthHeader(req.headers.authorization);
    if (!workspaceContext) {
      throw new Error("An active app session is required to load Meta source mappings.");
    }

    const data = await getLeadSourceMappings(workspaceContext.workspaceId);
    res.json({ data });
  } catch (error) {
    next(error);
  }
});

// Create lead source mapping
router.post("/source-mappings", async (req, res, next) => {
  try {
    const workspaceContext = await getWorkspaceContextFromRequestAuthHeader(req.headers.authorization);
    if (!workspaceContext) {
      throw new Error("An active app session is required to save Meta source mappings.");
    }

    const payload = metaLeadSourceMappingSchema.parse(req.body);
    const data = await createLeadSourceMapping(workspaceContext.workspaceId, payload);
    res.json({ data });
  } catch (error) {
    next(error);
  }
});

// Send template message
router.post("/send-template", async (req, res, next) => {
  let workspaceId: string | null = null;
  let to: string | null = null;
  let templateName: string | null = null;

  try {
    const payload = metaSendTemplateSchema.parse(req.body);
    const workspaceContext = await getWorkspaceContextFromRequestAuthHeader(req.headers.authorization);
    if (!workspaceContext) {
      throw new Error("An active app session is required to send WhatsApp templates.");
    }

    workspaceId = workspaceContext.workspaceId;
    to = payload.to;
    templateName = payload.templateName;

    const data = await sendTemplateMessage(workspaceContext.workspaceId, payload);
    res.json({ data });
  } catch (error) {
    if (workspaceId && to && templateName) {
      try {
        await logFailedSend({
          workspaceId,
          channel: "template",
          targetType: "workspace",
          destination: to,
          templateName,
          errorMessage: getErrorMessage(error),
        });
      } catch (loggingError) {
        console.error("Failed to log template send failure", loggingError);
      }
    }
    next(error);
  }
});

// Send campaign (batch template sends)
router.post("/send-campaign", async (req, res, next) => {
  try {
    const payload = metaSendCampaignSchema.parse(req.body);
    const workspaceContext = await getWorkspaceContextFromRequestAuthHeader(req.headers.authorization);
    if (!workspaceContext) {
      throw new Error("An active app session is required to send WhatsApp campaigns.");
    }

    const result = await sendCampaignMessages(workspaceContext.workspaceId, payload);

    if (result.results.length === 0 && result.failures.length > 0) {
      res.status(502).json({
        message: `Campaign send failed for all selected contacts. ${result.failures[0]?.errorMessage ?? ""}`.trim(),
        data: result,
      });
      return;
    }

    res.json({ data: result });
  } catch (error) {
    next(error);
  }
});

// Send text reply
router.post("/send-reply", async (req, res, next) => {
  let workspaceId: string | null = null;
  let conversationId: string | null = null;

  try {
    const payload = metaReplySchema.parse(req.body);
    const workspaceContext = await getWorkspaceContextFromRequestAuthHeader(req.headers.authorization);
    if (!workspaceContext) {
      throw new Error("An active app session is required to send WhatsApp replies.");
    }

    workspaceId = workspaceContext.workspaceId;
    conversationId = payload.conversationId;

    const data = await sendReply(workspaceContext.workspaceId, payload);
    res.json({ data });
  } catch (error) {
    if (workspaceId && conversationId) {
      try {
        await logFailedSend({
          workspaceId,
          channel: "reply",
          targetType: "conversation",
          targetId: conversationId,
          errorMessage: getErrorMessage(error),
        });
      } catch (loggingError) {
        console.error("Failed to log reply send failure", loggingError);
      }
    }
    next(error);
  }
});

export default router;
