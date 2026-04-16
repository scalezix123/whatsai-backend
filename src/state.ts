import {
  CampaignStatus,
  MessageTemplateCategory,
  TemplateStatus,
  type PrismaClient,
  type User,
} from "@prisma/client";
import { COST_PER_MESSAGE, type AppState } from "./sharedTypes";

function getAuthorizationStatus(expiresAt: Date | null | undefined): "missing" | "active" | "expiring_soon" | "expired" {
  if (!expiresAt) return "missing";
  const expires = expiresAt.getTime();
  const now = Date.now();
  if (expires <= now) return "expired";
  if (expires - now <= 7 * 24 * 60 * 60 * 1000) return "expiring_soon";
  return "active";
}

function mapLeadSource(source: string) {
  if (source === "meta_ads") return "Meta Ads" as const;
  if (source === "campaign") return "Campaign" as const;
  if (source === "manual") return "Manual" as const;
  if (source === "organic") return "Organic" as const;
  return "WhatsApp Inbound" as const;
}

function mapConversationStatus(status: string) {
  if (status === "pending") return "Pending" as const;
  if (status === "resolved") return "Resolved" as const;
  return "Open" as const;
}

function mapLeadStatus(status: string) {
  if (status === "contacted") return "Contacted" as const;
  if (status === "qualified") return "Qualified" as const;
  if (status === "won") return "Won" as const;
  if (status === "lost") return "Lost" as const;
  return "New" as const;
}

