import { describe, it, expect, beforeAll, afterAll, beforeEach } from "@jest/globals";
import { testDb, cleanupDatabase, teardown } from "./setup";
import { getConnectionHealth } from "../modules/whatsapp/whatsapp.service";

describe("WhatsApp Service", () => {
  beforeAll(async () => {
    await cleanupDatabase();
  });

  beforeEach(async () => {
    await cleanupDatabase();
  });

  afterAll(async () => {
    await teardown();
  });

  it("should return not_connected when no connection exists", async () => {
    const workspaceId = "test-workspace-123";
    
    const health = await getConnectionHealth(workspaceId, testDb);
    
    expect(health.status).toBe("not_connected");
    expect(health.phoneNumberId).toBeNull();
  });

  it("should return connection health when connected", async () => {
    const workspace = await testDb.workspace.create({
      data: { name: "Test Workspace", plan: "starter" },
    });

    await testDb.whatsAppConnection.create({
      data: {
        workspaceId: workspace.id,
        display_phone_number: "+1234567890",
        business_name: "Test Business",
        business_portfolio: "test-portfolio",
        status: "connected",
      },
    });

    const health = await getConnectionHealth(workspace.id, testDb);

    expect(health.status).toBe("connected");
    expect(health.displayPhoneNumber).toBe("+1234567890");
    expect(health.businessName).toBe("Test Business");
  });
});
