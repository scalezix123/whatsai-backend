export const STORAGE_KEY = "wabiz-app-state";
export const COST_PER_MESSAGE = 0.5;
export const LOW_BALANCE_THRESHOLD = 500;

// Re-export for server-side usage
export { COST_PER_MESSAGE as default };

export interface User {
  name: string;
  email: string;
}

export type WhatsAppConnectionStatus = "pending" | "connected" | "disconnected";
export type WhatsAppBusinessVerificationStatus = "unverified" | "in_review" | "verified";
export type WhatsAppAccountReviewStatus = "pending_review" | "in_review" | "approved" | "rejected";
export type WhatsAppObaStatus = "not_applied" | "pending" | "approved" | "rejected";
export type WhatsAppAuthorizationStatus = "missing" | "active" | "expiring_soon" | "expired";
export type ConversationStatus = "Open" | "Pending" | "Resolved";
export type MessageDirection = "Inbound" | "Outbound";
export type LeadStatus = "New" | "Contacted" | "Qualified" | "Won" | "Lost";
export type LeadSource = "Meta Ads" | "WhatsApp Inbound" | "Campaign" | "Manual" | "Organic";
export type AutomationRuleType =
  | "auto_reply_first_inbound"
  | "auto_assign_new_lead"
  | "no_reply_reminder"
  | "follow_up_after_contacted";

export interface AutomationRuleConfig {
  message?: string;
  ownerName?: string;
  reminderHours?: number;
}

export interface AutomationRule {
  id: string;
  type: AutomationRuleType;
  name: string;
  enabled: boolean;
  config: AutomationRuleConfig;
  updatedAt: string;
}

export interface AutomationEvent {
  id: string;
  ruleType: AutomationRuleType;
  conversationId: string | null;
  leadId: string | null;
  status: "triggered" | "skipped" | "failed";
  summary: string;
  createdAt: string;
}

export interface WhatsAppConnection {
  connected: boolean;
  connectionStatus: WhatsAppConnectionStatus;
  businessVerificationStatus: WhatsAppBusinessVerificationStatus;
  accountReviewStatus: WhatsAppAccountReviewStatus;
  obaStatus: WhatsAppObaStatus;
  metaBusinessId: string;
  metaBusinessPortfolioId: string;
  wabaId: string;
  phoneNumberId: string;
  displayPhoneNumber: string;
  verifiedName: string;
  businessPortfolio: string;
  businessName: string;
  authorizationStatus: WhatsAppAuthorizationStatus;
  authorizationExpiresAt: string | null;
}

export interface Contact {
  id: string;
  name: string;
  phone: string;
  tags: string[];
}

export interface Template {
  id: string;
  name: string;
  category: "Marketing" | "Utility";
  status: "Approved" | "Pending" | "Rejected";
  language: string;
  preview: string;
}

export interface Campaign {
  id: string;
  name: string;
  templateId: string;
  contactIds: string[];
  status: "Draft" | "Scheduled" | "Sending" | "Delivered";
  date: string;
  estimatedCost: number;
  spent: number;
}

export interface Transaction {
  id: string;
  type: "credit" | "debit";
  desc: string;
  amount: number;
  date: string;
  balance: number;
}

export interface ActivityItem {
  id: string;
  title: string;
  subtitle: string;
  timestamp: string;
}

export interface Conversation {
  id: string;
  contactId: string | null;
  phone: string;
  displayName: string;
  status: ConversationStatus;
  source: LeadSource;
  assignedTo: string | null;
  lastMessagePreview: string;
  lastMessageAt: string;
  unreadCount: number;
}

export interface ConversationMessage {
  id: string;
  conversationId: string;
  direction: MessageDirection;
  messageType: string;
  body: string;
  status: string;
  sentAt: string;
}

export interface ConversationNote {
  id: string;
  conversationId: string;
  body: string;
  authorName: string;
  createdAt: string;
}

export interface ConversationEvent {
  id: string;
  conversationId: string;
  eventType: string;
  summary: string;
  actorName: string;
  createdAt: string;
}

export interface FailedSendLog {
  id: string;
  channel: "campaign" | "reply" | "automation" | "template";
  targetType: "contact" | "conversation" | "lead" | "workspace";
  targetId: string | null;
  destination: string;
  templateName: string | null;
  messageBody: string | null;
  errorMessage: string;
  status: "failed" | "retried" | "resolved";
  createdAt: string;
}

export interface OperationalLog {
  id: string;
  eventType: string;
  level: "info" | "warning" | "error";
  summary: string;
  createdAt: string;
}

export interface Lead {
  id: string;
  contactId: string | null;
  conversationId: string | null;
  fullName: string;
  phone: string;
  email: string;
  status: LeadStatus;
  source: LeadSource;
  sourceLabel: string;
  assignedTo: string | null;
  notes: string;
  createdAt: string;
}

