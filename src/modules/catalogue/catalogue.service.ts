import { PrismaClient } from "@prisma/client";
import type { CreateProductInput, UpdateProductInput } from "./catalogue.schemas";

export async function listProducts(workspaceId: string, prisma: PrismaClient) {
  return prisma.$queryRawUnsafe<any[]>(
    `SELECT * FROM "Product" WHERE "workspaceId" = $1 ORDER BY "createdAt" DESC`,
    workspaceId
  );
}

export async function getProduct(id: string, workspaceId: string, prisma: PrismaClient) {
  const products = await prisma.$queryRawUnsafe<any[]>(
    `SELECT * FROM "Product" WHERE "id" = $1 AND "workspaceId" = $2`,
    id, workspaceId
  );
  if (!products?.[0]) throw new Error("Product not found");
  return products[0];
}

export async function createProduct(workspaceId: string, input: CreateProductInput, prisma: PrismaClient) {
  await prisma.$executeRawUnsafe(
    `INSERT INTO "Product" ("id", "workspaceId", "name", "description", "price", "currency", "sku", "imageUrl", "category", "inStock", "createdAt", "updatedAt") VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())`,
    workspaceId, input.name, input.description || null, input.price, input.currency, input.sku || null, input.imageUrl || null, input.category || null, input.inStock ?? true
  );
  const products = await prisma.$queryRawUnsafe<any[]>(
    `SELECT * FROM "Product" WHERE "workspaceId" = $1 ORDER BY "createdAt" DESC LIMIT 1`,
    workspaceId
  );
  return products[0];
}

export async function updateProduct(id: string, workspaceId: string, input: UpdateProductInput, prisma: PrismaClient) {
  const fields: string[] = [];
  const values: unknown[] = [id, workspaceId];
  let idx = 3;

  if (input.name !== undefined) { fields.push(`"name" = $${idx++}`); values.push(input.name); }
  if (input.description !== undefined) { fields.push(`"description" = $${idx++}`); values.push(input.description); }
  if (input.price !== undefined) { fields.push(`"price" = $${idx++}`); values.push(input.price); }
  if (input.sku !== undefined) { fields.push(`"sku" = $${idx++}`); values.push(input.sku); }
  if (input.imageUrl !== undefined) { fields.push(`"imageUrl" = $${idx++}`); values.push(input.imageUrl); }
  if (input.category !== undefined) { fields.push(`"category" = $${idx++}`); values.push(input.category); }
  if (input.inStock !== undefined) { fields.push(`"inStock" = $${idx++}`); values.push(input.inStock); }

  if (fields.length === 0) throw new Error("No fields to update");

  fields.push(`"updatedAt" = NOW()`);
  await prisma.$executeRawUnsafe(
    `UPDATE "Product" SET ${fields.join(", ")} WHERE "id" = $1 AND "workspaceId" = $2`,
    ...values
  );
  return getProduct(id, workspaceId, prisma);
}

export async function deleteProduct(id: string, workspaceId: string, prisma: PrismaClient) {
  await prisma.$executeRawUnsafe(
    `DELETE FROM "Product" WHERE "id" = $1 AND "workspaceId" = $2`,
    id, workspaceId
  );
}

export async function sendProductCard(
  workspaceId: string,
  productId: string,
  to: string,
  prisma: PrismaClient
) {
  const product = await getProduct(productId, workspaceId, prisma);
  const connection = await prisma.whatsAppConnection.findFirst({
    where: { workspaceId },
    select: { phone_number_id: true },
  });
  const auth = await prisma.metaAuthorization.findUnique({
    where: { workspaceId },
    select: { accessToken: true },
  });

  if (!connection || !auth) throw new Error("WhatsApp not connected");

  const response = await fetch(`https://graph.facebook.com/v21.0/${connection.phone_number_id}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${auth.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "interactive",
      interactive: {
        type: "product",
        body: { text: `${product.name}\n\n${product.description || ""}\n\nPrice: ₹${product.price}` },
        action: { name: "catalog_message", parameters: { product_retailer_id: product.sku || product.id } },
      },
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to send product card: ${error}`);
  }

  return response.json();
}
