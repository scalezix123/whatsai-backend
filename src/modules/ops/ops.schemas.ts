import { z } from "zod";

export const retryFailedSendSchema = z.object({
  failedSendLogId: z.string().uuid("Invalid failed send log ID"),
});

export type RetryFailedSendInput = z.infer<typeof retryFailedSendSchema>;
