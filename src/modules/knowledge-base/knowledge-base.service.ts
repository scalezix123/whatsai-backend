import { PrismaClient } from "@prisma/client";
import type { CreateDocumentInput, UpdateDocumentInput } from "./knowledge-base.schemas";

function chunkText(text: string, chunkSize: number = 1000, overlap: number = 200): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    chunks.push(text.slice(start, end));
    start = end - overlap;
    if (start + overlap >= text.length) break;
  }
  return chunks;
}

export async function listDocuments(workspaceId: string, prisma: PrismaClient) {
  return prisma.knowledgeDocument.findMany({
    where: { workspaceId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      title: true,
      type: true,
      status: true,
      errorMessage: true,
      createdAt: true,
      updatedAt: true,
    },
  });
}

export async function getDocument(id: string, workspaceId: string, prisma: PrismaClient) {
  const doc = await prisma.knowledgeDocument.findFirst({ where: { id, workspaceId } });
  if (!doc) throw new Error("Document not found");
  return doc;
}

export async function createDocument(workspaceId: string, input: CreateDocumentInput, prisma: PrismaClient) {
  const chunks = chunkText(input.content);

  const doc = await prisma.knowledgeDocument.create({
    data: {
      workspaceId,
      title: input.title,
      type: input.type,
      content: input.content,
      chunks: chunks,
      status: "indexed",
    },
  });

  return doc;
}

export async function updateDocument(id: string, workspaceId: string, input: UpdateDocumentInput, prisma: PrismaClient) {
  const doc = await prisma.knowledgeDocument.findFirst({ where: { id, workspaceId } });
  if (!doc) throw new Error("Document not found");

  const updateData: Record<string, unknown> = {};
  if (input.title) updateData.title = input.title;
  if (input.content) {
    updateData.content = input.content;
    updateData.chunks = chunkText(input.content);
    updateData.status = "indexed";
  }

  return prisma.knowledgeDocument.update({ where: { id }, data: updateData });
}

export async function deleteDocument(id: string, workspaceId: string, prisma: PrismaClient) {
  const doc = await prisma.knowledgeDocument.findFirst({ where: { id, workspaceId } });
  if (!doc) throw new Error("Document not found");
  return prisma.knowledgeDocument.delete({ where: { id } });
}

export async function searchKnowledge(workspaceId: string, query: string, prisma: PrismaClient) {
  const docs = await prisma.knowledgeDocument.findMany({
    where: { workspaceId, status: "indexed" },
  });

  const results: Array<{ docId: string; title: string; chunk: string; score: number }> = [];
  const queryLower = query.toLowerCase();
  const queryTerms = queryLower.split(/\s+/).filter(Boolean);

  for (const doc of docs) {
    const chunks = (doc.chunks as string[]) || [];
    for (let i = 0; i < chunks.length; i++) {
      const chunkLower = chunks[i].toLowerCase();
      const score = queryTerms.reduce((sum, term) => sum + (chunkLower.includes(term) ? 1 : 0), 0) / queryTerms.length;
      if (score > 0.2) {
        results.push({ docId: doc.id, title: doc.title, chunk: chunks[i], score });
      }
    }
  }

  return results.sort((a, b) => b.score - a.score).slice(0, 5);
}
