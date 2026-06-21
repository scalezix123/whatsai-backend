import express, { type Express } from "express";
import cors from "cors";
import swaggerUi from "swagger-ui-express";
import {
  requestId,
  requireSession,
  errorNormalization,
  requestLogging,
  rateLimit,
  securityHeaders,
} from "./middleware/index";
import { generateOpenAPISpec } from "./openapi";

export async function createApp(): Promise<Express> {
  const app = express();

  // Global middleware
  app.use(cors({ origin: true, credentials: true }));
  app.use(express.json());
  app.use(requestId());
  app.use(requestLogging());
  app.use(securityHeaders());
  app.use(rateLimit());

  // Public routes (no session required)
  const authRoutes = (await import("./modules/auth")).default;
  app.use("/auth", authRoutes);  // /auth/signup, /auth/signout

  // Meta routes (webhook is public, others check session in handlers)
  const metaRoutes = (await import("./modules/meta")).default;
  app.use("/meta", metaRoutes);  // /meta/webhook, /meta/exchange-code, /meta/send-*, etc.

  // Health check (public, no session required)
  app.get("/health", (req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // API Documentation (public)
  const openAPISpec = generateOpenAPISpec();
  app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(openAPISpec));
  app.get("/api-spec.json", (req, res) => {
    res.json(openAPISpec);
  });

  // Branding routes (public short links and partner branding)
  const brandingRoutes = (await import("./modules/branding")).default;
  app.use("/", brandingRoutes);  // /t/:code (short links), /branding/:ref (public branding)

  // Root-level session routes (public, before requireSession)
  const { getAppState, signInUser, completeOnboarding } = (await import("./modules/auth/auth.service"));
  const { signInSchema } = (await import("./modules/auth/auth.schemas"));

  app.get("/app-state", async (_req, res, next) => {
    try {
      const data = await getAppState();
      res.json({ data });
    } catch (error) {
      next(error);
    }
  });

  app.post("/session", async (req, res, next) => {
    try {
      const payload = signInSchema.parse(req.body);
      const data = await signInUser(payload);
      res.json({ data });
    } catch (error) {
      next(error);
    }
  });

  app.post("/onboarding/complete", async (_req, res, next) => {
    try {
      const data = await completeOnboarding();
      res.json({ data });
    } catch (error) {
      next(error);
    }
  });

  // Protected routes (session required)
  app.use(requireSession);

  const whatsappRoutes = (await import("./modules/whatsapp")).default;
  const contactsRoutes = (await import("./modules/contacts")).default;
  const templatesRoutes = (await import("./modules/templates")).default;
  const campaignsRoutes = (await import("./modules/campaigns")).default;
  const conversationsRoutes = (
    await import("./modules/conversations")
  ).default;
  const leadsRoutes = (await import("./modules/leads")).default;
  const automationRoutes = (
    await import("./modules/automation")
  ).default;
  const opsRoutes = (await import("./modules/ops")).default;
  const adminRoutes = (await import("./modules/admin")).default;
  const walletRoutes = (await import("./modules/wallet")).default;
  const partnersRoutes = (await import("./modules/partners")).default;
  const segmentsRoutes = (await import("./modules/segments")).default;
  const linksRoutes = (await import("./modules/links")).default;
  const teamsRoutes = (await import("./modules/teams")).default;
  const agentsRoutes = (await import("./modules/agents")).default;
  const cannedRepliesRoutes = (await import("./modules/canned-replies")).default;
  const assignmentRulesRoutes = (await import("./modules/assignment-rules")).default;
  const businessHoursRoutes = (await import("./modules/business-hours")).default;
  const realtimeRoutes = (await import("./modules/realtime")).default;
  const aiAgentRoutes = (await import("./modules/ai-agent")).default;
  const knowledgeBaseRoutes = (await import("./modules/knowledge-base")).default;
  const paymentsRoutes = (await import("./modules/payments")).default;
  const catalogueRoutes = (await import("./modules/catalogue")).default;
  const growthRoutes = (await import("./modules/growth")).default;
  const formsRoutes = (await import("./modules/forms")).default;
  const commerceRoutes = (await import("./modules/commerce")).default;
  const capiRoutes = (await import("./modules/capi")).default;

  app.use("/whatsapp", whatsappRoutes);
  app.use("/contacts", contactsRoutes);
  app.use("/templates", templatesRoutes);
  app.use("/campaigns", campaignsRoutes);
  app.use("/segments", segmentsRoutes);
  app.use("/links", linksRoutes);
  app.use("/conversations", conversationsRoutes);
  app.use("/leads", leadsRoutes);
  app.use("/automation", automationRoutes);
  app.use("/ops", opsRoutes);
  app.use("/admin", adminRoutes);
  app.use("/wallet", walletRoutes);
  app.use("/partners", partnersRoutes);
  app.use("/teams", teamsRoutes);
  app.use("/agents", agentsRoutes);
  app.use("/canned-replies", cannedRepliesRoutes);
  app.use("/assignment-rules", assignmentRulesRoutes);
  app.use("/business-hours", businessHoursRoutes);
  app.use("/realtime", realtimeRoutes);
  app.use("/ai-agent", aiAgentRoutes);
  app.use("/knowledge-base", knowledgeBaseRoutes);
  app.use("/payments", paymentsRoutes);
  app.use("/catalogue", catalogueRoutes);
  app.use("/growth", growthRoutes);
  app.use("/forms", formsRoutes);
  app.use("/commerce", commerceRoutes);
  app.use("/capi", capiRoutes);

  // Error handler (must be last)
  app.use(errorNormalization);

  return app;
}