// ── Partner System Types ──────────────────────────────────────
export type PartnerType = "affiliate" | "reseller" | "white_label" | "api_integration";
export type PartnerStatus = "pending" | "approved" | "rejected" | "suspended";
export type PartnerTier = "standard" | "silver" | "gold" | "platinum";
export type PayoutStatus = "pending" | "processing" | "completed" | "failed";
export type ReferralStatus = "pending" | "converted" | "expired";

export interface Partner {
  id: string;
  partnerType: PartnerType;
  status: PartnerStatus;
  companyName: string | null;
  contactName: string;
  email: string;
  phone: string | null;
  commissionRate: number;
  tier: PartnerTier;
  referralCode: string | null;
  totalReferrals: number;
  totalEarned: number;
  totalPaid: number;
  createdAt: string;
}

export interface PartnerReferral {
  id: string;
  partnerId: string;
  referredEmail: string;
  referredWorkspaceId: string | null;
  status: ReferralStatus;
  commissionAmount: number;
  convertedAt: string | null;
  createdAt: string;
}

export interface PartnerPayout {
  id: string;
  partnerId: string;
  amount: number;
  status: PayoutStatus;
  paymentMethod: string | null;
  paymentDetails: Record<string, unknown> | null;
  notes: string | null;
  processedAt: string | null;
  createdAt: string;
}

export interface PartnerDashboardStats {
  totalReferrals: number;
  activeCustomers: number;
  commissionEarned: number;
  pendingPayout: number;
  conversionRate: number;
  currentTier: PartnerTier;
}

export interface PartnerApplyInput {
  contactName: string;
  email: string;
  phone?: string;
  companyName?: string;
  partnerType: PartnerType;
  message?: string;
}

export interface AppState {
  user: User | null;
  onboardingComplete: boolean;
  walletBalance: number;
  totalSpent: number;
  messagesSent: number;
  contacts: Contact[];
  templates: Template[];
  campaigns: Campaign[];
  transactions: Transaction[];
  whatsApp: WhatsAppConnection;
  conversations: Conversation[];
  conversationMessages: ConversationMessage[];
  conversationNotes: ConversationNote[];
  conversationEvents: ConversationEvent[];
  failedSendLogs: FailedSendLog[];
  operationalLogs: OperationalLog[];
  leads: Lead[];
  automations: AutomationRule[];
  automationEvents: AutomationEvent[];
  recentActivity: ActivityItem[];
  // Partner system
  partners: Partner[];
  partnerProfile: Partner | null;
  partnerStats: PartnerDashboardStats | null;
  partnerReferrals: PartnerReferral[];
  partnerPayouts: PartnerPayout[];
}

export interface ActionResult {
  ok: boolean;
  message: string;
}

export interface UpdateConversationInput {
  id: string;
  status?: ConversationStatus;
  assignedTo?: string | null;
  unreadCount?: number;
  actorName?: string;
}

export interface UpdateLeadInput {
  id: string;
  status?: LeadStatus;
  assignedTo?: string | null;
  notes?: string;
}

export interface UpdateAutomationInput {
  type: AutomationRuleType;
  enabled: boolean;
  config: AutomationRuleConfig;
}

export interface AddConversationNoteInput {
  conversationId: string;
  body: string;
  authorName: string;
}

export interface RetryFailedSendInput {
  failedSendLogId: string;
}

export interface CreateCampaignInput {
  name: string;
  templateId: string;
  contactIds: string[];
  sendNow: boolean;
}

export type AddContactInput = Omit<Contact, "id">;
export type ConnectWhatsAppInput = Omit<WhatsAppConnection, "connected">;

export function emptyAppState(): AppState {
  return {
    user: null,
    onboardingComplete: false,
    walletBalance: 0,
    totalSpent: 0,
    messagesSent: 0,
    contacts: [],
    templates: [],
    campaigns: [],
    transactions: [],
    whatsApp: {
      connected: false,
      connectionStatus: "pending",
      businessVerificationStatus: "unverified",
      accountReviewStatus: "pending_review",
      obaStatus: "not_applied",
      metaBusinessId: "",
      metaBusinessPortfolioId: "",
      wabaId: "",
      phoneNumberId: "",
      displayPhoneNumber: "",
      verifiedName: "",
      businessPortfolio: "",
      businessName: "",
      authorizationStatus: "missing",
      authorizationExpiresAt: null,
    },
    conversations: [],
    conversationMessages: [],
    conversationNotes: [],
    conversationEvents: [],
    failedSendLogs: [],
    operationalLogs: [],
    leads: [],
    automations: [],
    automationEvents: [],
    recentActivity: [],
    partners: [],
    partnerProfile: null,
    partnerStats: null,
    partnerReferrals: [],
    partnerPayouts: [],
  };
}
