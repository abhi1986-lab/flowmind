# @flowmind/shared-types

Shared TypeScript interfaces, DTOs, enums, event schemas used across:
- Desktop agent
- Web dashboard
- API server
- Worker

Import as: `import { Session, EventType, ... } from '@flowmind/shared-types'`

Keep this package dependency-free (or minimal) so Electron, Next, and Nest can all consume it cleanly.
