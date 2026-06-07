import { z } from "zod";

export const applyPartnerSchema = z.object({
  contactName: z.string().min(1, "Contact name required"),
  email: z.string().email("Invalid email"),
  phone: z.string().optional(),
  companyName: z.string().optional(),
  partnerType: z.enum([
    "affiliate",
    "reseller",
    "white_label",
    "api_integration",
  ]),
  message: z.string().optional(),
});

export const publicApplySchema = z.object({
  contactName: z.string().min(1, "Contact name required"),
  email: z.string().email("Invalid email"),
  phone: z.string().optional(),
  companyName: z.string().optional(),
  partnerType: z.enum([
    "affiliate",
    "reseller",
    "white_label",
    "api_integration",
  ]),
  message: z.string().optional(),
  password: z.string().min(8, "Password must be at least 8 characters long."),
});

export const commissionSchema = z.object({
  commissionRate: z.number().min(0).max(100),
});

export const payoutRequestSchema = z.object({
  amount: z.number().positive("Amount must be positive"),
  paymentMethod: z.string().min(1),
  paymentDetails: z.record(z.unknown()),
});

export const brandingSchema = z.object({
  brandName: z.string().optional(),
  logoUrl: z.string().optional(),
  primaryColor: z.string().optional(),
  supportEmail: z.string().optional(),
});

export type ApplyPartnerInput = z.infer<typeof applyPartnerSchema>;
export type PublicApplyInput = z.infer<typeof publicApplySchema>;
export type CommissionInput = z.infer<typeof commissionSchema>;
export type PayoutRequestInput = z.infer<typeof payoutRequestSchema>;
export type BrandingInput = z.infer<typeof brandingSchema>;
