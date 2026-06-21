import agentsRoutes from "./agents.routes";
import agentsAnalyticsRoutes from "./agents.analytics.routes";
import { Router } from "express";

const combined = Router();
combined.use("/", agentsRoutes);
combined.use("/", agentsAnalyticsRoutes);

export default combined;
