import Bull from 'bull';

const redisConfig = {
  host: process.env.REDIS_HOST || 'localhost',
  port: Number(process.env.REDIS_PORT || 6379),
  retryStrategy: (times: number) => {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
};

export const campaignDispatchQueue = new Bull('campaign-dispatch', redisConfig);
export const webhookProcessQueue = new Bull('webhook-process', redisConfig);
export const importContactsQueue = new Bull('import-contacts', redisConfig);
export const automationTriggerQueue = new Bull('automation-trigger', redisConfig);

// Initialize queue event handlers
export async function initializeQueues() {
  // Campaign dispatch processor
  campaignDispatchQueue.process(async (job) => {
    // Will implement in Stage 4
    console.log('[Queue] Campaign dispatch job received:', job.id);
    return { status: 'pending', message: 'Processor not yet implemented' };
  });

  // Webhook processor
  webhookProcessQueue.process(async (job) => {
    // Will implement in Stage 1
    console.log('[Queue] Webhook process job received:', job.id);
    return { status: 'pending', message: 'Processor not yet implemented' };
  });

  // Import contacts processor
  importContactsQueue.process(async (job) => {
    // Will implement in Stage 2
    console.log('[Queue] Import contacts job received:', job.id);
    return { status: 'pending', message: 'Processor not yet implemented' };
  });

  // Automation trigger processor
  automationTriggerQueue.process(async (job) => {
    // Will implement in Stage 5
    console.log('[Queue] Automation trigger job received:', job.id);
    return { status: 'pending', message: 'Processor not yet implemented' };
  });

  // Global error handlers
  [campaignDispatchQueue, webhookProcessQueue, importContactsQueue, automationTriggerQueue].forEach(
    (queue) => {
      queue.on('failed', (job, err) => {
        console.error(`[Queue] Job ${job.id} failed:`, err.message);
      });

      queue.on('error', (err) => {
        console.error('[Queue] Error:', err);
      });

      queue.on('paused', () => {
        console.log(`[Queue] ${queue.name} paused`);
      });

      queue.on('resumed', () => {
        console.log(`[Queue] ${queue.name} resumed`);
      });
    }
  );

  console.log('[Queue] All queues initialized');
}

// Graceful shutdown
export async function shutdownQueues() {
  await Promise.all([
    campaignDispatchQueue.close(),
    webhookProcessQueue.close(),
    importContactsQueue.close(),
    automationTriggerQueue.close(),
  ]);
  console.log('[Queue] All queues closed');
}