function buildEmptyAppState(): AppState {
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

function parsePaymentDetails(value: string | null) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

const seedContacts = [
  { name: "Rahul Sharma", phone: "+91 98765 43210", tags: ["VIP", "Shopify"] },
  { name: "Priya Patel", phone: "+91 87654 32109", tags: ["New"] },
  { name: "Amit Kumar", phone: "+91 76543 21098", tags: ["Returning"] },
  { name: "Sneha Gupta", phone: "+91 65432 10987", tags: ["VIP", "D2C"] },
  { name: "Vikram Singh", phone: "+91 54321 09876", tags: ["Shopify"] },
  { name: "Anjali Reddy", phone: "+91 43210 98765", tags: ["New", "D2C"] },
];

const seedTemplates = [
  {
    name: "Order Confirmation",
    category: MessageTemplateCategory.utility,
    status: TemplateStatus.approved,
    language: "English",
    body: "Hi {{1}}, your order #{{2}} has been confirmed! Track here: {{3}}",
  },
  {
    name: "Diwali Sale Offer",
    category: MessageTemplateCategory.marketing,
    status: TemplateStatus.approved,
    language: "English",
    body: "Diwali Sale is LIVE! Get up to {{1}}% off on all products. Shop now: {{2}}",
  },
  {
    name: "Cart Reminder",
    category: MessageTemplateCategory.marketing,
    status: TemplateStatus.pending,
    language: "English",
    body: "Hey {{1}}, you left items in your cart! Complete your purchase before they sell out.",
  },
  {
    name: "Shipping Update",
    category: MessageTemplateCategory.utility,
    status: TemplateStatus.approved,
    language: "Hindi",
    body: "Hi {{1}}, your order has been shipped! Delivery by {{2}}. Track: {{3}}",
  },
];

export async function ensureSession(prisma: PrismaClient) {
  return prisma.appSession.upsert({
    where: { id: "primary" },
    update: {},
    create: { id: "primary" },
  });
}

export async function setCurrentUser(prisma: PrismaClient, userId: string | null) {
  await prisma.appSession.upsert({
    where: { id: "primary" },
    update: { currentUserId: userId },
    create: { id: "primary", currentUserId: userId },
  });
}

export async function getCurrentUser(prisma: PrismaClient) {
  const session = await prisma.appSession.findUnique({
    where: { id: "primary" },
    include: { currentUser: true },
  });

  return session?.currentUser ?? null;
}

export async function createWorkspaceForUser(
  prisma: PrismaClient,
  input: { name: string; email: string; passwordHash?: string | null },
) {
  const workspace = await prisma.workspace.create({
    data: {
      name: `${input.name}'s Workspace`,
      users: {
        create: {
          name: input.name,
          email: input.email,
          passwordHash: input.passwordHash ?? null,
        },
      },
    },
    include: {
      users: true,
    },
  });

  const user = workspace.users[0];
  await seedWorkspace(prisma, workspace.id);
  await setCurrentUser(prisma, user.id);
  return user;
}

export async function seedWorkspace(prisma: PrismaClient, workspaceId: string) {
  const existingTemplates = await prisma.messageTemplate.count({ where: { workspaceId } });
  if (existingTemplates > 0) {
    return;
  }

  const createdContacts = await Promise.all(
    seedContacts.map((contact) =>
      prisma.contact.create({
        data: {
          workspaceId,
          name: contact.name,
          phone: contact.phone,
          tags: {
            create: contact.tags.map((tag) => ({
              workspaceId,
              tag,
            })),
          },
        },
      }),
    ),
  );

  const createdTemplates = await Promise.all(
    seedTemplates.map((template) =>
      prisma.messageTemplate.create({
        data: {
          workspaceId,
          name: template.name,
          category: template.category,
          status: template.status,
          language: template.language,
          body: template.body,
        },
      }),
    ),
  );

  const deliveredRecipients = createdContacts.slice(0, 4);
  const sendingRecipients = createdContacts.slice(0, 2);
  const scheduledRecipients = createdContacts;

  const deliveredCampaign = await prisma.campaign.create({
    data: {
      workspaceId,
      templateId: createdTemplates[1].id,
      name: "Diwali Sale Blast",
      status: CampaignStatus.delivered,
      estimatedCost: 625,
      spent: 625,
      launchedAt: new Date("2026-03-20T09:00:00.000Z"),
      recipients: {
        create: deliveredRecipients.map((contact) => ({
          workspaceId,
          contactId: contact.id,
          status: "delivered",
          cost: COST_PER_MESSAGE,
        })),
      },
    },
  });

  const sendingCampaign = await prisma.campaign.create({
    data: {
      workspaceId,
      templateId: createdTemplates[0].id,
      name: "New Arrival Alert",
      status: CampaignStatus.sending,
      estimatedCost: 430,
      spent: 430,
      launchedAt: new Date("2026-03-21T11:30:00.000Z"),
      recipients: {
        create: sendingRecipients.map((contact) => ({
          workspaceId,
          contactId: contact.id,
          status: "sent",
          cost: COST_PER_MESSAGE,
        })),
      },
    },
  });

  await prisma.campaign.create({
    data: {
      workspaceId,
      templateId: createdTemplates[3].id,
      name: "Weekly Newsletter",
      status: CampaignStatus.scheduled,
      estimatedCost: 1600,
      spent: 0,
      scheduledFor: new Date("2026-03-25T10:00:00.000Z"),
      recipients: {
        create: scheduledRecipients.map((contact) => ({
          workspaceId,
          contactId: contact.id,
          status: "queued",
          cost: COST_PER_MESSAGE,
        })),
      },
    },
  });

  await prisma.walletTransaction.createMany({
    data: [
      {
        workspaceId,
        type: "credit",
        amount: 2000,
        description: "Wallet Recharge",
        referenceType: "manual_topup",
        balanceAfter: 4250,
        createdAt: new Date("2026-03-20T12:00:00.000Z"),
      },
      {
        workspaceId,
        type: "debit",
        amount: -625,
        description: "Diwali Sale Blast",
        referenceType: "campaign_send",
        referenceId: deliveredCampaign.id,
        balanceAfter: 2250,
        createdAt: new Date("2026-03-20T09:10:00.000Z"),
      },
      {
        workspaceId,
        type: "debit",
        amount: -1050,
        description: "Order Confirmation",
        referenceType: "campaign_send",
        referenceId: sendingCampaign.id,
        balanceAfter: 2875,
        createdAt: new Date("2026-03-18T08:00:00.000Z"),
      },
      {
        workspaceId,
        type: "credit",
        amount: 3000,
        description: "Wallet Recharge",
        referenceType: "manual_topup",
        balanceAfter: 3925,
        createdAt: new Date("2026-03-16T08:00:00.000Z"),
      },
    ],
  });
}

export async function buildAppState(prisma: PrismaClient, user: User | null): Promise<AppState> {
  if (!user) {
    return buildEmptyAppState();
  }

  const [workspace, conversationMessages, conversationNotes, conversationEvents] = await Promise.all([
    prisma.workspace.findUniqueOrThrow({
      where: { id: user.workspaceId },
      include: {
        contacts: {
          include: { tags: true },
          orderBy: { createdAt: "desc" },
        },
        templates: {
          orderBy: { createdAt: "desc" },
        },
        campaigns: {
          include: {
            recipients: true,
            template: true,
          },
          orderBy: { createdAt: "desc" },
        },
        walletTransactions: {
          orderBy: { createdAt: "desc" },
        },
        whatsAppConnections: {
          orderBy: { updatedAt: "desc" },
        },
        conversations: {
          orderBy: { lastMessageAt: "desc" },
        },
        leads: {
          orderBy: { createdAt: "desc" },
        },
        automationRules: {
          orderBy: { updatedAt: "desc" },
        },
        automationEvents: {
          orderBy: { createdAt: "desc" },
        },
        failedSendLogs: {
          orderBy: { createdAt: "desc" },
        },
        operationalLogs: {
          orderBy: { createdAt: "desc" },
        },
        partners: {
          orderBy: { createdAt: "desc" },
        },
        partnerReferrals: {
          orderBy: { createdAt: "desc" },
        },
        partnerPayouts: {
          orderBy: { createdAt: "desc" },
        },
        metaAuthorizations: true,
      },
    }),
    prisma.conversationMessage.findMany({
      where: { workspaceId: user.workspaceId },
      orderBy: { sentAt: "asc" },
    }),
    prisma.conversationNote.findMany({
      where: { workspaceId: user.workspaceId },
      orderBy: { createdAt: "desc" },
    }),
    prisma.conversationEvent.findMany({
      where: { workspaceId: user.workspaceId },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const latestConnection = workspace.whatsAppConnections[0];
  const authorization = workspace.metaAuthorizations;
  const walletTransactions = workspace.walletTransactions;
  const walletBalance = walletTransactions[0]?.balanceAfter ?? 0;
  const totalSpent = Math.abs(
    walletTransactions
      .filter((tx) => tx.type === "debit")
      .reduce((sum, tx) => sum + Number(tx.amount), 0),
  );
  const messagesSent = workspace.campaigns.reduce((sum, campaign) => {
    if (campaign.status === CampaignStatus.draft) {
      return sum;
    }
    return sum + campaign.recipients.length;
  }, 0);

  const partnerProfileRecord = workspace.partners.find((partner) => partner.userId === user.id) ?? null;
  const partnerReferrals = partnerProfileRecord
    ? workspace.partnerReferrals.filter((referral) => referral.partnerId === partnerProfileRecord.id)
    : [];
  const partnerPayouts = partnerProfileRecord
    ? workspace.partnerPayouts.filter((payout) => payout.partnerId === partnerProfileRecord.id)
    : [];

  const partnerProfile = partnerProfileRecord
    ? {
        id: partnerProfileRecord.id,
        partnerType: partnerProfileRecord.partnerType,
        status: partnerProfileRecord.status,
        companyName: partnerProfileRecord.companyName,
        contactName: partnerProfileRecord.contactName,
        email: partnerProfileRecord.email,
        phone: partnerProfileRecord.phone,
        commissionRate: partnerProfileRecord.commissionRate,
        tier: partnerProfileRecord.tier,
        referralCode: partnerProfileRecord.referralCode,
        totalReferrals: partnerProfileRecord.totalReferrals,
        totalEarned: partnerProfileRecord.totalEarned,
        totalPaid: partnerProfileRecord.totalPaid,
        createdAt: partnerProfileRecord.createdAt.toISOString(),
      }
    : null;

  const partnerStats = partnerProfileRecord
    ? {
        totalReferrals: partnerReferrals.length,
        activeCustomers: partnerReferrals.filter((referral) => referral.status === "converted").length,
        commissionEarned: partnerReferrals.reduce((sum, referral) => sum + referral.commissionAmount, 0),
        pendingPayout: Math.max(
          partnerReferrals.reduce((sum, referral) => sum + referral.commissionAmount, 0)
            - partnerPayouts
              .filter((payout) => payout.status === "completed")
              .reduce((sum, payout) => sum + payout.amount, 0),
          0,
        ),
        conversionRate: partnerReferrals.length > 0
          ? Math.round((partnerReferrals.filter((referral) => referral.status === "converted").length / partnerReferrals.length) * 100)
          : 0,
        currentTier: partnerProfileRecord.tier,
      }
    : null;

  const recentActivity = [
    ...workspace.campaigns.slice(0, 3).map((campaign) => ({
      id: `campaign-${campaign.id}`,
      title: campaign.status === CampaignStatus.draft ? "Campaign drafted" : "Campaign updated",
      subtitle: `${campaign.name} is currently ${campaign.status}`,
      timestamp: (campaign.launchedAt ?? campaign.scheduledFor ?? campaign.createdAt).toLocaleDateString("en-IN", { dateStyle: "medium" }),
    })),
    ...walletTransactions.slice(0, 3).map((transaction) => ({
      id: `wallet-${transaction.id}`,
      title: transaction.type === "credit" ? "Wallet recharged" : "Wallet debited",
      subtitle: transaction.description,
      timestamp: transaction.createdAt.toLocaleDateString("en-IN", { dateStyle: "medium" }),
    })),
  ].slice(0, 6);

  return {
    user: {
      name: user.name,
      email: user.email,
    },
    onboardingComplete: user.onboardingComplete,
    walletBalance,
    totalSpent,
    messagesSent,
    contacts: workspace.contacts.map((contact) => ({
      id: contact.id,
      name: contact.name,
      phone: contact.phone,
      tags: contact.tags.map((tag) => tag.tag),
    })),
    templates: workspace.templates.map((template) => ({
      id: template.id,
      name: template.name,
      category: template.category === MessageTemplateCategory.marketing ? "Marketing" : "Utility",
      status: template.status === TemplateStatus.approved
        ? "Approved"
        : template.status === TemplateStatus.pending
          ? "Pending"
          : "Rejected",
      language: template.language,
      preview: template.body,
    })),
    campaigns: workspace.campaigns.map((campaign) => ({
      id: campaign.id,
      name: campaign.name,
      templateId: campaign.templateId,
      contactIds: campaign.recipients.map((recipient) => recipient.contactId),
      status: campaign.status === CampaignStatus.draft
        ? "Draft"
        : campaign.status === CampaignStatus.scheduled
          ? "Scheduled"
          : campaign.status === CampaignStatus.sending
            ? "Sending"
            : "Delivered",
      date: (campaign.launchedAt ?? campaign.scheduledFor ?? campaign.createdAt).toISOString(),
      estimatedCost: campaign.estimatedCost,
      spent: campaign.spent,
    })),
    transactions: walletTransactions.map((transaction) => ({
      id: transaction.id,
      type: transaction.type === "credit" ? "credit" : "debit",
      desc: transaction.description,
      amount: Number(transaction.amount),
      date: transaction.createdAt.toISOString(),
      balance: Number(transaction.balanceAfter),
    })),
    whatsApp: latestConnection
      ? {
          connected: latestConnection.status === "connected",
          connectionStatus: latestConnection.status,
          businessVerificationStatus: (latestConnection.business_verification_status as "unverified" | "in_review" | "verified") ?? "unverified",
          accountReviewStatus: (latestConnection.account_review_status as "pending_review" | "in_review" | "approved" | "rejected") ?? "pending_review",
          obaStatus: (latestConnection.oba_status as "not_applied" | "pending" | "approved" | "rejected") ?? "not_applied",
          metaBusinessId: latestConnection.metaBusinessId ?? "",
          metaBusinessPortfolioId: latestConnection.metaBusinessPortfolioId ?? "",
          wabaId: latestConnection.wabaId ?? "",
          phoneNumberId: latestConnection.phone_number_id ?? "",
          displayPhoneNumber: latestConnection.display_phone_number,
          verifiedName: latestConnection.verified_name ?? "",
          businessPortfolio: latestConnection.business_portfolio,
          businessName: latestConnection.business_name,
          authorizationStatus: getAuthorizationStatus(authorization?.expiresAt),
          authorizationExpiresAt: authorization?.expiresAt?.toISOString() ?? null,
        }
      : buildEmptyAppState().whatsApp,
    conversations: workspace.conversations.map((conversation) => ({
      id: conversation.id,
      contactId: conversation.contactId,
      phone: conversation.phone,
      displayName: conversation.displayName,
      status: mapConversationStatus(conversation.status),
      source: mapLeadSource(conversation.source),
      assignedTo: conversation.assignedTo,
      lastMessagePreview: conversation.lastMessagePreview,
      lastMessageAt: conversation.lastMessageAt.toISOString(),
      unreadCount: conversation.unreadCount,
    })),
    conversationMessages: conversationMessages.map((message) => ({
      id: message.id,
      conversationId: message.conversationId,
      direction: message.direction === "outbound" ? "Outbound" : "Inbound",
      messageType: message.messageType,
      body: message.body,
      status: message.status,
      sentAt: message.sentAt.toISOString(),
    })),
    conversationNotes: conversationNotes.map((note) => ({
      id: note.id,
      conversationId: note.conversationId,
      body: note.body,
      authorName: note.authorName,
      createdAt: note.createdAt.toISOString(),
    })),
    conversationEvents: conversationEvents.map((event) => ({
      id: event.id,
      conversationId: event.conversationId,
      eventType: event.eventType,
      summary: event.summary,
      actorName: event.actorName,
      createdAt: event.createdAt.toISOString(),
    })),
    failedSendLogs: workspace.failedSendLogs.map((log) => ({
      id: log.id,
      channel: log.channel as "campaign" | "reply" | "automation" | "template",
      targetType: log.targetType as "contact" | "conversation" | "lead" | "workspace",
      targetId: log.targetId,
      destination: log.destination,
      templateName: log.templateName,
      messageBody: log.messageBody,
      errorMessage: log.errorMessage,
      status: log.status as "failed" | "retried" | "resolved",
      createdAt: log.createdAt.toISOString(),
    })),
    operationalLogs: workspace.operationalLogs.map((log) => ({
      id: log.id,
      eventType: log.eventType,
      level: log.level as "info" | "warning" | "error",
      summary: log.summary,
      createdAt: log.createdAt.toISOString(),
    })),
    leads: workspace.leads.map((lead) => ({
      id: lead.id,
      contactId: lead.contactId,
      conversationId: lead.conversationId,
      fullName: lead.fullName,
      phone: lead.phone,
      email: lead.email,
      status: mapLeadStatus(lead.status),
      source: mapLeadSource(lead.source),
      sourceLabel: lead.sourceLabel,
      assignedTo: lead.assignedTo,
      notes: lead.notes,
      createdAt: lead.createdAt.toISOString(),
    })),
    automations: workspace.automationRules.map((rule) => ({
      id: rule.id,
      type: rule.ruleType,
      name: rule.name,
      enabled: rule.enabled,
      config: (typeof rule.config === "object" && rule.config ? rule.config : {}) as {
        message?: string;
        ownerName?: string;
        reminderHours?: number;
      },
      updatedAt: rule.updatedAt.toISOString(),
    })),
    automationEvents: workspace.automationEvents.map((event) => ({
      id: event.id,
      ruleType: event.ruleType,
      conversationId: event.conversationId,
      leadId: event.leadId,
      status: event.status as "triggered" | "skipped" | "failed",
      summary: event.summary,
      createdAt: event.createdAt.toISOString(),
    })),
    recentActivity,
    partners: workspace.partners.map((partner) => ({
      id: partner.id,
      partnerType: partner.partnerType,
      status: partner.status,
      companyName: partner.companyName,
      contactName: partner.contactName,
      email: partner.email,
      phone: partner.phone,
      commissionRate: partner.commissionRate,
      tier: partner.tier,
      referralCode: partner.referralCode,
      totalReferrals: partner.totalReferrals,
      totalEarned: partner.totalEarned,
      totalPaid: partner.totalPaid,
      createdAt: partner.createdAt.toISOString(),
    })),
    partnerProfile,
    partnerStats,
    partnerReferrals: partnerReferrals.map((referral) => ({
      id: referral.id,
      partnerId: referral.partnerId,
      referredEmail: referral.referredEmail,
      referredWorkspaceId: referral.referredWorkspaceId,
      status: referral.status,
      commissionAmount: referral.commissionAmount,
      convertedAt: referral.convertedAt?.toISOString() ?? null,
      createdAt: referral.createdAt.toISOString(),
    })),
    partnerPayouts: partnerPayouts.map((payout) => ({
      id: payout.id,
      partnerId: payout.partnerId,
      amount: payout.amount,
      status: payout.status,
      paymentMethod: payout.paymentMethod,
      paymentDetails: parsePaymentDetails(payout.paymentDetails),
      notes: payout.notes,
      processedAt: payout.processedAt?.toISOString() ?? null,
      createdAt: payout.createdAt.toISOString(),
    })),
  };
}
