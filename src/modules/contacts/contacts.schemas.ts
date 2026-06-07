import { z } from "zod";

export const createContactSchema = z.object({
  name: z.string().min(1, "Name required"),
  phone: z.string().min(1, "Phone number required"),
  tags: z.array(z.string()).default([]),
});

export type CreateContactInput = z.infer<typeof createContactSchema>;
