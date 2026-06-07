import express, { type Express } from "express";
import cors from "cors";
import {
  requestId,
  requireSession,
  errorNormalization,
} from "./middleware/index";

export async function createApp(): Promise<Express> {
  const app = express();

  // Global middleware
  app.use(cors({ origin: true, credentials: true }));
  app.use(express.json());
  app.use(requestId());

  // Public routes (no session required)
  const authRoutes = (await import("./modules/auth/index.ts")).default;
  app.use("/auth", authRoutes);  // /auth/signup, /auth/signout

  // Webhook routes (mostly public, but with signature verification)
  const metaRoutes = (await import("./modules/meta/index.ts")).default;
  app.use("/webhook", metaRoutes);

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

  const whatsappRoutes = (await import("./modules/whatsapp/index.ts")).default;
  const contactsRoutes = (await import("./modules/contacts/index.ts")).default;
  const templatesRoutes = (await import("./modules/templates/index.ts")).default;
  const campaignsRoutes = (await import("./modules/campaigns/index.ts")).default;
  const conversationsRoutes = (
    await import("./modules/conversations/index.ts")
  ).default;
  const leadsRoutes = (await import("./modules/leads/index.ts")).default;
  const automationRoutes = (
    await import("./modules/automation/index.ts")
  ).default;
  const opsRoutes = (await import("./modules/ops/index.ts")).default;
  const adminRoutes = (await import("./modules/admin/index.ts")).default;

  app.use("/whatsapp", whatsappRoutes);
  app.use("/contacts", contactsRoutes);
  app.use("/templates", templatesRoutes);
  app.use("/campaigns", campaignsRoutes);
  app.use("/conversations", conversationsRoutes);
  app.use("/leads", leadsRoutes);
  app.use("/automation", automationRoutes);
  app.use("/ops", opsRoutes);
  app.use("/admin", adminRoutes);

  // Health check
  app.get("/health", (req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // Error handler (must be last)
  app.use(errorNormalization);

  return app;
}
