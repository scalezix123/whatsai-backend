import { z } from "zod";

export const upsertBusinessHoursSchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  openTime: z.string().regex(/^\d{2}:\d{2}$/),
  closeTime: z.string().regex(/^\d{2}:\d{2}$/),
  isClosed: z.boolean().optional(),
  timezone: z.string().optional(),
  welcomeMessage: z.string().max(1000).optional(),
  offHoursMessage: z.string().max(1000).optional(),
});

export const bulkUpsertBusinessHoursSchema = z.array(upsertBusinessHoursSchema);

export type UpsertBusinessHoursInput = z.infer<typeof upsertBusinessHoursSchema>;
