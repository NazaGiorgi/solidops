import { assertIsolatedTestDb } from './test-db.guard';

export default async function globalSetup(): Promise<void> {
  assertIsolatedTestDb();
}
