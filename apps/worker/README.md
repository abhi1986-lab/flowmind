# FlowMind AI - Worker (BullMQ)

Background processors for:
- workflow.timeline.build
- workflow.ai.analyze (queues to AI providers)
- sop.generate
- artifact cleanup, etc.

Never store or process client data outside of client-scoped context passed in job.

Jobs are enqueued from api-server after client validation.
