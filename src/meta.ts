const metaApiVersion = process.env.META_API_VERSION || process.env.VITE_META_API_VERSION || "v22.0";
const metaAppId = process.env.META_APP_ID || process.env.VITE_META_APP_ID;
const metaAppSecret = process.env.META_APP_SECRET;
const metaWebhookVerifyToken = process.env.META_WEBHOOK_VERIFY_TOKEN;

function requireMetaServerConfig() {
  if (!metaAppId || !metaAppSecret) {
    throw new Error("Meta server configuration is incomplete. Add META_APP_ID and META_APP_SECRET.");
  }

  return {
    appId: metaAppId,
    appSecret: metaAppSecret,
    apiVersion: metaApiVersion,
  };
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const data = await response.json() as T & { error?: { message?: string } };

  if (!response.ok) {
    throw new Error(data.error?.message || `Meta request failed with status ${response.status}.`);
  }

  return data;
}

function mapReviewStatus(value: string | null | undefined) {
  const normalized = value?.toLowerCase();

  if (normalized === "approved") {
    return "approved" as const;
  }

  if (normalized === "rejected") {
    return "rejected" as const;
  }

  if (normalized?.includes("review")) {
    return "in_review" as const;
  }

  return "pending_review" as const;
}

function mapBusinessVerificationStatus(value: string | null | undefined) {
  const normalized = value?.toLowerCase();

  if (normalized === "verified") {
    return "verified" as const;
  }

  if (normalized?.includes("review")) {
    return "in_review" as const;
  }

  return "unverified" as const;
}

function mapObaStatus(value: boolean | string | null | undefined) {
  if (value === true || String(value).toLowerCase() === "true") {
    return "approved" as const;
  }

  return "not_applied" as const;
}

interface MetaTokenExchangeResponse {
  access_token: string;
  token_type?: string;
}

interface MetaBusinessRecord {
  id: string;
  name?: string;
  verification_status?: string;
}

interface MetaPhoneNumberRecord {
  id?: string;
  display_phone_number?: string;
  verified_name?: string;
  name_status?: string;
  is_official_business_account?: boolean;
}

interface MetaWabaRecord {
  id: string;
  name?: string;
  phone_numbers?: { data?: MetaPhoneNumberRecord[] };
}

interface MetaBusinessDetailsResponse {
  id: string;
  name?: string;
  verification_status?: string;
  owned_whatsapp_business_accounts?: { data?: MetaWabaRecord[] };
}

export interface MetaExchangePayload {
  authorization: {
    accessToken: string;
    tokenType: string | null;
  };
  candidate: {
    metaBusinessId: string;
    metaBusinessPortfolioId: string;
    wabaId: string;
    phoneNumberId: string;
    displayPhoneNumber: string;
    verifiedName: string;
    businessPortfolio: string;
    businessName: string;
    connectionStatus: "connected";
    businessVerificationStatus: "unverified" | "in_review" | "verified";
    accountReviewStatus: "pending_review" | "in_review" | "approved" | "rejected";
    obaStatus: "not_applied" | "pending" | "approved" | "rejected";
    authorizationStatus: "active";
    authorizationExpiresAt: string;
  };
  raw: {
    businesses: MetaBusinessRecord[];
    whatsappBusinesses: MetaWabaRecord[];
  };
}

export interface MetaTemplateSendInput {
  accessToken: string;
  phoneNumberId: string;
  to: string;
  templateName: string;
  languageCode: string;
  bodyParameters?: string[];
  buttonParameters?: Array<{ type: string; payload: string }>;
}

export interface MetaTextSendInput {
  accessToken: string;
  phoneNumberId: string;
  to: string;
  body: string;
}

export interface MetaButton {
  type: "reply";
  reply: {
    id: string;
    title: string;
  };
}

export interface MetaInteractiveSendInput {
  accessToken: string;
  phoneNumberId: string;
  to: string;
  type: "button" | "list";
  header?: string;
  body: string;
  footer?: string;
  buttons?: MetaButton[];
}

export function mapTemplateLanguageToMetaCode(language: string) {
  const normalized = language.trim().toLowerCase();

  if (normalized === "hindi" || normalized === "hi") {
    return "hi";
  }

  return "en";
}

export function buildTemplateBodyParameters(templateBody: string, contactName: string) {
  const placeholderMatches = templateBody.match(/\{\{\d+\}\}/g) ?? [];
  return placeholderMatches.map((_, index) => {
    if (index === 0) {
      return contactName;
    }

    if (index === 1) {
      return "WaBiz";
    }

    if (index === 2) {
      return "https://wabiz.app";
    }

    return `Value ${index + 1}`;
  });
}

function resolveTemplateVariableValue(value: string, input: { contactName: string; contactPhone: string }) {
  const normalized = value.trim().toLowerCase();

  if (normalized === "{{contact.name}}") {
    return input.contactName;
  }

  if (normalized === "{{contact.phone}}") {
    return input.contactPhone;
  }

  return value;
}

