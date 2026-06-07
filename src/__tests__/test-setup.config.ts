import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { config } from "dotenv";

config();

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL!,
});

// Singleton Prisma instance for tests
export const testDb = new PrismaClient({
  adapter,
  log: ["error"],
});

// Test utilities
export async function cleanupDatabase() {
  // Clean in correct dependency order
  await Promise.all([
    testDb.campaignRecipient.deleteMany({}),
    testDb.campaign.deleteMany({}),
    testDb.messageTemplate.deleteMany({}),
    testDb.contactTag.deleteMany({}),
    testDb.contact.deleteMany({}),
    testDb.conversation.deleteMany({}),
    testDb.lead.deleteMany({}),
    testDb.metaAuthorization.deleteMany({}),
    testDb.whatsAppConnection.deleteMany({}),
    testDb.user.deleteMany({}),
    testDb.workspace.deleteMany({}),
  ]);
}

export async function teardown() {
  await testDb.$disconnect();
}
