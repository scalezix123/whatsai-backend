import { z } from "zod";

// Helper to convert Zod schema to OpenAPI schema
function zodToOpenAPI(schema: any): any {
  if (schema instanceof z.ZodString) {
    return { type: "string" };
  }
  if (schema instanceof z.ZodNumber) {
    return { type: "number" };
  }
  if (schema instanceof z.ZodBoolean) {
    return { type: "boolean" };
  }
  if (schema instanceof z.ZodArray) {
    return {
      type: "array",
      items: zodToOpenAPI((schema as any)._def.type),
    };
  }
  if (schema instanceof z.ZodObject) {
    const shape = (schema as any).shape;
    const properties: any = {};
    const required: string[] = [];

    for (const [key, value] of Object.entries(shape)) {
      const field = value as any;
      properties[key] = zodToOpenAPI(field);

      if (!field.isOptional && !field.isNullable) {
        required.push(key);
      }
    }

    return {
      type: "object",
      properties,
      ...(required.length > 0 && { required }),
    };
  }
  if ((schema as any)._def?.typeName === "ZodEnum") {
    return {
      type: "string",
      enum: (schema as any)._def.values,
    };
  }

  return { type: "string" };
}

export function generateOpenAPISpec() {
  return {
    openapi: "3.0.0",
    info: {
      title: "WhatsApp Lead Management API",
      version: "1.0.0",
      description: "REST API for WhatsApp-based lead management and automation platform",
      contact: {
        name: "API Support",
        email: "support@whatsappfly.com",
      },
    },
    servers: [
      {
        url: "http://localhost:3001",
        description: "Development server",
      },
      {
        url: "https://api.whatsappfly.com",
        description: "Production server",
      },
    ],
    paths: {
      "/health": {
        get: {
          summary: "Health check",
          description: "Check if the server is running",
          tags: ["System"],
          responses: {
            "200": {
              description: "Server is healthy",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      status: { type: "string", example: "ok" },
                      timestamp: { type: "string", format: "date-time" },
                    },
                  },
                },
              },
            },
          },
        },
      },

      // Auth endpoints
      "/auth/signup": {
        post: {
          summary: "User signup",
          tags: ["Authentication"],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    name: { type: "string", minLength: 1 },
                    email: { type: "string", format: "email" },
                    password: { type: "string", minLength: 8 },
                  },
                  required: ["name", "email", "password"],
                },
              },
            },
          },
          responses: {
            "201": {
              description: "User created successfully",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      data: {
                        type: "object",
                        properties: {
                          user: { $ref: "#/components/schemas/User" },
                          onboardingComplete: { type: "boolean" },
                        },
                      },
                    },
                  },
                },
              },
            },
            "400": { $ref: "#/components/responses/ValidationError" },
          },
        },
      },

      "/auth/signout": {
        post: {
          summary: "User logout",
          tags: ["Authentication"],
          responses: {
            "200": { description: "Logged out successfully" },
          },
        },
      },

      // WhatsApp endpoints
      "/whatsapp/health": {
        get: {
          summary: "WhatsApp connection health",
          tags: ["WhatsApp"],
          security: [{ bearerAuth: [] }],
          responses: {
            "200": {
              description: "Connection health status",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      data: {
                        type: "object",
                        properties: {
                          status: { type: "string", enum: ["connected", "disconnected", "not_connected"] },
                          phoneNumberId: { type: "string" },
                          displayPhoneNumber: { type: "string" },
                          businessName: { type: "string" },
                          tokenExpired: { type: "boolean" },
                          tokenExpiring: { type: "boolean" },
                          tokenExpiresAt: { type: "string", format: "date-time" },
                        },
                      },
                    },
                  },
                },
              },
            },
            "401": { $ref: "#/components/responses/Unauthorized" },
          },
        },
      },

      "/whatsapp/test-send": {
        post: {
          summary: "Send test message",
          tags: ["WhatsApp"],
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    to: { type: "string", description: "Phone number with country code" },
                    messageType: { type: "string", enum: ["text", "template"] },
                    body: { type: "string" },
                    templateName: { type: "string" },
                    language: { type: "string", default: "en" },
                  },
                  required: ["to", "messageType"],
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Test message sent",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      data: {
                        type: "object",
                        properties: {
                          success: { type: "boolean" },
                          messageId: { type: "string" },
                          status: { type: "string" },
                        },
                      },
                    },
                  },
                },
              },
            },
            "400": { $ref: "#/components/responses/ValidationError" },
            "401": { $ref: "#/components/responses/Unauthorized" },
          },
        },
      },

      "/contacts": {
        get: {
          summary: "List contacts",
          tags: ["Contacts"],
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: "page", in: "query", schema: { type: "integer", default: 1 } },
            { name: "limit", in: "query", schema: { type: "integer", default: 20 } },
            { name: "search", in: "query", schema: { type: "string" } },
            { name: "tags", in: "query", schema: { type: "array", items: { type: "string" } } },
            { name: "optInStatus", in: "query", schema: { type: "string", enum: ["opt_in", "opt_out", "unknown"] } },
          ],
          responses: {
            "200": {
              description: "List of contacts",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      data: {
                        type: "object",
                        properties: {
                          total: { type: "integer" },
                          contacts: { type: "array", items: { $ref: "#/components/schemas/Contact" } },
                          page: { type: "integer" },
                          limit: { type: "integer" },
                        },
                      },
                    },
                  },
                },
              },
            },
            "401": { $ref: "#/components/responses/Unauthorized" },
          },
        },
        post: {
          summary: "Create contact",
          tags: ["Contacts"],
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    phone: { type: "string" },
                    email: { type: "string", format: "email" },
                    tags: { type: "array", items: { type: "string" } },
                  },
                  required: ["name", "phone"],
                },
              },
            },
          },
          responses: {
            "201": {
              description: "Contact created",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      data: { $ref: "#/components/schemas/Contact" },
                    },
                  },
                },
              },
            },
            "400": { $ref: "#/components/responses/ValidationError" },
            "401": { $ref: "#/components/responses/Unauthorized" },
          },
        },
      },

      "/templates": {
        get: {
          summary: "List templates",
          tags: ["Templates"],
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: "page", in: "query", schema: { type: "integer", default: 1 } },
            { name: "limit", in: "query", schema: { type: "integer", default: 20 } },
            { name: "search", in: "query", schema: { type: "string" } },
            { name: "status", in: "query", schema: { type: "string", enum: ["DRAFT", "SUBMITTED", "APPROVED", "REJECTED"] } },
          ],
          responses: {
            "200": {
              description: "List of templates",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      data: {
                        type: "object",
                        properties: {
                          total: { type: "integer" },
                          templates: { type: "array" },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        post: {
          summary: "Create template",
          tags: ["Templates"],
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    bodyText: { type: "string" },
                    category: { type: "string", enum: ["MARKETING", "OTP", "TRANSACTIONAL", "AUTHENTICATION"] },
                  },
                  required: ["name", "bodyText"],
                },
              },
            },
          },
          responses: {
            "201": { description: "Template created" },
            "400": { $ref: "#/components/responses/ValidationError" },
          },
        },
      },

      "/campaigns": {
        post: {
          summary: "Create campaign",
          tags: ["Campaigns"],
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    templateId: { type: "string" },
                    recipientIds: { type: "array", items: { type: "string" } },
                  },
                  required: ["name", "templateId", "recipientIds"],
                },
              },
            },
          },
          responses: {
            "201": { description: "Campaign created" },
          },
        },
      },

      "/conversations": {
        get: {
          summary: "List conversations",
          tags: ["Conversations"],
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: "page", in: "query", schema: { type: "integer", default: 1 } },
            { name: "status", in: "query", schema: { type: "string", enum: ["open", "closed", "archived"] } },
          ],
          responses: {
            "200": { description: "List of conversations" },
          },
        },
      },

      "/leads": {
        get: {
          summary: "List leads",
          tags: ["Leads"],
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: "page", in: "query", schema: { type: "integer", default: 1 } },
            { name: "status", in: "query", schema: { type: "string", enum: ["new", "contacted", "qualified", "won", "lost"] } },
          ],
          responses: {
            "200": { description: "List of leads" },
          },
        },
      },
    },

    components: {
      schemas: {
        User: {
          type: "object",
          properties: {
            id: { type: "string" },
            name: { type: "string" },
            email: { type: "string", format: "email" },
            role: { type: "string", enum: ["ADMIN", "USER", "PARTNER"] },
            createdAt: { type: "string", format: "date-time" },
          },
        },
        Contact: {
          type: "object",
          properties: {
            id: { type: "string" },
            name: { type: "string" },
            phone: { type: "string" },
            email: { type: "string", format: "email" },
            tags: { type: "array", items: { type: "string" } },
            optInStatus: { type: "string", enum: ["opt_in", "opt_out", "unknown"] },
            createdAt: { type: "string", format: "date-time" },
          },
        },
      },
      responses: {
        ValidationError: {
          description: "Validation error",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  error: {
                    type: "object",
                    properties: {
                      message: { type: "string" },
                      requestId: { type: "string" },
                    },
                  },
                },
              },
            },
          },
        },
        Unauthorized: {
          description: "Unauthorized - session required",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  error: {
                    type: "object",
                    properties: {
                      message: { type: "string", example: "Session required" },
                      requestId: { type: "string" },
                    },
                  },
                },
              },
            },
          },
        },
      },
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          description: "Bearer token from session endpoint",
        },
      },
    },

    tags: [
      { name: "System", description: "System health and status" },
      { name: "Authentication", description: "User authentication endpoints" },
      { name: "WhatsApp", description: "WhatsApp integration and messaging" },
      { name: "Contacts", description: "Contact management (CRM)" },
      { name: "Templates", description: "Message templates" },
      { name: "Campaigns", description: "Campaign management and analytics" },
      { name: "Conversations", description: "Live chat and conversations" },
      { name: "Leads", description: "Lead management and tracking" },
    ],
  };
}
