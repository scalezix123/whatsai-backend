import { z } from "zod";

export const createProductSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  price: z.number().positive(),
  currency: z.string().default("INR"),
  sku: z.string().max(100).optional(),
  imageUrl: z.string().url().optional(),
  category: z.string().max(100).optional(),
  inStock: z.boolean().optional(),
});

export const updateProductSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  price: z.number().positive().optional(),
  sku: z.string().max(100).optional(),
  imageUrl: z.string().url().optional(),
  category: z.string().max(100).optional(),
  inStock: z.boolean().optional(),
});

export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
