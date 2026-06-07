import { z } from "zod";

export const topUpSchema = z.object({
  amount: z.number().positive("Amount must be positive"),
  source: z.string().optional(),
});

export type TopUpInput = z.infer<typeof topUpSchema>;