export function buildCampaignBodyParameters(input: {
  templateBody: string;
  contactName: string;
  contactPhone: string;
  bodyParameters?: string[];
}) {
  const placeholderMatches = input.templateBody.match(/\{\{\d+\}\}/g) ?? [];
  const providedParameters = input.bodyParameters ?? [];

  if (providedParameters.length === 0) {
    return buildTemplateBodyParameters(input.templateBody, input.contactName);
  }

  return placeholderMatches.map((_, index) => {
    const providedValue = providedParameters[index];
    if (providedValue && providedValue.trim()) {
      return resolveTemplateVariableValue(providedValue, {
        contactName: input.contactName,
        contactPhone: input.contactPhone,
      });
    }

    if (index === 0) {
      return input.contactName;
    }

    return `Value ${index + 1}`;
  });
}

export async function exchangeMetaCode(input: { code: string; redirectUri: string }): Promise<MetaExchangePayload> {
  const config = requireMetaServerConfig();
  const tokenUrl = new URL(`https://graph.facebook.com/${config.apiVersion}/oauth/access_token`);
  tokenUrl.searchParams.set("client_id", config.appId);
  tokenUrl.searchParams.set("client_secret", config.appSecret);
  tokenUrl.searchParams.set("redirect_uri", input.redirectUri);
  tokenUrl.searchParams.set("code", input.code);

  const tokenData = await fetchJson<MetaTokenExchangeResponse>(tokenUrl.toString());
  const accessToken = tokenData.access_token;

  const businessesResponse = await fetchJson<{ data?: MetaBusinessRecord[] }>(
    `https://graph.facebook.com/${config.apiVersion}/me/businesses?fields=id,name,verification_status&access_token=${encodeURIComponent(accessToken)}`,
  );

  const businesses = businessesResponse.data ?? [];
  const businessDetails = await Promise.all(
    businesses.map((business) =>
      fetchJson<MetaBusinessDetailsResponse>(
        `https://graph.facebook.com/${config.apiVersion}/${business.id}?fields=id,name,verification_status,owned_whatsapp_business_accounts{id,name,phone_numbers{id,display_phone_number,verified_name,name_status,is_official_business_account}}&access_token=${encodeURIComponent(accessToken)}`,
      ),
    ),
  );

  const whatsappBusinesses = businessDetails.flatMap((business) => business.owned_whatsapp_business_accounts?.data ?? []);
  const firstBusiness = businessDetails[0];
  const firstWaba = whatsappBusinesses[0];
  const firstPhone = firstWaba?.phone_numbers?.data?.[0];

  return {
    authorization: {
      accessToken,
      tokenType: tokenData.token_type ?? null,
    },
    candidate: {
      metaBusinessId: firstBusiness?.id ?? "",
      metaBusinessPortfolioId: firstBusiness?.id ?? "",
      wabaId: firstWaba?.id ?? "",
      phoneNumberId: firstPhone?.id || (() => { throw new Error("No phone number found in the Meta authorization. Please ensure you have at least one phone number registered in your WhatsApp Business Account."); })(),
      displayPhoneNumber: firstPhone?.display_phone_number || (() => { throw new Error("No display phone number found in the Meta authorization."); })(),
      verifiedName: firstPhone?.verified_name ?? "",
      businessPortfolio: firstBusiness?.name ?? "",
      businessName: firstBusiness?.name ?? firstWaba?.name ?? "",
      connectionStatus: "connected",
      businessVerificationStatus: mapBusinessVerificationStatus(firstBusiness?.verification_status),
      accountReviewStatus: mapReviewStatus(firstPhone?.name_status),
      obaStatus: mapObaStatus(firstPhone?.is_official_business_account),
      authorizationStatus: "active",
      authorizationExpiresAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString(),
    },
    raw: {
      businesses,
      whatsappBusinesses,
    },
  };
}

export function getMetaWebhookVerifyToken() {
  return metaWebhookVerifyToken;
}

export async function sendMetaTemplateMessage(input: MetaTemplateSendInput) {
  const config = requireMetaServerConfig();
  const url = `https://graph.facebook.com/${config.apiVersion}/${input.phoneNumberId}/messages`;

  const components = input.bodyParameters && input.bodyParameters.length > 0
    ? [{
        type: "body",
        parameters: input.bodyParameters.map((value) => ({
          type: "text",
          text: value,
        })),
      }]
    : [];

  return fetchJson(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: input.to,
      type: "template",
      template: {
        name: input.templateName,
        language: {
          code: input.languageCode,
        },
        ...(components.length > 0 ? { components } : {}),
      },
    }),
  });
}

export async function sendMetaTextMessage(input: MetaTextSendInput) {
  const config = requireMetaServerConfig();
  const url = `https://graph.facebook.com/${config.apiVersion}/${input.phoneNumberId}/messages`;

  return fetchJson(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: input.to,
      type: "text",
      text: {
        preview_url: false,
        body: input.body,
      },
    }),
  });
}

export async function sendMetaInteractiveMessage(input: MetaInteractiveSendInput) {
  const config = requireMetaServerConfig();
  const url = `https://graph.facebook.com/${config.apiVersion}/${input.phoneNumberId}/messages`;

  const interactive: any = {
    type: input.type,
    body: { text: input.body },
  };

  if (input.header) {
    interactive.header = { type: "text", text: input.header };
  }
  if (input.footer) {
    interactive.footer = { text: input.footer };
  }

  if (input.type === "button" && input.buttons) {
    interactive.action = {
      buttons: input.buttons,
    };
  }

  return fetchJson(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: input.to,
      type: "interactive",
      interactive,
    }),
  });
}
