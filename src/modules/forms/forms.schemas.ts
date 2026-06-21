import { z } from "zod";

export const createFormSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(500).optional(),
  fields: z.array(z.object({
    name: z.string(),
    type: z.enum(["text", "email", "phone", "number", "select", "textarea"]),
    label: z.string(),
    required: z.boolean().optional(),
    options: z.array(z.string()).optional(),
  })),
  submitAction: z.enum(["create_contact", "add_tag", "webhook"]).optional(),
  submitConfig: z.record(z.unknown()).optional(),
});

export const submitFormSchema = z.record(z.string(), z.any());

export type CreateFormInput = z.infer<typeof createFormSchema>;
