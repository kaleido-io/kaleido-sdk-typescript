// Example snippet: minimal indexer that logs each event and passes them through unchanged.
// This snippet is baked into the sample Docker image to verify the multi-snippet provider
// starts up, loads snippets, validates them, and routes batches correctly.

export async function setup(ctx) {
    ctx.log.info('hello-indexer setup complete');
}

export async function indexBatch(events, ctx) {
    ctx.log.info(`hello-indexer received ${events.length} event(s)`);
    for (const event of events) {
        ctx.log.info(`  block ${event.data?.block?.number ?? '?'} tx ${event.data?.transactionHash ?? '?'}`);
    }
    return { events };
}
