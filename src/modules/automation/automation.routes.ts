import { Router } from "express";
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
} from "./automation.service";

const router = Router();

router.get("/definitions", async (_req, res, next) => {
  try {
    const definitions = await getAutomationDefinitions();
    res.json(definitions);
  } catch (error) {
    next(error);
  }
});

router.post("/definitions", async (req, res, next) => {
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

export default router;
