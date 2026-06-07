/**
 * Feature Flags for Phase 1 MVP Implementation
 * 
 * These flags control staged rollout of new functionality without requiring code deploys.
 * Set via environment variables in .env or deployment config.
 * 
 * Stage 0: Architecture Hardening
 * Stage 1: WhatsApp Reliability
 * Stage 2: CRM Foundation
 * Stage 3: Template Hardening
 * Stage 4: Campaign Queue System
 * Stage 5: Inbox Consistency
 * Stage 6: RBAC + Operational Logs
 */

export const FEATURES = {
  // Stage 1: WhatsApp Reliability
  /** Enable webhook signature verification (SHA256) */
  ENABLE_WEBHOOK_SIGNATURE_VERIFICATION: process.env.FEATURE_WEBHOOK_SIGNATURE === 'true',
  
  /** Enable webhook deduplication via fingerprint tracking */
  ENABLE_WEBHOOK_DEDUPLICATION: process.env.FEATURE_WEBHOOK_DEDUP === 'true',
  
  /** Enable webhook event persistence and logging */
  ENABLE_WEBHOOK_LOGGING: process.env.FEATURE_WEBHOOK_LOGGING === 'true' || true, // Default on

  // Stage 2: CRM Foundation
  /** Enable duplicate contact detection by phone */
  ENABLE_DUPLICATE_DETECTION: process.env.FEATURE_DUPLICATE_DETECTION === 'true',
  
  /** Enable contact opt-in/opt-out compliance */
  ENABLE_CONSENT_MANAGEMENT: process.env.FEATURE_CONSENT_MANAGEMENT === 'true',
  
  /** Enable CSV contact import with batch processing */
  ENABLE_BULK_IMPORT: process.env.FEATURE_BULK_IMPORT === 'true',
  
  /** Enable custom contact attributes */
  ENABLE_CUSTOM_ATTRIBUTES: process.env.FEATURE_CUSTOM_ATTRIBUTES === 'true',

  // Stage 3: Template Hardening
  /** Enable template parameter validation before send */
  ENABLE_TEMPLATE_VALIDATION: process.env.FEATURE_TEMPLATE_VALIDATION === 'true',
  
  /** Enable template variable extraction and mapping */
  ENABLE_TEMPLATE_VARIABLE_MAPPING: process.env.FEATURE_TEMPLATE_VARIABLE_MAPPING === 'true',

  // Stage 4: Campaign Queue System
  /** Use queue-based campaign dispatch instead of direct send */
  USE_CAMPAIGN_QUEUE: process.env.FEATURE_CAMPAIGN_QUEUE === 'true',
  
  /** Enable automatic retry of failed messages */
  ENABLE_AUTOMATIC_RETRY: process.env.FEATURE_AUTOMATIC_RETRY === 'true',
  
  /** Enable campaign scheduling */
  ENABLE_CAMPAIGN_SCHEDULING: process.env.FEATURE_CAMPAIGN_SCHEDULING === 'true',

  // Stage 5: Inbox Consistency
  /** Enable conversation assignment rules */
  ENABLE_ASSIGNMENT_RULES: process.env.FEATURE_ASSIGNMENT_RULES === 'true',
  
  /** Enable lead-conversation synchronization */
  ENABLE_LEAD_SYNC: process.env.FEATURE_LEAD_SYNC === 'true',
  
  /** Enable conversation timeline events */
  ENABLE_CONVERSATION_TIMELINE: process.env.FEATURE_CONVERSATION_TIMELINE === 'true',

  // Stage 6: RBAC + Operational Logs
  /** Enable role-based access control middleware */
  ENABLE_RBAC: process.env.FEATURE_RBAC === 'true',
  
  /** Enable API request logging */
  ENABLE_API_LOGGING: process.env.FEATURE_API_LOGGING === 'true',
  
  /** Enable audit log for sensitive actions */
  ENABLE_AUDIT_LOGS: process.env.FEATURE_AUDIT_LOGS === 'true',
};

export function getFeatureStatus() {
  return Object.entries(FEATURES).reduce((acc, [key, value]) => {
    acc[key] = value ? '✅' : '❌';
    return acc;
  }, {} as Record<string, string>);
}
